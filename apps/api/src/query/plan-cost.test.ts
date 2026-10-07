import { describe, expect, it } from 'vitest';
import { assessPlan, CARTESIAN_MAX_ROWS } from './plan-cost.js';

const LIMITS = { maxCost: 10_000 };

interface NodeInput {
  type: string;
  cost?: number;
  rows?: number;
  plans?: object[];
  extra?: Record<string, string>;
}

// One node of an EXPLAIN (FORMAT JSON) plan, with only what the check reads.
function node({ type, cost = 10, rows = 10, plans, extra = {} }: NodeInput): object {
  return {
    'Node Type': type,
    'Startup Cost': 0,
    'Total Cost': cost,
    'Plan Rows': rows,
    ...extra,
    ...(plans && { Plans: plans }),
  };
}

function explain(plan: object): unknown {
  return [{ Plan: plan }];
}

const seqScan = (rows: number) => node({ type: 'Seq Scan', rows });

describe('assessPlan', () => {
  it('accepts a plan under the limit and reports its cost', () => {
    const verdict = assessPlan(explain(node({ type: 'Seq Scan', cost: 425 })), LIMITS);

    expect(verdict).toEqual({ totalCost: 425 });
  });

  it('accepts a cost exactly at the limit', () => {
    expect(
      assessPlan(explain(node({ type: 'Seq Scan', cost: 10_000 })), LIMITS).refusal,
    ).toBeUndefined();
  });

  it('refuses a plan above the limit, saying both numbers', () => {
    const verdict = assessPlan(explain(node({ type: 'Aggregate', cost: 32_731_835.28 })), LIMITS);

    expect(verdict.totalCost).toBe(32_731_835.28);
    expect(verdict.refusal).toContain('custo estimado');
    expect(verdict.refusal).toContain('32.731.835');
    expect(verdict.refusal).toContain('10.000');
  });

  it('judges the cost of the whole query, not of a node under a LIMIT', () => {
    // SELECT * FROM order_items LIMIT 1001: the scan below is expensive, the
    // query is not, because it stops early.
    const plan = node({
      type: 'Limit',
      cost: 18,
      plans: [node({ type: 'Seq Scan', cost: 2_000_000, rows: 100_000 })],
    });

    expect(assessPlan(explain(plan), LIMITS).refusal).toBeUndefined();
  });

  it('accepts the JSON as text, as some drivers return it', () => {
    const text = JSON.stringify(explain(node({ type: 'Seq Scan', cost: 7 })));

    expect(assessPlan(text, LIMITS)).toEqual({ totalCost: 7 });
  });

  it.each([
    ['nothing', undefined],
    ['an empty answer', []],
    ['an answer without a plan', [{}]],
    ['a plan without cost', [{ Plan: { 'Node Type': 'Seq Scan', 'Plan Rows': 1 } }]],
  ])('fails on %s instead of letting the query through', (_description, output) => {
    expect(() => assessPlan(output, LIMITS)).toThrow('Unexpected EXPLAIN output');
  });
});

describe('assessPlan: joins without a condition', () => {
  const HUGE = CARTESIAN_MAX_ROWS + 1;

  function nestedLoop(rows: number, inner: object, extra: Record<string, string> = {}): object {
    return node({ type: 'Nested Loop', rows, plans: [seqScan(100), inner], extra });
  }

  it('refuses a large cross join even when a LIMIT makes it cheap', () => {
    // SELECT * FROM orders CROSS JOIN order_items LIMIT 1001 costs about 12.
    const plan = node({
      type: 'Limit',
      cost: 12.51,
      plans: [
        nestedLoop(
          2_181_960_000,
          node({ type: 'Materialize', rows: 20_000, plans: [seqScan(20_000)] }),
        ),
      ],
    });

    const verdict = assessPlan(explain(plan), LIMITS);

    expect(verdict.totalCost).toBe(12.51);
    expect(verdict.refusal).toContain('produto cartesiano');
    expect(verdict.refusal).toContain('2.181.960.000');
    expect(verdict.refusal).toContain('JOIN ... ON');
  });

  it('finds the cross join anywhere in the plan', () => {
    const plan = node({
      type: 'Aggregate',
      plans: [node({ type: 'Sort', plans: [nestedLoop(HUGE, seqScan(50_000))] })],
    });

    expect(assessPlan(explain(plan), LIMITS).refusal).toContain('produto cartesiano');
  });

  it('accepts a small cross join: every region against every month', () => {
    expect(assessPlan(explain(nestedLoop(60, seqScan(12))), LIMITS).refusal).toBeUndefined();
  });

  it('accepts a cross join exactly at the row limit', () => {
    expect(
      assessPlan(explain(nestedLoop(CARTESIAN_MAX_ROWS, seqScan(1000))), LIMITS).refusal,
    ).toBeUndefined();
  });

  it('accepts a nested loop whose condition is a join filter', () => {
    const plan = nestedLoop(HUGE, seqScan(50_000), { 'Join Filter': '(o.id = i.order_id)' });

    expect(assessPlan(explain(plan), LIMITS).refusal).toBeUndefined();
  });

  it.each([
    ['an index scan', node({ type: 'Index Scan', extra: { 'Index Cond': '(order_id = o.id)' } })],
    [
      'a bitmap scan',
      node({ type: 'Bitmap Heap Scan', extra: { 'Recheck Cond': '(order_id = o.id)' } }),
    ],
    [
      'a memoized index scan',
      node({
        type: 'Memoize',
        plans: [node({ type: 'Index Scan', extra: { 'Index Cond': '(id = i.product_id)' } })],
      }),
    ],
  ])('accepts a nested loop that looks the inner rows up with %s', (_description, inner) => {
    expect(assessPlan(explain(nestedLoop(HUGE, inner)), LIMITS).refusal).toBeUndefined();
  });

  it('does not take other joins for a cross join', () => {
    const plan = node({
      type: 'Hash Join',
      rows: HUGE,
      plans: [seqScan(100_000), node({ type: 'Hash', plans: [seqScan(20_000)] })],
      extra: { 'Hash Cond': '(i.order_id = o.id)' },
    });

    expect(assessPlan(explain(plan), LIMITS).refusal).toBeUndefined();
  });

  it('reports the cross join rather than the cost when both apply', () => {
    const plan = node({
      type: 'Aggregate',
      cost: 99_999_999,
      plans: [nestedLoop(HUGE, seqScan(9))],
    });

    expect(assessPlan(explain(plan), LIMITS).refusal).toContain('produto cartesiano');
  });
});
