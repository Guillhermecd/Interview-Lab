import type { ApiErrorBody } from '@interview-lab/shared';

// Same-origin in every environment: in development the Vite proxy forwards
// /api to the backend.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

const NETWORK_ERROR: ApiErrorBody = {
  code: 'NETWORK_ERROR',
  message: 'Não foi possível falar com o servidor. Verifique sua conexão.',
};

const UNEXPECTED_RESPONSE: ApiErrorBody = {
  code: 'UNEXPECTED_RESPONSE',
  message: 'O servidor devolveu uma resposta inesperada.',
};

const UNAUTHORIZED_STATUS = 401;
// Checking the session answers 401 when there is none; that is not an expiry.
const SESSION_PATH = '/auth/me';

let unauthorizedHandler: (() => void) | undefined;

// The session lives in an HttpOnly cookie sent by the browser itself (D-08),
// so no token is ever handled here. On a 401 the registered handler runs.
export function onUnauthorized(handler: (() => void) | undefined): void {
  unauthorizedHandler = handler;
}

// An error in the standard API format. Screens decide what to do by `code`,
// never by the text of `message`.
export class ApiError extends Error {
  readonly code: string;
  readonly details: ApiErrorBody['details'];
  readonly retryAfterSeconds: ApiErrorBody['retryAfterSeconds'];

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.details = body.details;
    this.retryAfterSeconds = body.retryAfterSeconds;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  );
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

// Sends the request; on an error status, throws an ApiError built from the
// standard error body.
export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(NETWORK_ERROR);
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const error = new ApiError(isApiErrorBody(body) ? body : UNEXPECTED_RESPONSE);
    // The session expired or was never there: the screen goes back to login.
    if (response.status === UNAUTHORIZED_STATUS && path !== SESSION_PATH) {
      unauthorizedHandler?.();
    }
    throw error;
  }
  return response;
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  return (await response.json()) as T;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (isApiErrorBody(error)) {
    return new ApiError(error);
  }
  return new ApiError(UNEXPECTED_RESPONSE);
}
