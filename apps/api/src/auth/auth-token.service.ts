import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import type { AuthEnv } from '../config/security-env.js';

export const AUTH_ENV = Symbol('AUTH_ENV');

const ALGORITHM = 'HS256';
const ISSUER = 'interview-lab';

export interface TokenSubject {
  userId: string;
}

// Signs and checks the session JWT (D-08). The token carries only the user id;
// everything else is read from the database when needed.
@Injectable()
export class AuthTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(AUTH_ENV) private readonly env: AuthEnv) {
    this.key = new TextEncoder().encode(env.jwtSecret);
  }

  get expiresInSeconds(): number {
    return this.env.jwtExpiresInSeconds;
  }

  sign(subject: TokenSubject): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(subject.userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${String(this.env.jwtExpiresInSeconds)}s`)
      .sign(this.key);
  }

  // Undefined for any token that is invalid, expired, tampered with or signed
  // with another algorithm.
  async verify(token: string): Promise<TokenSubject | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
      });
      return typeof payload.sub === 'string' ? { userId: payload.sub } : undefined;
    } catch {
      return undefined;
    }
  }
}
