export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface LlmJsonRequest {
  // Instructions that define the task and its rules.
  system: string;
  // The content to work on. May contain untrusted text (a user question, rows
  // read from the database).
  prompt: string;
  // JSON Schema the answer must follow.
  responseSchema: Record<string, unknown>;
}

export interface LlmTextRequest {
  system: string;
  prompt: string;
}

export interface LlmCallOptions {
  // Aborting stops waiting for the provider (the provider may still bill the call).
  signal?: AbortSignal;
}

export interface LlmCallUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmJsonResponse {
  // Parsed JSON, not yet validated: callers must check its shape.
  data: unknown;
  usage: LlmCallUsage;
}

// The only thing the application knows about an LLM vendor. Prompts and the
// question-answering flow live outside, so replacing the vendor means writing
// one new implementation of this interface (D-03).
// A piece of streamed text. The provider reports token usage on the last chunks.
export interface LlmTextChunk {
  text: string;
  usage?: LlmCallUsage;
}

export interface LlmProvider {
  generateJson(request: LlmJsonRequest, options?: LlmCallOptions): Promise<LlmJsonResponse>;
  // Plain text, delivered as it is generated.
  streamText(request: LlmTextRequest, options?: LlmCallOptions): AsyncIterable<LlmTextChunk>;
}
