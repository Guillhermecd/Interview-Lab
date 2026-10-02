import { types } from 'pg';

const UNKNOWN_TYPE = 'unknown';

const TYPE_NAME_BY_OID = new Map<number, string>(
  Object.entries(types.builtins).map(([name, oid]) => [oid, name.toLowerCase()]),
);

// Covers PostgreSQL's built-in scalar types. Arrays, enums and other
// user-defined types are reported as "unknown".
export function columnTypeName(dataTypeId: number): string {
  return TYPE_NAME_BY_OID.get(dataTypeId) ?? UNKNOWN_TYPE;
}
