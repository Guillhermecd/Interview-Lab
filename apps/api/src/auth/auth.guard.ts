import {
  createParamDecorator,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthUser } from '@interview-lab/shared';
import { AuthTokenService } from './auth-token.service.js';
import { UserRepository } from './user.repository.js';
import { SESSION_COOKIE, type CookieRequest } from './session-cookie.js';

// Lets a request through only with a valid session cookie of an existing user,
// and makes that user available to the handler (@CurrentUser()).
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
    @Inject(UserRepository) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CookieRequest>();
    const token = request.cookies[SESSION_COOKIE];
    const subject = token === undefined ? undefined : await this.tokens.verify(token);
    // A token of a deleted account is not accepted.
    const user = subject === undefined ? undefined : await this.users.findById(subject.userId);
    if (user === undefined) {
      throw new UnauthorizedException();
    }
    request.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const user = context.switchToHttp().getRequest<CookieRequest>().user;
    if (user === undefined) {
      // Only reachable if a handler uses @CurrentUser() without AuthGuard.
      throw new UnauthorizedException();
    }
    return user;
  },
);
