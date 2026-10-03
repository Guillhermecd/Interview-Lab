import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { EXPOSED_SCHEMA, EXPOSED_TABLES } from '../sql-guard/allowlists.js';
import { READONLY_POOL } from './query.tokens.js';

export interface ColumnDescription {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableDescription {
  name: string;
  columns: ColumnDescription[];
  // Primary key, foreign keys and CHECK constraints, as PostgreSQL prints them.
  constraints: string[];
}

export interface SchemaDescription {
  tables: TableDescription[];
  // Changes whenever a table, column or constraint changes; part of every cache
  // key, so a schema change invalidates the cache (D-07b).
  version: string;
}

const VERSION_LENGTH = 16;

export function schemaVersion(tables: TableDescription[]): string {
  return createHash('sha256').update(JSON.stringify(tables)).digest('hex').slice(0, VERSION_LENGTH);
}

const COLUMNS_SQL = `
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         format_type(a.atttypid, a.atttypmod) AS data_type,
         NOT a.attnotnull AS nullable
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relname = ANY ($2) AND c.relkind = 'r'
    AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum`;

const CONSTRAINTS_SQL = `
  SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relname = ANY ($2) AND con.contype IN ('p', 'f', 'c')
  ORDER BY c.relname, con.contype DESC, con.conname`;

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  nullable: boolean;
}

interface ConstraintRow {
  table_name: string;
  definition: string;
}

// Describes the exposed tables as they exist in the database, to give the LLM
// the context it needs to write SQL. It reads the system catalog, which the
// SQL guard forbids to user queries, so it runs fixed statements on the pool
// and exposes nothing but the description.
@Injectable()
export class SchemaCatalog {
  private description: Promise<SchemaDescription> | undefined;

  constructor(@Inject(READONLY_POOL) private readonly pool: Pool) {}

  // The schema only changes through migrations, so it is read once per process.
  describe(): Promise<SchemaDescription> {
    this.description ??= this.load().catch((error: unknown) => {
      // A failed load must not be cached: the next call tries again.
      this.description = undefined;
      throw error;
    });
    return this.description;
  }

  private async load(): Promise<SchemaDescription> {
    const parameters = [EXPOSED_SCHEMA, [...EXPOSED_TABLES]];
    const [columns, constraints] = await Promise.all([
      this.pool.query<ColumnRow>(COLUMNS_SQL, parameters),
      this.pool.query<ConstraintRow>(CONSTRAINTS_SQL, parameters),
    ]);

    const tables = new Map<string, TableDescription>();
    for (const row of columns.rows) {
      const table = tables.get(row.table_name) ?? {
        name: row.table_name,
        columns: [],
        constraints: [],
      };
      table.columns.push({ name: row.column_name, type: row.data_type, nullable: row.nullable });
      tables.set(row.table_name, table);
    }
    for (const row of constraints.rows) {
      tables.get(row.table_name)?.constraints.push(row.definition);
    }

    const described = [...tables.values()];
    return { tables: described, version: schemaVersion(described) };
  }
}
