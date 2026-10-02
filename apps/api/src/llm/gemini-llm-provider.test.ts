import { describe, expect, it } from 'vitest';
import { GeminiLlmProvider, type GeminiClient } from './gemini-llm-provider.js';
import type { LlmJsonRequest } from './llm-provider.js';

type GenerateContent = GeminiClient['models']['generateContent'];
type GeminiRequest = Parameters<GenerateContent>[0];

const REQUEST: LlmJsonRequest = {
  system: 'You write SQL.',
  prompt: 'How many orders?',
  responseSchema: { type: 'object' },
};

function providerWith(generateContent: GenerateContent): GeminiLlmProvider {
  return new GeminiLlmProvider(
    { models: { generateContent } },
    { model: 'test-model', timeoutMs: 1234 },
  );
}

function httpError(status: number): Error {
  return Object.assign(new Error('provider message quoting the prompt'), { status });
}

describe('GeminiLlmProvider', () => {
  it('sends the model, prompts, JSON schema and timeout', async () => {
    const sent: GeminiRequest[] = [];
    const provider = providerWith((request) => {
      sent.push(request);
      return Promise.resolve({ text: '{}' });
    });

    await provider.generateJson(REQUEST);

    expect(sent).toEqual([
      {
        model: 'test-model',
        contents: 'How many orders?',
        config: {
          systemInstruction: 'You write SQL.',
          responseMimeType: 'application/json',
          responseJsonSchema: { type: 'object' },
          temperature: 0,
          httpOptions: {
            timeout: 1234,
            retryOptions: { attempts: 3, httpStatusCodes: [408, 500, 502, 503, 504] },
          },
        },
      },
    ]);
  });

  it('parses the JSON answer and reports token usage', async () => {
    const provider = providerWith(() =>
      Promise.resolve({
        text: '{"sql":"SELECT 1"}',
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 15 },
      }),
    );

    await expect(provider.generateJson(REQUEST)).resolves.toEqual({
      data: { sql: 'SELECT 1' },
      usage: { inputTokens: 120, outputTokens: 45 },
    });
  });

  it('reports zero tokens when the provider sends no usage', async () => {
    const provider = providerWith(() => Promise.resolve({ text: '{}' }));

    await expect(provider.generateJson(REQUEST)).resolves.toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it.each([
    ['no text', undefined],
    ['empty text', '  '],
    ['text that is not JSON', 'Sure! Here is the SQL: SELECT 1'],
    ['truncated JSON', '{"sql":"SELECT'],
  ])('rejects an answer with %s', async (_case, text) => {
    const provider = providerWith(() => Promise.resolve({ text }));

    await expect(provider.generateJson(REQUEST)).rejects.toMatchObject({
      code: 'LLM_INVALID_RESPONSE',
    });
  });

  it('reports a 429 as rate limited', async () => {
    const provider = providerWith(() => Promise.reject(httpError(429)));

    await expect(provider.generateJson(REQUEST)).rejects.toMatchObject({
      code: 'LLM_RATE_LIMITED',
    });
  });

  it.each([400, 401, 403, 500, 503])('reports HTTP %i as unavailable', async (status) => {
    const provider = providerWith(() => Promise.reject(httpError(status)));

    await expect(provider.generateJson(REQUEST)).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
    });
  });

  it('reports a network failure as unavailable, without the provider message', async () => {
    const provider = providerWith(() => Promise.reject(new Error('fetch failed: api-key=secret')));
    const failure = provider.generateJson(REQUEST);

    await expect(failure).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
    await expect(failure).rejects.not.toThrow(/secret/);
  });
});
