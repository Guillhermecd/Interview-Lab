import type { AuthUser, LoginRequest, RegisterRequest, UsageSummary } from '@interview-lab/shared';
import { request, requestJson } from './api';

const JSON_HEADERS = { 'content-type': 'application/json' };

// Only transports data. The session itself is an HttpOnly cookie the browser
// keeps and sends; this code never sees the token (D-08).
export const AuthService = {
  me(): Promise<AuthUser> {
    return requestJson<AuthUser>('/auth/me');
  },

  login(payload: LoginRequest): Promise<AuthUser> {
    return requestJson<AuthUser>('/auth/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
  },

  register(payload: RegisterRequest): Promise<AuthUser> {
    return requestJson<AuthUser>('/auth/register', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
  },

  async logout(): Promise<void> {
    await request('/auth/logout', { method: 'POST' });
  },

  usage(): Promise<UsageSummary> {
    return requestJson<UsageSummary>('/usage');
  },
};
