export const LLM_ERROR_CODES = [
  'LLM_NOT_CONFIGURED',
  'LLM_UNAVAILABLE',
  'LLM_RATE_LIMITED',
  'LLM_INVALID_RESPONSE',
] as const;
export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

const MESSAGES: Record<LlmErrorCode, string> = {
  LLM_NOT_CONFIGURED: 'O serviço de IA não está configurado.',
  LLM_UNAVAILABLE: 'O serviço de IA está indisponível no momento.',
  LLM_RATE_LIMITED: 'O limite de uso do serviço de IA foi atingido. Tente novamente em instantes.',
  LLM_INVALID_RESPONSE: 'O serviço de IA devolveu uma resposta que não pôde ser usada.',
};

export class LlmError extends Error {
  constructor(readonly code: LlmErrorCode) {
    super(MESSAGES[code]);
    this.name = 'LlmError';
  }
}
