import { hasSqlDetails, parseSync } from 'libpg-query';
import { AstValidator, isAstObject, type AstObject } from './ast-validator.js';
import { SqlGuardError } from './sql-guard-error.js';

export interface SqlGuardLimits {
  // Rows the caller is allowed to receive.
  maxRows: number;
  maxJoins: number;
}

export interface GuardedQuery {
  // The exact text to execute. It is the only SQL the guard vouches for.
  sql: string;
  // True when the guard added or tightened the LIMIT.
  limitRewritten: boolean;
}

interface ParsedSelect {
  select: AstObject;
  // The statement exactly as written, without the trailing semicolon.
  text: string;
}

type TopLevelLimit = 'within' | 'absent' | 'above';

const WRAPPER_ALIAS = 'limited_query';

// Counted over the whole query: JOIN keywords plus comma-separated FROM items (D-23).
export const MAX_JOINS = 5;

function readStatements(sql: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = parseSync(sql);
  } catch (error) {
    if (hasSqlDetails(error)) {
      throw new SqlGuardError('SYNTAX_ERROR', `Erro de sintaxe no SQL: ${error.message}`);
    }
    // The parser also fails, without position details, on input it cannot
    // handle at all (for instance nesting deeper than its stack allows).
    throw new SqlGuardError('SYNTAX_ERROR', 'Não foi possível analisar o SQL informado.');
  }

  return isAstObject(parsed) && Array.isArray(parsed.stmts) ? parsed.stmts : [];
}

// stmt_location and stmt_len are byte offsets, so the slice is done on bytes.
function statementText(sql: string, rawStatement: AstObject): string {
  const bytes = Buffer.from(sql, 'utf8');
  const start = typeof rawStatement.stmt_location === 'number' ? rawStatement.stmt_location : 0;
  const length =
    typeof rawStatement.stmt_len === 'number' ? rawStatement.stmt_len : bytes.length - start;
  return bytes
    .subarray(start, start + length)
    .toString('utf8')
    .trim();
}

function parseSingleSelect(sql: string): ParsedSelect {
  if (sql.trim() === '') {
    throw new SqlGuardError('EMPTY_QUERY', 'Nenhuma consulta SQL foi informada.');
  }

  const statements = readStatements(sql);
  if (statements.length === 0) {
    throw new SqlGuardError('EMPTY_QUERY', 'Nenhuma consulta SQL foi informada.');
  }
  if (statements.length > 1) {
    throw new SqlGuardError(
      'MULTIPLE_STATEMENTS',
      'Apenas um comando SQL é permitido por consulta.',
    );
  }

  const rawStatement = statements[0];
  const statement = isAstObject(rawStatement) ? rawStatement.stmt : undefined;
  const select = isAstObject(statement) ? statement.SelectStmt : undefined;
  if (!isAstObject(rawStatement) || !isAstObject(select)) {
    throw new SqlGuardError('NOT_A_SELECT', 'Apenas consultas SELECT são permitidas.');
  }

  return { select, text: statementText(sql, rawStatement) };
}

function invalidLimit(): SqlGuardError {
  return new SqlGuardError(
    'INVALID_LIMIT',
    'O LIMIT da consulta precisa ser um número inteiro literal não negativo, sem WITH TIES.',
  );
}

// Looks only at the outermost SELECT: that is the one deciding how many rows
// reach the application.
function classifyTopLevelLimit(select: AstObject, maxRows: number): TopLevelLimit {
  if (select.limitOption === 'LIMIT_OPTION_WITH_TIES') {
    throw invalidLimit();
  }
  if (select.limitCount === undefined) {
    return 'absent';
  }

  const constant = isAstObject(select.limitCount) ? select.limitCount.A_Const : undefined;
  if (!isAstObject(constant)) {
    throw invalidLimit();
  }
  // LIMIT ALL and LIMIT NULL mean "no limit".
  if (constant.isnull === true) {
    return 'above';
  }
  // A literal too large for an integer is parsed as a float.
  if (isAstObject(constant.fval)) {
    return 'above';
  }
  if (!isAstObject(constant.ival)) {
    throw invalidLimit();
  }
  // The parser omits the value when it is zero.
  const value = typeof constant.ival.ival === 'number' ? constant.ival.ival : 0;
  if (value < 0) {
    throw invalidLimit();
  }
  return value <= maxRows ? 'within' : 'above';
}

// Second security layer (the first is the read-only database role): refuses
// any SQL that is not a single, read-only SELECT over the exposed tables.
// Requires libpg-query's loadModule() to have completed.
export class SqlGuard {
  // One row more than the caller may receive, so the executor can still tell
  // "exactly maxRows" from "there was more".
  private readonly fetchLimit: number;

  constructor(private readonly limits: SqlGuardLimits) {
    this.fetchLimit = limits.maxRows + 1;
  }

  validate(sql: string): GuardedQuery {
    const { select, text } = this.parseAndValidate(sql);

    const limit = classifyTopLevelLimit(select, this.limits.maxRows);
    if (limit === 'within') {
      // `text` is a slice of the input, so it is validated on its own as well:
      // every string this method returns has been through the guard as-is.
      if (!this.isSafeRewrite(text)) {
        throw invalidLimit();
      }
      return { sql: text, limitRewritten: false };
    }
    return { sql: this.rewriteLimit(text, limit), limitRewritten: true };
  }

  // The exposed tables a query reads, in the order they first appear. The
  // query goes through the same validation as validate(): an invalid one throws.
  tablesOf(sql: string): string[] {
    const validator = new AstValidator(this.limits.maxJoins);
    validator.validateSelect(parseSingleSelect(sql).select);
    return [...validator.tables];
  }

  private parseAndValidate(sql: string): ParsedSelect {
    const parsed = parseSingleSelect(sql);
    new AstValidator(this.limits.maxJoins).validateSelect(parsed.select);
    return parsed;
  }

  // The user's text is kept as written and the LIMIT is added around it. The
  // newlines keep a trailing "-- comment" from swallowing what is appended.
  private rewriteLimit(text: string, limit: 'absent' | 'above'): string {
    const limitClause = `LIMIT ${String(this.fetchLimit)}`;
    const candidates =
      limit === 'absent'
        ? [`${text}\n${limitClause}`, this.wrap(text, limitClause)]
        : [this.wrap(text, limitClause)];

    for (const candidate of candidates) {
      if (this.isSafeRewrite(candidate)) {
        return candidate;
      }
    }
    throw invalidLimit();
  }

  private wrap(text: string, limitClause: string): string {
    return `SELECT * FROM (\n${text}\n) AS ${WRAPPER_ALIAS}\n${limitClause}`;
  }

  // The rewritten text is what will run, so it goes through the whole guard
  // again and must come out with an effective top-level LIMIT.
  private isSafeRewrite(candidate: string): boolean {
    try {
      const { select } = this.parseAndValidate(candidate);
      return classifyTopLevelLimit(select, this.fetchLimit) === 'within';
    } catch (error) {
      if (error instanceof SqlGuardError) {
        return false;
      }
      throw error;
    }
  }
}
