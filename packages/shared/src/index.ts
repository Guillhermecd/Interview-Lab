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
