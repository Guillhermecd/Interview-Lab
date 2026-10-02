import { describe, expect, it } from 'vitest';
import { columnTypeName } from './column-types.js';

const OID_INT8 = 20;
const OID_TEXT = 25;
const OID_NUMERIC = 1700;
const OID_TIMESTAMPTZ = 1184;
const OID_NOT_BUILT_IN = 999_999;

describe('columnTypeName', () => {
  it.each([
    [OID_INT8, 'int8'],
    [OID_TEXT, 'text'],
    [OID_NUMERIC, 'numeric'],
    [OID_TIMESTAMPTZ, 'timestamptz'],
  ])('names built-in type %i as %s', (oid, name) => {
    expect(columnTypeName(oid)).toBe(name);
  });

  it('reports a type it does not know as unknown', () => {
    expect(columnTypeName(OID_NOT_BUILT_IN)).toBe('unknown');
  });
});
