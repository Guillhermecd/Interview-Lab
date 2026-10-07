export const LIMIT_ERROR_CODES = [
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'EXECUTION_IN_PROGRESS',
] as const;
export type LimitErrorCode = (typeof LIMIT_ERROR_CODES)[number];

const MESSAGES: Record<LimitErrorCode, string> = {
  RATE_LIMITED: 'Muitas requisições em pouco tempo. Aguarde um minuto e tente de novo.',
  QUOTA_EXCEEDED: 'A cota diária de uso da IA foi atingida. Ela é renovada à meia-noite (UTC).',
  EXECUTION_IN_PROGRESS:
    'Já existe uma pergunta sua em andamento. Aguarde ela terminar, ou pare-a, e tente de novo.',
};

// Refused because of a usage limit, before any call to the LLM (rule 7).
export class LimitError extends Error {
  constructor(
    readonly code: LimitErrorCode,
    // Seconds until the limit resets, shown to the user as a countdown. Absent
    // when it does not depend on time (an execution in progress).
    readonly retryAfterSeconds?: number,
  ) {
    super(MESSAGES[code]);
    this.name = 'LimitError';
  }
}
