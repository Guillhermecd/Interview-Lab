import type { AbcCurve, RevenuePoint } from '@interview-lab/shared';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatAxisNumber,
  formatCurrency,
  formatDay,
  formatDecimal,
  formatInteger,
  formatShortDay,
} from '../../utils/format';

const AXIS_COLOR = 'var(--text-3)';
const REVENUE_HEIGHT = 240;
const ABC_HEIGHT = 190;
const FULL_PERCENT = 100;
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--line-2)',
  borderRadius: 6,
  fontSize: 12,
};

export type RevenueMode = 'daily' | 'cumulative';

interface RevenueChartProps {
  series: RevenuePoint[];
  mode: RevenueMode;
}

interface RevenueTooltipProps {
  active?: boolean;
  payload?: { payload: RevenuePoint }[];
  mode: RevenueMode;
}

function RevenueTooltip({ active, payload, mode }: RevenueTooltipProps) {
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined) {
    return null;
  }
  const current = mode === 'daily' ? point.revenue : point.cumulative;
  const previous = mode === 'daily' ? point.previousRevenue : point.previousCumulative;
  return (
    <div className="rounded-md border border-line-2 bg-surface px-2.5 py-2 text-xs shadow-elevated">
      <p className="font-semibold">{formatCurrency(current)}</p>
      <p className="text-text-3">{formatDay(point.date)}</p>
      <p className="mt-1.5 text-text-2">{formatCurrency(previous)}</p>
      <p className="text-text-3">{formatDay(point.previousDate)}</p>
    </div>
  );
}

// Revenue of each day of the period (solid, with a light area) over the same
// day of the previous period (dashed).
export function RevenueChart({ series, mode }: RevenueChartProps) {
  const currentKey = mode === 'daily' ? 'revenue' : 'cumulative';
  const previousKey = mode === 'daily' ? 'previousRevenue' : 'previousCumulative';

  return (
    <figure
      aria-label={`Faturamento ${mode === 'daily' ? 'diário' : 'acumulado'} do período, comparado ao período anterior`}
      className="m-0 min-w-0"
    >
      <ResponsiveContainer width="100%" height={REVENUE_HEIGHT}>
        <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="date"
            stroke={AXIS_COLOR}
            fontSize={11}
            tickLine={false}
            tickFormatter={formatShortDay}
            minTickGap={24}
          />
          <YAxis
            stroke={AXIS_COLOR}
            fontSize={11}
            width={64}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatAxisNumber}
          />
          <Tooltip content={<RevenueTooltip mode={mode} />} />
          <Line
            dataKey={previousKey}
            stroke="var(--text-3)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
          <Area
            dataKey={currentKey}
            stroke="var(--accent)"
            strokeWidth={2}
            fill="var(--accent)"
            fillOpacity={0.08}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}

const CLASS_BANDS = [
  { label: 'A', opacity: 0.1 },
  { label: 'B', opacity: 0.05 },
  { label: 'C', opacity: 0 },
];

// Cumulative revenue against the share of products, with the bands of the
// three classes; below, how many products and how much revenue each one holds.
export function AbcChart({ abc }: { abc: AbcCurve }) {
  const bands = [
    { from: 0, to: abc.classAEndPercent },
    { from: abc.classAEndPercent, to: abc.classBEndPercent },
    { from: abc.classBEndPercent, to: FULL_PERCENT },
  ];

  return (
    <>
      <figure
        aria-label="Curva ABC: faturamento acumulado por percentual de SKUs"
        className="m-0 min-w-0"
      >
        <ResponsiveContainer width="100%" height={ABC_HEIGHT}>
          <AreaChart data={abc.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            {bands.map(
              (band, index) =>
                band.to > band.from && (
                  <ReferenceArea
                    key={CLASS_BANDS[index]?.label}
                    x1={band.from}
                    x2={band.to}
                    fill="var(--accent)"
                    fillOpacity={CLASS_BANDS[index]?.opacity ?? 0}
                    stroke="none"
                    label={{
                      value: CLASS_BANDS[index]?.label,
                      position: 'insideTop',
                      fill: 'var(--text-3)',
                      fontSize: 11,
                    }}
                  />
                ),
            )}
            <XAxis
              dataKey="productsPercent"
              type="number"
              domain={[0, FULL_PERCENT]}
              ticks={[0, 20, 40, 60, 80, FULL_PERCENT]}
              stroke={AXIS_COLOR}
              fontSize={11}
              tickLine={false}
              tickFormatter={(value: number) => `${formatInteger(value)}%`}
            />
            <YAxis
              domain={[0, FULL_PERCENT]}
              ticks={[0, 50, 80, FULL_PERCENT]}
              stroke={AXIS_COLOR}
              fontSize={11}
              width={40}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => `${formatInteger(value)}%`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value) => [`${formatDecimal(Number(value))}%`, 'Faturamento acumulado']}
              labelFormatter={(value) => `${formatDecimal(Number(value))}% dos SKUs`}
            />
            <Area
              dataKey="revenuePercent"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="var(--accent)"
              fillOpacity={0.06}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </figure>
      <dl className="grid grid-cols-3 gap-2 border-t border-line pt-2.5">
        {abc.classes.map((item) => (
          <div key={item.class} className="flex flex-col gap-0.5">
            <dt className="text-xs text-text-2">
              <span className="font-bold text-text">Classe {item.class}</span> ·{' '}
              {formatInteger(item.products)} SKUs
            </dt>
            <dd className="text-[17px] font-semibold tabular-nums">
              {formatDecimal(item.revenueSharePercent)}%
            </dd>
            <dd className="text-[11.5px] text-text-3">do faturamento</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
