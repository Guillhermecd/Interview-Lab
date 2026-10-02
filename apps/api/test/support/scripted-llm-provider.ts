import { LlmError } from '../../src/llm/llm-error.js';
import type {
  LlmCallOptions,
  LlmJsonRequest,
  LlmJsonResponse,
  LlmProvider,
  LlmTextChunk,
  LlmTextRequest,
} from '../../src/llm/llm-provider.js';

const TOKENS_PER_CALL = { inputTokens: 100, outputTokens: 20 };

export interface ScriptedOptions {
  // Pause before each streamed chunk, to leave time for a test to disconnect.
  chunkDelayMs?: number;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// Stands in for a real LLM: answers each call with the next scripted value and
// records what it was asked. An Error in the script is thrown instead.
export class ScriptedLlmProvider implements LlmProvider {
  readonly requests: LlmJsonRequest[] = [];
  readonly textRequests: LlmTextRequest[] = [];
  // Set when a streamed text was interrupted through the abort signal.
  streamAborted = false;

  constructor(
    private readonly jsonAnswers: unknown[],
    private readonly texts: (string | Error)[] = [],
    private readonly options: ScriptedOptions = {},
  ) {}

  generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    this.requests.push(request);
    const answer = this.jsonAnswers.shift();
    if (answer === undefined) {
      return Promise.reject(new Error('ScriptedLlmProvider has no JSON answer left'));
    }
    if (answer instanceof Error) {
      return Promise.reject(answer);
    }
    return Promise.resolve({ data: answer, usage: TOKENS_PER_CALL });
  }

  async *streamText(
    request: LlmTextRequest,
    options: LlmCallOptions = {},
  ): AsyncIterable<LlmTextChunk> {
    this.textRequests.push(request);
    const text = this.texts.shift();
    if (text === undefined) {
      throw new Error('ScriptedLlmProvider has no text left');
    }
    if (text instanceof Error) {
      throw text;
    }

    // One chunk per word, like a model streaming tokens.
    for (const chunk of text.match(/\S+\s*/g) ?? []) {
      if (this.options.chunkDelayMs !== undefined) {
        await sleep(this.options.chunkDelayMs);
      }
      if (options.signal?.aborted === true) {
        this.streamAborted = true;
        throw new LlmError('LLM_CANCELLED');
      }
      yield { text: chunk };
    }
    yield { text: '', usage: TOKENS_PER_CALL };
  }
}

export function sqlAnswer(
  sql: string,
  visualization = 'table',
  xColumn = '',
  yColumn = '',
): unknown {
  return { sql, cannotAnswerReason: '', visualization, xColumn, yColumn };
}

export function refusalAnswer(reason: string): unknown {
  return { sql: '', cannotAnswerReason: reason, visualization: 'table', xColumn: '', yColumn: '' };
}

export function summaryAnswer(summary: string): unknown {
  return { summary };
}
