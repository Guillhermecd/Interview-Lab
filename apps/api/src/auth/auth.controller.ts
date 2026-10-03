import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '@interview-lab/shared';
import type { AuthEnv } from '../config/security-env.js';
import { readLogin, readRegistration } from '../http/request-readers.js';
import { AuthGuard, CurrentUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AUTH_ENV, AuthTokenService } from './auth-token.service.js';
import { SESSION_COOKIE, sessionCookieOptions, type CookieReply } from './session-cookie.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
    @Inject(AUTH_ENV) private readonly env: AuthEnv,
  ) {}

  @Post('register')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<AuthUser> {
    const user = await this.auth.register(readRegistration(body));
    await this.startSession(reply, user);
    return user;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<AuthUser> {
    const user = await this.auth.login(readLogin(body));
    await this.startSession(reply, user);
    return user;
  }

  // The token is stateless (no revocation list): logging out removes the
  // cookie from this browser; the token itself expires with JWT_EXPIRES_IN.
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) reply: CookieReply): void {
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.env.secureCookies));
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  private async startSession(reply: CookieReply, user: AuthUser): Promise<void> {
    const token = await this.tokens.sign({ userId: user.id });
    reply.setCookie(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(this.env.secureCookies, this.tokens.expiresInSeconds),
    );
  }
}
