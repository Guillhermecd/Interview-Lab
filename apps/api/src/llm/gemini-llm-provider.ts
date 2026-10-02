import { Logger } from '@nestjs/common';
import { LlmError } from './llm-error.js';
import type {
  LlmCallOptions,
  LlmCallUsage,
  LlmJsonRequest,
  LlmJsonResponse,
  LlmProvider,
  LlmTextChunk,
  LlmTextRequest,
} from './llm-provider.js';

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

interface GeminiConfig {
  systemInstruction: string;
  temperature: number;
  httpOptions: {
    timeout: number;
    retryOptions: { attempts: number; httpStatusCodes: number[] };
  };
  abortSignal?: AbortSignal;
  responseMimeType?: 'application/json';
  responseJsonSchema?: Record<string, unknown>;
}

interface GeminiRequest {
  model: string;
  contents: string;
  config: GeminiConfig;
}

// The part of the @google/genai client this provider uses. Declaring it here
// lets tests replace the client without touching the network.
export interface GeminiClient {
  models: {
    generateContent: (request: GeminiRequest) => Promise<GeminiResponse>;
    generateContentStream: (request: GeminiRequest) => Promise<AsyncIterable<GeminiResponse>>;
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

function usageOf(metadata: GeminiUsageMetadata | undefined): LlmCallUsage | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  return {
    inputTokens: metadata.promptTokenCount ?? 0,
    // Reasoning tokens are billed as output.
    outputTokens: (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0),
  };
}

export class GeminiLlmProvider implements LlmProvider {
  private readonly logger = new Logger(GeminiLlmProvider.name);

  constructor(
    private readonly client: GeminiClient,
    private readonly options: GeminiOptions,
  ) {}

  async generateJson(
    request: LlmJsonRequest,
    options: LlmCallOptions = {},
  ): Promise<LlmJsonResponse> {
    let response: GeminiResponse;
    try {
      response = await this.client.models.generateContent({
        model: this.options.model,
        contents: request.prompt,
        config: {
          ...this.baseConfig(request.system, options),
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseSchema,
        },
      });
    } catch (error) {
      throw this.translate(error, options);
    }

    return {
      data: this.parseJson(response.text),
      usage: usageOf(response.usageMetadata) ?? { inputTokens: 0, outputTokens: 0 },
    };
  }

  async *streamText(
    request: LlmTextRequest,
    options: LlmCallOptions = {},
  ): AsyncIterable<LlmTextChunk> {
    try {
      const stream = await this.client.models.generateContentStream({
        model: this.options.model,
        contents: request.prompt,
        config: this.baseConfig(request.system, options),
      });

      for await (const chunk of stream) {
        const usage = usageOf(chunk.usageMetadata);
        yield { text: chunk.text ?? '', ...(usage && { usage }) };
      }
    } catch (error) {
      throw this.translate(error, options);
    }
  }

  private baseConfig(system: string, options: LlmCallOptions): GeminiConfig {
    return {
      systemInstruction: system,
      temperature: TEMPERATURE,
      httpOptions: {
        timeout: this.options.timeoutMs,
        retryOptions: { attempts: MAX_HTTP_ATTEMPTS, httpStatusCodes: RETRYABLE_HTTP_STATUS },
      },
      ...(options.signal && { abortSignal: options.signal }),
    };
  }

  private translate(error: unknown, options: LlmCallOptions): LlmError {
    if (error instanceof LlmError) {
      return error;
    }
    if (options.signal?.aborted === true) {
      return new LlmError('LLM_CANCELLED');
    }
    const status = statusOf(error);
    // Only the HTTP status is logged: the provider's message may echo the
    // prompt, which contains user questions and database rows.
    this.logger.warn(`Gemini request failed (status=${String(status ?? 'none')})`);
    return new LlmError(status === HTTP_TOO_MANY_REQUESTS ? 'LLM_RATE_LIMITED' : 'LLM_UNAVAILABLE');
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
