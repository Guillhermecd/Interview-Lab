import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthUser, LoginRequest, RegisterRequest } from '@interview-lab/shared';
import { UsageService } from '../limits/usage.service.js';
import { hashPassword, verifyPassword } from './password.js';
import { EmailInUseError, UserRepository } from './user.repository.js';

// A hash of a random password, compared against when the email does not exist,
// so a failed login takes the same time whether the account exists or not.
const DUMMY_HASH_PASSWORD = 'not-a-real-password';

export class AuthError extends HttpException {
  constructor(code: 'INVALID_CREDENTIALS' | 'EMAIL_IN_USE') {
    super(
      code === 'INVALID_CREDENTIALS'
        ? { code, message: 'E-mail ou senha incorretos.' }
        : { code, message: 'Já existe uma conta com este e-mail.' },
      code === 'INVALID_CREDENTIALS' ? HttpStatus.UNAUTHORIZED : HttpStatus.CONFLICT,
    );
  }
}

@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(UsageService) private readonly usage: UsageService,
  ) {}

  async register(input: RegisterRequest): Promise<AuthUser> {
    try {
      return await this.users.create({
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
      });
    } catch (error) {
      if (error instanceof EmailInUseError) {
        throw new AuthError('EMAIL_IN_USE');
      }
      throw error;
    }
  }

  // Wrong email and wrong password get the same answer, so the response does
  // not reveal which accounts exist. Attempts per email are rate limited.
  async login(input: LoginRequest): Promise<AuthUser> {
    await this.usage.assertCanTryLogin(input.email);
    const user = await this.users.findByEmail(input.email);
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash ?? (await this.dummyPasswordHash()),
    );
    if (user === undefined || !valid) {
      throw new AuthError('INVALID_CREDENTIALS');
    }
    return { id: user.id, email: user.email, name: user.name };
  }

  findUser(userId: string): Promise<AuthUser | undefined> {
    return this.users.findById(userId);
  }

  private dummyPasswordHash(): Promise<string> {
    this.dummyHash ??= hashPassword(DUMMY_HASH_PASSWORD);
    return this.dummyHash;
  }
}
