import { Logger } from '@nestjs/common';
import { LlmError } from './llm-error.js';
import type { LlmJsonRequest, LlmJsonResponse, LlmProvider } from './llm-provider.js';

const HTTP_TOO_MANY_REQUESTS = 429;
// Low temperature: the same question should produce the same SQL.
const TEMPERATURE = 0;
// The provider answers 5xx when the model is overloaded; the SDK retries those
// with exponential backoff. 429 is deliberately not retried: on the free tier
// it means the daily quota is gone, and every retry would count against it.
const MAX_HTTP_ATTEMPTS = 3;
const RETRYABLE_HTTP_STATUS = [408, 500, 502, 503, 504];

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface GeminiResponse {
  text?: string | undefined;
  usageMetadata?: GeminiUsageMetadata | undefined;
}

interface GeminiRequest {
  model: string;
  contents: string;
  config: {
    systemInstruction: string;
    responseMimeType: 'application/json';
    responseJsonSchema: Record<string, unknown>;
    temperature: number;
    httpOptions: {
      timeout: number;
      retryOptions: { attempts: number; httpStatusCodes: number[] };
    };
  };
}

// The part of the @google/genai client this provider uses. Declaring it here
// lets tests replace the client without touching the network.
export interface GeminiClient {
  models: {
    generateContent: (request: GeminiRequest) => Promise<GeminiResponse>;
  };
}

export interface GeminiOptions {
  model: string;
  timeoutMs: number;
}

function statusOf(error: unknown): number | undefined {
  return error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}

export class GeminiLlmProvider implements LlmProvider {
  private readonly logger = new Logger(GeminiLlmProvider.name);

  constructor(
    private readonly client: GeminiClient,
    private readonly options: GeminiOptions,
  ) {}

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    const response = await this.call(request);

    return {
      data: this.parseJson(response.text),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        // Reasoning tokens are billed as output.
        outputTokens:
          (response.usageMetadata?.candidatesTokenCount ?? 0) +
          (response.usageMetadata?.thoughtsTokenCount ?? 0),
      },
    };
  }

  private async call(request: LlmJsonRequest): Promise<GeminiResponse> {
    try {
      return await this.client.models.generateContent({
        model: this.options.model,
        contents: request.prompt,
        config: {
          systemInstruction: request.system,
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseSchema,
          temperature: TEMPERATURE,
          httpOptions: {
            timeout: this.options.timeoutMs,
            retryOptions: { attempts: MAX_HTTP_ATTEMPTS, httpStatusCodes: RETRYABLE_HTTP_STATUS },
          },
        },
      });
    } catch (error) {
      const status = statusOf(error);
      // Only the HTTP status is logged: the provider's message may echo the
      // prompt, which contains user questions and database rows.
      this.logger.warn(`Gemini request failed (status=${String(status ?? 'none')})`);
      throw new LlmError(
        status === HTTP_TOO_MANY_REQUESTS ? 'LLM_RATE_LIMITED' : 'LLM_UNAVAILABLE',
      );
    }
  }

  private parseJson(text: string | undefined): unknown {
    if (text === undefined || text.trim() === '') {
      throw new LlmError('LLM_INVALID_RESPONSE');
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new LlmError('LLM_INVALID_RESPONSE');
    }
  }
}
