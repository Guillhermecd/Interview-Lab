import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { CookieRequest } from './session-cookie.js';

// Lets through only users allowed to manage the registry (D-56). Used after
// AuthGuard, which loads the user from the database on every request: a
// promotion or demotion takes effect at once, whatever the session cookie says.
@Injectable()
export class CatalogAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<CookieRequest>().user;
    if (user?.canManageCatalog !== true) {
      throw new ForbiddenException();
    }
    return true;
  }
}
