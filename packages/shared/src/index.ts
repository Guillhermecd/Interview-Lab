export const HEALTH_STATUS_OK = 'ok';

export interface HealthResponse {
  status: typeof HEALTH_STATUS_OK;
}

export interface ApiErrorDetail {
  field: string;
  message: string;
}

// Standard error body of every 4xx/5xx response. Clients decide behaviour by
// `code`, never by the text of `message`.
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

export interface QueryColumn {
  name: string;
  // PostgreSQL type name in lowercase (e.g. "int8", "numeric", "timestamptz").
  type: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  // One array per row, in column order, so duplicate column names are preserved.
  rows: unknown[][];
  rowCount: number;
  // True when the query produced more rows than the configured limit.
  truncated: boolean;
  durationMs: number;
}

export interface ExecuteQueryRequest {
  sql: string;
}

export const VISUALIZATION_TYPES = ['table', 'bar', 'line'] as const;
export type VisualizationType = (typeof VISUALIZATION_TYPES)[number];

export interface VisualizationSuggestion {
  type: VisualizationType;
  // Column names of the result, present for bar and line charts.
  xColumn?: string;
  yColumn?: string;
}

// Tokens spent with the LLM provider to answer one question.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface AskRequest {
  question: string;
}

export interface AnsweredQuestion {
  status: 'answered';
  question: string;
  // The SQL written by the LLM, before the guard adjusted its LIMIT.
  sql: string;
  result: QueryResult;
  explanation: string;
  visualization: VisualizationSuggestion;
  // How many times SQL was generated: 2 when the first attempt was refused.
  attempts: number;
  usage: TokenUsage;
}

// The LLM judged that the exposed data cannot answer the question.
export interface UnansweredQuestion {
  status: 'not_answerable';
  question: string;
  reason: string;
  usage: TokenUsage;
}

export type AskResponse = AnsweredQuestion | UnansweredQuestion;
