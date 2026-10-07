// Runs SQL that came from the LLM or from a user, always behind the guard.
export const READONLY_POOL = Symbol('READONLY_POOL');
// Runs statements written in the code. Separate, so that slow questions in the
// chat cannot keep the dashboard, the schema or the health check waiting (D-65).
export const FIXED_READ_POOL = Symbol('FIXED_READ_POOL');
export const QUERY_ENV = Symbol('QUERY_ENV');
export const SQL_GUARD = Symbol('SQL_GUARD');
