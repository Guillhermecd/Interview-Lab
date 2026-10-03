import { InvalidEnvError, parseInteger, requireValue } from './env-parsers.js';

const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_JWT_EXPIRES_IN_SECONDS = 86_400;
const MAX_JWT_EXPIRES_IN_SECONDS = 30 * 86_400;
const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5173';
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

const DEFAULT_QUESTIONS_PER_MINUTE = 10;
const DEFAULT_DAILY_TOKEN_QUOTA = 200_000;
const DEFAULT_LOGIN_ATTEMPTS_PER_MINUTE = 5;
const DEFAULT_SQL_CACHE_TTL_SECONDS = 3600;
const DEFAULT_RESULT_CACHE_TTL_SECONDS = 300;
const MAX_CACHE_TTL_SECONDS = 86_400;

// Example values shipped in .env.example. The API refuses to start in
// production with them (template: environment.md, "Defaults de segurança").
const KNOWN_PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  'change-me',
  'change-me-to-a-long-random-secret-of-at-least-32-characters',
]);

export interface AuthEnv {
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  // Secure cookies need HTTPS; enabled in production.
  secureCookies: boolean;
  // Origins allowed to send requests that change data (CSRF protection).
  allowedOrigins: string[];
}

export interface RedisEnv {
  url: string;
}

export interface LimitsEnv {
  questionsPerMinute: number;
  dailyTokenQuota: number;
  loginAttemptsPerMinute: number;
  sqlCacheTtlSeconds: number;
  resultCacheTtlSeconds: number;
}

function isProduction(source: NodeJS.ProcessEnv): boolean {
  return source.NODE_ENV === 'production';
}

function loadJwtSecret(source: NodeJS.ProcessEnv): string {
  const secret = requireValue(source, 'JWT_SECRET');
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new InvalidEnvError(
      'JWT_SECRET',
      `must have at least ${String(MIN_JWT_SECRET_LENGTH)} characters`,
    );
  }
  if (isProduction(source) && KNOWN_PLACEHOLDER_SECRETS.has(secret)) {
    throw new InvalidEnvError('JWT_SECRET', 'still has the example value');
  }
  return secret;
}

function loadAllowedOrigins(source: NodeJS.ProcessEnv): string[] {
  const raw = source.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS;
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  if (origins.length === 0) {
    throw new InvalidEnvError('ALLOWED_ORIGINS', 'must list at least one origin');
  }
  return origins;
}

export function loadAuthEnv(source: NodeJS.ProcessEnv): AuthEnv {
  return {
    jwtSecret: loadJwtSecret(source),
    jwtExpiresInSeconds: parseInteger(source, 'JWT_EXPIRES_IN', {
      defaultValue: DEFAULT_JWT_EXPIRES_IN_SECONDS,
      min: 60,
      max: MAX_JWT_EXPIRES_IN_SECONDS,
    }),
    secureCookies: isProduction(source),
    allowedOrigins: loadAllowedOrigins(source),
  };
}

export function loadRedisEnv(source: NodeJS.ProcessEnv): RedisEnv {
  return { url: source.REDIS_URL || DEFAULT_REDIS_URL };
}

export function loadLimitsEnv(source: NodeJS.ProcessEnv): LimitsEnv {
  const cacheTtl = { min: 0, max: MAX_CACHE_TTL_SECONDS };
  return {
    questionsPerMinute: parseInteger(source, 'RATE_LIMIT_PER_MINUTE', {
      defaultValue: DEFAULT_QUESTIONS_PER_MINUTE,
      min: 1,
      max: 1000,
    }),
    dailyTokenQuota: parseInteger(source, 'DAILY_TOKEN_QUOTA', {
      defaultValue: DEFAULT_DAILY_TOKEN_QUOTA,
      min: 1,
      max: 100_000_000,
    }),
    loginAttemptsPerMinute: parseInteger(source, 'LOGIN_ATTEMPTS_PER_MINUTE', {
      defaultValue: DEFAULT_LOGIN_ATTEMPTS_PER_MINUTE,
      min: 1,
      max: 1000,
    }),
    // 0 disables the cache.
    sqlCacheTtlSeconds: parseInteger(source, 'SQL_CACHE_TTL_SECONDS', {
      defaultValue: DEFAULT_SQL_CACHE_TTL_SECONDS,
      ...cacheTtl,
    }),
    resultCacheTtlSeconds: parseInteger(source, 'RESULT_CACHE_TTL_SECONDS', {
      defaultValue: DEFAULT_RESULT_CACHE_TTL_SECONDS,
      ...cacheTtl,
    }),
  };
}
