// Reads the plan PostgreSQL would use for a query (EXPLAIN without ANALYZE) and
// decides whether it is too expensive to run (D-65). The LIMIT caps the rows
// returned, not the work done to produce them; this looks at the work.
//
// It is a heuristic on the planner's estimates, which can be wrong both ways:
// the statement timeout remains what actually stops a query.

// A join with no condition is only refused from this many estimated rows on:
// small ones are legitimate (every region against every month).
export const CARTESIAN_MAX_ROWS = 1_000_000;

export interface PlanLimits {
  maxCost: number;
}

export interface PlanVerdict {
  // The estimated total cost of the query, in the planner's units.
  totalCost: number;
  // Why the query must not run; absent when it may.
  refusal?: string;
}

interface PlanNode {
  'Node Type': string;
  'Total Cost': number;
  'Plan Rows': number;
  'Join Filter'?: string;
  'Index Cond'?: string;
  'Recheck Cond'?: string;
  'TID Cond'?: string;
  Plans?: PlanNode[];
}

// Nodes that only hold the rows of the node below them.
const PASS_THROUGH_NODES: ReadonlySet<string> = new Set(['Materialize', 'Memoize']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlanNode(value: unknown): value is PlanNode {
  return (
    isObject(value) &&
    typeof value['Node Type'] === 'string' &&
    typeof value['Total Cost'] === 'number' &&
    typeof value['Plan Rows'] === 'number' &&
    (value.Plans === undefined || (Array.isArray(value.Plans) && value.Plans.every(isPlanNode)))
  );
}

// EXPLAIN (FORMAT JSON) answers one row with one column: [{ "Plan": {...} }].
function rootOf(explainOutput: unknown): PlanNode {
  const parsed: unknown =
    typeof explainOutput === 'string' ? (JSON.parse(explainOutput) as unknown) : explainOutput;
  const first: unknown = Array.isArray(parsed) ? parsed[0] : undefined;
  const plan = isObject(first) ? first.Plan : undefined;
  if (!isPlanNode(plan)) {
    throw new Error('Unexpected EXPLAIN output');
  }
  return plan;
}

// The inner side of a nested loop looks its rows up by the outer row: the
// join condition is there, as the condition of an index or TID scan.
function isLookup(node: PlanNode): boolean {
  if (PASS_THROUGH_NODES.has(node['Node Type'])) {
    const below = node.Plans?.[0];
    return below !== undefined && isLookup(below);
  }
  return (
    node['Index Cond'] !== undefined ||
    node['Recheck Cond'] !== undefined ||
    node['TID Cond'] !== undefined
  );
}

// A nested loop that pairs every outer row with every inner row.
function isCartesian(node: PlanNode): boolean {
  if (node['Node Type'] !== 'Nested Loop' || node['Join Filter'] !== undefined) {
    return false;
  }
  const inner = node.Plans?.[1];
  return inner !== undefined && !isLookup(inner);
}

function largestCartesian(node: PlanNode): number {
  const own = isCartesian(node) ? node['Plan Rows'] : 0;
  return Math.max(own, ...(node.Plans ?? []).map(largestCartesian));
}

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

// The reasons are written for two readers, like the guard's: the user, and the
// LLM that has to write a cheaper query.
export function assessPlan(explainOutput: unknown, limits: PlanLimits): PlanVerdict {
  const root = rootOf(explainOutput);
  const totalCost = root['Total Cost'];

  const cartesianRows = largestCartesian(root);
  if (cartesianRows > CARTESIAN_MAX_ROWS) {
    return {
      totalCost,
      refusal:
        `A consulta combina tabelas sem condição de junção (produto cartesiano de cerca de ` +
        `${numberFormat.format(cartesianRows)} linhas). Relacione as tabelas com JOIN ... ON ` +
        `pelas chaves.`,
    };
  }
  if (totalCost > limits.maxCost) {
    return {
      totalCost,
      refusal:
        `O custo estimado da consulta (${numberFormat.format(totalCost)}) passa do limite ` +
        `permitido (${numberFormat.format(limits.maxCost)}). Reduza o período, filtre mais ` +
        `ou use menos tabelas.`,
    };
  }
  return { totalCost };
}
