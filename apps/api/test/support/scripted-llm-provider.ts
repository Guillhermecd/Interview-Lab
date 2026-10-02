import type { LlmJsonRequest, LlmJsonResponse, LlmProvider } from '../../src/llm/llm-provider.js';

const TOKENS_PER_CALL = { inputTokens: 100, outputTokens: 20 };

// Stands in for a real LLM: answers each call with the next scripted value and
// records what it was asked.
export class ScriptedLlmProvider implements LlmProvider {
  readonly requests: LlmJsonRequest[] = [];

  constructor(private readonly answers: unknown[]) {}

  generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    this.requests.push(request);
    if (this.answers.length === 0) {
      return Promise.reject(new Error('ScriptedLlmProvider has no answer left'));
    }
    return Promise.resolve({ data: this.answers.shift(), usage: TOKENS_PER_CALL });
  }
}

export function sqlAnswer(sql: string): unknown {
  return { sql, cannotAnswerReason: '' };
}

export function refusalAnswer(reason: string): unknown {
  return { sql: '', cannotAnswerReason: reason };
}

export function explanationAnswer(
  explanation: string,
  visualization = 'table',
  xColumn = '',
  yColumn = '',
): unknown {
  return { explanation, visualization, xColumn, yColumn };
}
