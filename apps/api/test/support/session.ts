import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export const TEST_PASSWORD = 'senha-de-teste-123';
const SESSION_COOKIE = 'interview_lab_session';

interface InjectOptions {
  method: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

// Creates an account through the API and returns its session cookie, ready to
// be sent in a Cookie header.
export async function registerUser(
  app: NestFastifyApplication,
  email: string,
  name = 'Pessoa de Teste',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name, email, password: TEST_PASSWORD },
  });
  const cookie = response.cookies.find((item) => item.name === SESSION_COOKIE);
  if (response.statusCode !== 201 || cookie === undefined) {
    throw new Error(`Registration failed: ${String(response.statusCode)} ${response.body}`);
  }
  return `${cookie.name}=${cookie.value}`;
}

// Makes every app.inject() call of this app carry the session cookie (unless the
// call sets its own Cookie header), so tests
// written before authentication keep reading as they did.
export function sendCookieOnEveryRequest(app: NestFastifyApplication, cookie: string): void {
  const inject = app.inject.bind(app) as (options: InjectOptions) => ReturnType<typeof app.inject>;
  const withCookie = (options: InjectOptions) =>
    inject({ ...options, headers: { cookie, ...options.headers } });
  Object.assign(app, { inject: withCookie });
}
