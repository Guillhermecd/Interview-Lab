import { LlmError } from './llm-error.js';
import type { LlmJsonResponse, LlmProvider, LlmTextChunk } from './llm-provider.js';

// Used when no API key is set, so the rest of the application (health check,
// query execution) still starts and works.
export class UnconfiguredLlmProvider implements LlmProvider {
  generateJson(): Promise<LlmJsonResponse> {
    return Promise.reject(new LlmError('LLM_NOT_CONFIGURED'));
  }

  streamText(): AsyncIterable<LlmTextChunk> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new LlmError('LLM_NOT_CONFIGURED')),
      }),
    };
  }
}
