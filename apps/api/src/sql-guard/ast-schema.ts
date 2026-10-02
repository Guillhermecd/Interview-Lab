// The shape of the PostgreSQL parse tree the guard is willing to walk.
//
// This is an allowlist in two levels: node types, and fields inside each node
// type. A node type or a field that is not listed here makes the guard reject
// the query. Listing fields matters because some dangerous clauses are not
// nodes of their own but plain fields: SELECT ... INTO is `intoClause`, FOR
// UPDATE is `lockingClause`, a recursive CTE is a flag on `withClause`.
//
// Field kinds:
//   scalar           string, number or boolean; never walked
//   node             a wrapped node: { NodeType: { ...fields } }
//   nodes            an array of wrapped nodes
//   { struct: T }    the fields of node type T, without the wrapper

export type FieldKind = 'scalar' | 'node' | 'nodes' | { struct: string };

export type NodeFields = Readonly<Record<string, FieldKind>>;

// Constants and identifiers. They cannot contain other nodes and are not walked.
export const LEAF_NODES: ReadonlySet<string> = new Set([
  'A_Const',
  'A_Star',
  'String',
  'Integer',
  'Float',
  'Boolean',
]);

export const NODE_FIELDS: Readonly<Record<string, NodeFields>> = {
  SelectStmt: {
    distinctClause: 'nodes',
    targetList: 'nodes',
    fromClause: 'nodes',
    whereClause: 'node',
    groupClause: 'nodes',
    groupDistinct: 'scalar',
    havingClause: 'node',
    windowClause: 'nodes',
    valuesLists: 'nodes',
    sortClause: 'nodes',
    limitOffset: 'node',
    limitCount: 'node',
    limitOption: 'scalar',
    withClause: { struct: 'WithClause' },
    op: 'scalar',
    all: 'scalar',
    larg: { struct: 'SelectStmt' },
    rarg: { struct: 'SelectStmt' },
  },
  WithClause: {
    ctes: 'nodes',
    location: 'scalar',
  },
  CommonTableExpr: {
    ctename: 'scalar',
    aliascolnames: 'nodes',
    ctematerialized: 'scalar',
    ctequery: 'node',
    location: 'scalar',
  },
  ResTarget: {
    name: 'scalar',
    indirection: 'nodes',
    val: 'node',
    location: 'scalar',
  },
  ColumnRef: {
    fields: 'nodes',
    location: 'scalar',
  },
  A_Expr: {
    kind: 'scalar',
    name: 'nodes',
    lexpr: 'node',
    rexpr: 'node',
    location: 'scalar',
  },
  BoolExpr: {
    boolop: 'scalar',
    args: 'nodes',
    location: 'scalar',
  },
  NullTest: {
    arg: 'node',
    nulltesttype: 'scalar',
    location: 'scalar',
  },
  BooleanTest: {
    arg: 'node',
    booltesttype: 'scalar',
    location: 'scalar',
  },
  CaseExpr: {
    arg: 'node',
    args: 'nodes',
    defresult: 'node',
    location: 'scalar',
  },
  CaseWhen: {
    expr: 'node',
    result: 'node',
    location: 'scalar',
  },
  CoalesceExpr: {
    args: 'nodes',
    location: 'scalar',
  },
  MinMaxExpr: {
    op: 'scalar',
    args: 'nodes',
    location: 'scalar',
  },
  FuncCall: {
    funcname: 'nodes',
    args: 'nodes',
    agg_order: 'nodes',
    agg_filter: 'node',
    over: { struct: 'WindowDef' },
    agg_within_group: 'scalar',
    agg_star: 'scalar',
    agg_distinct: 'scalar',
    funcformat: 'scalar',
    location: 'scalar',
  },
  WindowDef: {
    name: 'scalar',
    refname: 'scalar',
    partitionClause: 'nodes',
    orderClause: 'nodes',
    frameOptions: 'scalar',
    startOffset: 'node',
    endOffset: 'node',
    location: 'scalar',
  },
  SortBy: {
    node: 'node',
    sortby_dir: 'scalar',
    sortby_nulls: 'scalar',
    location: 'scalar',
  },
  TypeCast: {
    arg: 'node',
    typeName: { struct: 'TypeName' },
    location: 'scalar',
  },
  TypeName: {
    names: 'nodes',
    typmods: 'nodes',
    typemod: 'scalar',
    location: 'scalar',
  },
  RangeVar: {
    schemaname: 'scalar',
    relname: 'scalar',
    inh: 'scalar',
    relpersistence: 'scalar',
    alias: { struct: 'Alias' },
    location: 'scalar',
  },
  Alias: {
    aliasname: 'scalar',
    colnames: 'nodes',
  },
  JoinExpr: {
    jointype: 'scalar',
    isNatural: 'scalar',
    larg: 'node',
    rarg: 'node',
    usingClause: 'nodes',
    join_using_alias: { struct: 'Alias' },
    quals: 'node',
    alias: { struct: 'Alias' },
    rtindex: 'scalar',
  },
  RangeSubselect: {
    lateral: 'scalar',
    subquery: 'node',
    alias: { struct: 'Alias' },
  },
  RangeFunction: {
    lateral: 'scalar',
    ordinality: 'scalar',
    functions: 'nodes',
    alias: { struct: 'Alias' },
  },
  SubLink: {
    subLinkType: 'scalar',
    testexpr: 'node',
    operName: 'nodes',
    subselect: 'node',
    location: 'scalar',
  },
  A_ArrayExpr: {
    elements: 'nodes',
    location: 'scalar',
  },
  RowExpr: {
    args: 'nodes',
    row_format: 'scalar',
    location: 'scalar',
  },
  List: {
    items: 'nodes',
  },
  SQLValueFunction: {
    op: 'scalar',
    typmod: 'scalar',
    location: 'scalar',
  },
  GroupingSet: {
    kind: 'scalar',
    content: 'nodes',
    location: 'scalar',
  },
};
