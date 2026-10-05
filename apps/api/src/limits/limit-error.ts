export const LIMIT_ERROR_CODES = ['RATE_LIMITED', 'QUOTA_EXCEEDED'] as const;
export type LimitErrorCode = (typeof LIMIT_ERROR_CODES)[number];

const MESSAGES: Record<LimitErrorCode, string> = {
  RATE_LIMITED: 'Muitas requisições em pouco tempo. Aguarde um minuto e tente de novo.',
  QUOTA_EXCEEDED: 'A cota diária de uso da IA foi atingida. Ela é renovada à meia-noite (UTC).',
};

// Refused because of a usage limit, before any call to the LLM (rule 7).
export class LimitError extends Error {
  constructor(readonly code: LimitErrorCode) {
    super(MESSAGES[code]);
    this.name = 'LimitError';
  }
}
