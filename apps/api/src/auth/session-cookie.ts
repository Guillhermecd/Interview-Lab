import type { AuthUser } from '@interview-lab/shared';

export const SESSION_COOKIE = 'interview_lab_session';

// The parts of the Fastify request and reply used to read and write the
// session cookie (with @fastify/cookie registered).
export interface CookieRequest {
  cookies: Record<string, string | undefined>;
  // Set by AuthGuard for the rest of the request.
  user?: AuthUser;
  headers: Record<string, string | string[] | undefined>;
  method: string;
}

export interface CookieReply {
  setCookie: (name: string, value: string, options: Record<string, unknown>) => unknown;
  clearCookie: (name: string, options: Record<string, unknown>) => unknown;
}

// HttpOnly: unreadable by page scripts. SameSite=Strict: never sent on requests
// started by other sites (D-08). Path /api: not sent with static files.
export function sessionCookieOptions(secure: boolean, maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/api',
    ...(maxAgeSeconds !== undefined && { maxAge: maxAgeSeconds }),
  } as const;
}
