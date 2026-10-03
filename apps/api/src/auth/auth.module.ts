import { Module, type DynamicModule } from '@nestjs/common';
import type { AuthEnv } from '../config/security-env.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AUTH_ENV, AuthTokenService } from './auth-token.service.js';
import { OriginGuard } from './origin.guard.js';
import { UserRepository } from './user.repository.js';

// Global so any controller can use @UseGuards(AuthGuard).
@Module({})
export class AuthModule {
  static register(env: AuthEnv): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_ENV, useValue: env },
        AuthTokenService,
        UserRepository,
        AuthService,
        AuthGuard,
        OriginGuard,
      ],
      exports: [AUTH_ENV, AuthTokenService, UserRepository, AuthGuard, OriginGuard],
    };
  }
}
