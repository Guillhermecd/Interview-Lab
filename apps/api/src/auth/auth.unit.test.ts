import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { AuthEnv } from '../config/security-env.js';
import { AuthTokenService } from './auth-token.service.js';
import { OriginGuard } from './origin.guard.js';
import { hashPassword, verifyPassword } from './password.js';

const ENV: AuthEnv = {
  jwtSecret: 'unit-test-secret-with-at-least-32-chars',
  jwtExpiresInSeconds: 3600,
  secureCookies: false,
  allowedOrigins: ['http://localhost:5173'],
};

describe('password hashing', () => {
  it('verifies the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');

    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct horse batterz', stored)).resolves.toBe(false);
  });

  it('never stores the password itself and salts every hash', async () => {
    const first = await hashPassword('mesma-senha-123');
    const second = await hashPassword('mesma-senha-123');

    expect(first).not.toContain('mesma-senha-123');
    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toBe(second);
  });

  it('refuses a malformed stored hash', async () => {
    await expect(verifyPassword('qualquer', 'md5$abc')).resolves.toBe(false);
    await expect(verifyPassword('qualquer', 'garbage')).resolves.toBe(false);
  });
});

describe('AuthTokenService', () => {
  const tokens = new AuthTokenService(ENV);

  it('round-trips the user id', async () => {
    const token = await tokens.sign({ userId: 'user-1' });

    await expect(tokens.verify(token)).resolves.toEqual({ userId: 'user-1' });
  });

  it('refuses a token signed with another secret', async () => {
    const other = new AuthTokenService({
      ...ENV,
      jwtSecret: 'another-secret-also-with-32-characters',
    });

    await expect(tokens.verify(await other.sign({ userId: 'user-1' }))).resolves.toBeUndefined();
  });

  it('refuses a tampered token', async () => {
    const token = await tokens.sign({ userId: 'user-1' });
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url');

    await expect(
      tokens.verify(`${String(header)}.${forgedPayload}.${String(signature)}`),
    ).resolves.toBeUndefined();
  });

  it('refuses an expired token', async () => {
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('interview-lab')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(ENV.jwtSecret));

    await expect(tokens.verify(expired)).resolves.toBeUndefined();
  });

  it('refuses an unsigned token (alg: none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        iss: 'interview-lab',
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');

    await expect(tokens.verify(`${header}.${payload}.`)).resolves.toBeUndefined();
  });

  it('refuses garbage', async () => {
    await expect(tokens.verify('not-a-jwt')).resolves.toBeUndefined();
  });
});

describe('OriginGuard', () => {
  const guard = new OriginGuard(ENV);

  function contextFor(method: string, origin?: string): ExecutionContext {
    const request = { method, headers: origin === undefined ? {} : { origin }, cookies: {} };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through from any origin', (method) => {
    expect(guard.canActivate(contextFor(method, 'https://evil.example'))).toBe(true);
  });

  it('lets a change through from an allowed origin', () => {
    expect(guard.canActivate(contextFor('POST', 'http://localhost:5173'))).toBe(true);
  });

  it('lets a change through without Origin (not a browser page)', () => {
    expect(guard.canActivate(contextFor('POST'))).toBe(true);
  });

  it.each([
    ['another site', 'https://evil.example'],
    ['a similar host', 'http://localhost:5173.evil.example'],
    ['another port', 'http://localhost:5174'],
    ['the null origin', 'null'],
  ])('refuses a change from %s', (_case, origin) => {
    expect(() => guard.canActivate(contextFor('POST', origin))).toThrow(ForbiddenException);
  });
});
