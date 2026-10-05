import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthEnv } from '../config/security-env.js';
import { AUTH_ENV } from './auth-token.service.js';
import type { CookieRequest } from './session-cookie.js';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF protection, together with SameSite=Strict on the session cookie (D-08).
// Browsers always send Origin on requests that change data; one that comes
// from a site not in ALLOWED_ORIGINS is refused. Requests without Origin are
// not made by a browser page, so they cannot carry a victim's cookie.
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(@Inject(AUTH_ENV) env: AuthEnv) {
    this.allowed = new Set(env.allowedOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CookieRequest>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }
    const origin = request.headers.origin;
    if (origin === undefined || (typeof origin === 'string' && this.allowed.has(origin))) {
      return true;
    }
    throw new ForbiddenException();
  }
}
