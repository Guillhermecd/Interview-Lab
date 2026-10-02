export const GUARD_RULES = [
  'EMPTY_QUERY',
  'SYNTAX_ERROR',
  'MULTIPLE_STATEMENTS',
  'NOT_A_SELECT',
  'UNSUPPORTED_CONSTRUCT',
  'TABLE_NOT_ALLOWED',
  'FUNCTION_NOT_ALLOWED',
  'TYPE_NOT_ALLOWED',
  'TOO_MANY_JOINS',
  'INVALID_LIMIT',
  'QUERY_TOO_COMPLEX',
] as const;
export type GuardRule = (typeof GUARD_RULES)[number];

// Raised when a query is refused before reaching the database. The message is
// written for two readers: the user, and the LLM that has to fix the query.
export class SqlGuardError extends Error {
  constructor(
    readonly rule: GuardRule,
    message: string,
  ) {
    super(message);
    this.name = 'SqlGuardError';
  }
}
