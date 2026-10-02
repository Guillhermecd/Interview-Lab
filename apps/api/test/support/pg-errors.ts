import { expect } from 'vitest';

// https://www.postgresql.org/docs/17/errcodes-appendix.html
export const PG_ERROR = {
  insufficientPrivilege: '42501',
  readOnlyTransaction: '25006',
  queryCanceled: '57014',
  undefinedTable: '42P01',
} as const;

type PgErrorCode = (typeof PG_ERROR)[keyof typeof PG_ERROR];

export async function expectPgError(query: Promise<unknown>, code: PgErrorCode): Promise<void> {
  await expect(query).rejects.toMatchObject({ code });
}
