import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt from Node itself (D-36). Parameters follow the OWASP minimum for
// scrypt (N = 2^17, r = 8, p = 1).
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const OPTIONS: ScryptOptions = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const PREFIX = 'scrypt';

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, OPTIONS, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

// Stored as "scrypt$<salt>$<hash>", both in base64.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt);
  return [PREFIX, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, salt, hash] = stored.split('$');
  if (prefix !== PREFIX || salt === undefined || hash === undefined) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'));
  // Constant-time comparison: the time taken does not reveal how much matched.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
