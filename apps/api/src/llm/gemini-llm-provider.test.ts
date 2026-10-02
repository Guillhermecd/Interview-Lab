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

type GenerateContentStream = GeminiClient['models']['generateContentStream'];
type GeminiChunk = Awaited<ReturnType<GenerateContent>>;

const unusedStream: GenerateContentStream = () =>
  Promise.reject(new Error('generateContentStream was not expected'));
const unusedGenerate: GenerateContent = () =>
  Promise.reject(new Error('generateContent was not expected'));

function providerWith(
  generateContent: GenerateContent,
  generateContentStream: GenerateContentStream = unusedStream,
): GeminiLlmProvider {
  return new GeminiLlmProvider(
    { models: { generateContent, generateContentStream } },
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

describe('GeminiLlmProvider.streamText', () => {
  const TEXT_REQUEST = { system: 'You explain results.', prompt: 'Explain.' };

  async function* chunks(items: GeminiChunk[], failure?: Error): AsyncGenerator<GeminiChunk> {
    for (const item of items) {
      await Promise.resolve();
      yield item;
    }
    if (failure) {
      throw failure;
    }
  }

  async function readAll(provider: GeminiLlmProvider, signal?: AbortSignal) {
    const received = [];
    for await (const chunk of provider.streamText(TEXT_REQUEST, signal ? { signal } : {})) {
      received.push(chunk);
    }
    return received;
  }

  it('yields the text as it arrives and the usage reported at the end', async () => {
    const provider = providerWith(unusedGenerate, () =>
      Promise.resolve(
        chunks([
          { text: 'O Sul ' },
          { text: 'lidera.', usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 12 } },
        ]),
      ),
    );

    await expect(readAll(provider)).resolves.toEqual([
      { text: 'O Sul ' },
      { text: 'lidera.', usage: { inputTokens: 90, outputTokens: 12 } },
    ]);
  });

  it('asks for plain text, without a JSON schema, and passes the abort signal', async () => {
    const sent: GeminiRequest[] = [];
    const abort = new AbortController();
    const provider = providerWith(unusedGenerate, (request) => {
      sent.push(request);
      return Promise.resolve(chunks([{ text: 'ok' }]));
    });

    await readAll(provider, abort.signal);

    expect(sent[0]?.config.abortSignal).toBe(abort.signal);
    expect(sent[0]?.config).not.toHaveProperty('responseMimeType');
    expect(sent[0]?.config).not.toHaveProperty('responseJsonSchema');
  });

  it('reports a failure in the middle of the stream as unavailable', async () => {
    const provider = providerWith(unusedGenerate, () =>
      Promise.resolve(chunks([{ text: 'O Sul ' }], httpError(503))),
    );

    await expect(readAll(provider)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });

  it('reports a failure after an abort as cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    const provider = providerWith(unusedGenerate, () => Promise.reject(new Error('aborted')));

    await expect(readAll(provider, abort.signal)).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });
});
