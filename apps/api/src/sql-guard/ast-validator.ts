import {
  ALLOWED_FUNCTIONS,
  ALLOWED_SQL_VALUE_FUNCTIONS,
  ALLOWED_TYPES,
  EXPOSED_SCHEMA,
  EXPOSED_TABLES,
  SYSTEM_SCHEMA,
} from './allowlists.js';
import { LEAF_NODES, NODE_FIELDS, type FieldKind } from './ast-schema.js';
import { SqlGuardError } from './sql-guard-error.js';

export type AstObject = Record<string, unknown>;

// CTE names visible at a point of the query.
type Scope = ReadonlySet<string>;

const MAX_DEPTH = 150;
const SYSTEM_NAME_PREFIX = 'pg_';

const DATA_CHANGING_STATEMENTS: ReadonlySet<string> = new Set([
  'InsertStmt',
  'UpdateStmt',
  'DeleteStmt',
  'MergeStmt',
]);

// Clearer reasons for the rejections a user or the LLM is most likely to hit.
const UNSUPPORTED_FIELD_REASONS: Readonly<Record<string, string>> = {
  'SelectStmt.intoClause': 'SELECT ... INTO não é permitido.',
  'SelectStmt.lockingClause': 'FOR UPDATE / FOR SHARE não é permitido.',
  'WithClause.recursive': 'WITH RECURSIVE não é permitido.',
  'RangeVar.catalogname': 'Referência a outro banco de dados não é permitida.',
};

export function isAstObject(value: unknown): value is AstObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyObject(value: unknown): boolean {
  return isAstObject(value) && Object.keys(value).length === 0;
}

function unsupported(construct: string): SqlGuardError {
  return new SqlGuardError(
    'UNSUPPORTED_CONSTRUCT',
    UNSUPPORTED_FIELD_REASONS[construct] ?? `Construção SQL não suportada: ${construct}.`,
  );
}

// Reads a name made of String nodes, such as a function, type or operator name.
function readNameParts(value: unknown, owner: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw unsupported(owner);
  }
  return value.map((part: unknown) => {
    const text = isAstObject(part) && isAstObject(part.String) ? part.String.sval : undefined;
    if (typeof text !== 'string') {
      throw unsupported(owner);
    }
    return text;
  });
}

// Accepts `name` or `pg_catalog.name`; returns the bare name.
function readSystemName(value: unknown, owner: string): string | undefined {
  const parts = readNameParts(value, owner);
  if (parts.length === 1) {
    return parts[0];
  }
  if (parts.length === 2 && parts[0] === SYSTEM_SCHEMA) {
    return parts[1];
  }
  return undefined;
}

// Walks the whole parse tree and rejects anything that is not explicitly
// allowed. It never inspects the SQL text, only the tree built by the parser.
export class AstValidator {
  private joinCount = 0;
  private depth = 0;

  constructor(private readonly maxJoins: number) {}

  validateSelect(select: AstObject): void {
    this.visitStruct('SelectStmt', select, new Set());

    if (this.joinCount > this.maxJoins) {
      throw new SqlGuardError(
        'TOO_MANY_JOINS',
        `A consulta usa ${String(this.joinCount)} JOINs; o máximo permitido é ${String(this.maxJoins)}.`,
      );
    }
  }

  private visitNode(value: unknown, scope: Scope): void {
    if (!isAstObject(value)) {
      throw unsupported('nó inválido');
    }
    const entries = Object.entries(value);
    const entry = entries[0];
    if (entries.length !== 1 || entry === undefined) {
      throw unsupported('nó inválido');
    }

    const [type, fields] = entry;
    if (LEAF_NODES.has(type)) {
      return;
    }
    if (DATA_CHANGING_STATEMENTS.has(type)) {
      throw new SqlGuardError('NOT_A_SELECT', 'Apenas consultas SELECT são permitidas.');
    }
    if (!isAstObject(fields)) {
      throw unsupported(type);
    }
    this.visitStruct(type, fields, scope);
  }

  private visitStruct(type: string, fields: AstObject, scope: Scope): void {
    const schema = NODE_FIELDS[type];
    if (schema === undefined) {
      throw unsupported(type);
    }

    this.depth += 1;
    if (this.depth > MAX_DEPTH) {
      throw new SqlGuardError('QUERY_TOO_COMPLEX', 'A consulta tem níveis de aninhamento demais.');
    }

    this.checkNode(type, fields, scope);
    const innerScope = type === 'SelectStmt' ? this.enterWithClause(fields, scope) : scope;

    for (const [name, value] of Object.entries(fields)) {
      const kind = schema[name];
      if (kind === undefined) {
        throw unsupported(`${type}.${name}`);
      }
      // The WITH clause was walked by enterWithClause, CTE by CTE.
      if (type === 'SelectStmt' && name === 'withClause') {
        continue;
      }
      this.visitField(`${type}.${name}`, kind, value, innerScope);
    }

    this.depth -= 1;
  }

  private visitField(path: string, kind: FieldKind, value: unknown, scope: Scope): void {
    if (kind === 'scalar') {
      if (typeof value === 'object' && value !== null) {
        throw unsupported(path);
      }
      return;
    }
    if (kind === 'node') {
      this.visitNode(value, scope);
      return;
    }
    if (kind === 'nodes') {
      if (!Array.isArray(value)) {
        throw unsupported(path);
      }
      for (const item of value) {
        // The parser uses {} as a placeholder (e.g. DISTINCT without ON).
        if (!isEmptyObject(item)) {
          this.visitNode(item, scope);
        }
      }
      return;
    }
    if (!isAstObject(value)) {
      throw unsupported(path);
    }
    this.visitStruct(kind.struct, value, scope);
  }

  // Each CTE sees only the CTEs declared before it; the body of the SELECT sees
  // all of them. Tracking this exactly matters: a name that is a CTE in one
  // place and unknown in another would otherwise be resolved by PostgreSQL to
  // a real relation.
  private enterWithClause(select: AstObject, outerScope: Scope): Scope {
    const withClause = select.withClause;
    if (withClause === undefined) {
      return outerScope;
    }
    if (!isAstObject(withClause)) {
      throw unsupported('SelectStmt.withClause');
    }
    for (const name of Object.keys(withClause)) {
      if (NODE_FIELDS.WithClause?.[name] === undefined) {
        throw unsupported(`WithClause.${name}`);
      }
    }
    if (!Array.isArray(withClause.ctes)) {
      throw unsupported('WithClause.ctes');
    }

    const scope = new Set(outerScope);
    for (const cte of withClause.ctes) {
      const fields = isAstObject(cte) ? cte.CommonTableExpr : undefined;
      if (!isAstObject(fields) || typeof fields.ctename !== 'string') {
        throw unsupported('WithClause.ctes');
      }
      if (fields.ctename.toLowerCase().startsWith(SYSTEM_NAME_PREFIX)) {
        throw new SqlGuardError(
          'TABLE_NOT_ALLOWED',
          `O nome de CTE "${fields.ctename}" não é permitido: não pode começar com "pg_".`,
        );
      }
      this.visitStruct('CommonTableExpr', fields, new Set(scope));
      scope.add(fields.ctename);
    }
    return scope;
  }

  private checkNode(type: string, fields: AstObject, scope: Scope): void {
    switch (type) {
      case 'SelectStmt':
        this.countImplicitJoins(fields);
        break;
      case 'JoinExpr':
        this.joinCount += 1;
        break;
      case 'RangeVar':
        this.checkTable(fields, scope);
        break;
      case 'FuncCall':
        this.checkFunction(fields);
        break;
      case 'TypeName':
        this.checkType(fields);
        break;
      case 'SQLValueFunction':
        this.checkSqlValueFunction(fields);
        break;
      case 'A_Expr':
        this.checkOperator(fields.name, 'A_Expr.name');
        break;
      case 'SubLink':
        if (fields.operName !== undefined) {
          this.checkOperator(fields.operName, 'SubLink.operName');
        }
        break;
      case 'CommonTableExpr':
        this.checkCteQuery(fields);
        break;
    }
  }

  // "FROM a, b, c" joins three relations without a single JOIN keyword.
  private countImplicitJoins(select: AstObject): void {
    if (Array.isArray(select.fromClause) && select.fromClause.length > 1) {
      this.joinCount += select.fromClause.length - 1;
    }
  }

  private checkTable(rangeVar: AstObject, scope: Scope): void {
    const { schemaname, relname } = rangeVar;
    if (typeof relname !== 'string') {
      throw unsupported('RangeVar.relname');
    }

    const isCteReference = schemaname === undefined && scope.has(relname);
    const schemaAllowed = schemaname === undefined || schemaname === EXPOSED_SCHEMA;
    if (isCteReference || (schemaAllowed && EXPOSED_TABLES.has(relname))) {
      return;
    }

    const qualifiedName = typeof schemaname === 'string' ? `${schemaname}.${relname}` : relname;
    throw new SqlGuardError(
      'TABLE_NOT_ALLOWED',
      `A tabela "${qualifiedName}" não está disponível para consulta. ` +
        `Tabelas disponíveis: ${[...EXPOSED_TABLES].join(', ')}.`,
    );
  }

  private checkFunction(funcCall: AstObject): void {
    const parts = readNameParts(funcCall.funcname, 'FuncCall.funcname');
    const name = readSystemName(funcCall.funcname, 'FuncCall.funcname');
    if (name === undefined || !ALLOWED_FUNCTIONS.has(name)) {
      throw new SqlGuardError(
        'FUNCTION_NOT_ALLOWED',
        `A função "${parts.join('.')}" não é permitida.`,
      );
    }
  }

  private checkType(typeName: AstObject): void {
    const parts = readNameParts(typeName.names, 'TypeName.names');
    const name = readSystemName(typeName.names, 'TypeName.names');
    if (name === undefined || !ALLOWED_TYPES.has(name)) {
      throw new SqlGuardError(
        'TYPE_NOT_ALLOWED',
        `A conversão para o tipo "${parts.join('.')}" não é permitida.`,
      );
    }
  }

  private checkSqlValueFunction(fields: AstObject): void {
    if (typeof fields.op !== 'string' || !ALLOWED_SQL_VALUE_FUNCTIONS.has(fields.op)) {
      throw new SqlGuardError(
        'FUNCTION_NOT_ALLOWED',
        'Funções de sessão como CURRENT_USER e CURRENT_CATALOG não são permitidas.',
      );
    }
  }

  // Operators are functions too. Only built-in ones are accepted, written
  // plainly (=) or as OPERATOR(pg_catalog.=).
  private checkOperator(name: unknown, owner: string): void {
    if (readSystemName(name, owner) === undefined) {
      throw new SqlGuardError(
        'FUNCTION_NOT_ALLOWED',
        'Operadores qualificados por schema não são permitidos.',
      );
    }
  }

  private checkCteQuery(cte: AstObject): void {
    const query = cte.ctequery;
    if (!isAstObject(query) || !isAstObject(query.SelectStmt)) {
      throw new SqlGuardError('NOT_A_SELECT', 'Uma CTE só pode conter uma consulta SELECT.');
    }
  }
}
