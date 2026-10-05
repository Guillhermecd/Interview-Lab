import type { QueryResult, VisualizationSuggestion } from '@interview-lab/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatAxisNumber, formatCell, formatShare, toChartNumber } from '../utils/format';

export const CHART_TYPES = ['bar', 'line', 'donut'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: 'Barras',
  line: 'Linha',
  donut: 'Rosca',
};

const CHART_TYPE_NAMES: Record<ChartType, string> = {
  bar: 'barras',
  line: 'linha',
  donut: 'rosca',
};

interface ResultChartProps {
  result: QueryResult;
  // Which columns to draw, as suggested by the API.
  visualization: VisualizationSuggestion;
  // Chart chosen by the user; the suggested one when absent.
  type?: ChartType | undefined;
  // Fixed size for environments without layout (tests); responsive otherwise.
  size?: { width: number; height: number };
}

const CHART_HEIGHT = 236;
const SERIES_COLOR = 'var(--accent)';
const AXIS_COLOR = 'var(--text-3)';
const CATEGORY_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--line-2)',
  borderRadius: 6,
  fontSize: 12,
};

interface ChartPoint {
  label: string;
  value: number;
}

// The chart type the API suggested, when it suggested a chart.
export function suggestedChartType(visualization: VisualizationSuggestion): ChartType | undefined {
  return visualization.type === 'table' ? undefined : visualization.type;
}

// Draws the columns suggested by the API. Returns nothing when there is no
// chart to draw: the suggestion is a table or its columns are not in the result.
export function ResultChart({ result, visualization, type, size }: ResultChartProps) {
  const chartType = type ?? suggestedChartType(visualization);
  if (chartType === undefined || !visualization.xColumn || !visualization.yColumn) {
    return null;
  }
  const xIndex = result.columns.findIndex((column) => column.name === visualization.xColumn);
  const yIndex = result.columns.findIndex((column) => column.name === visualization.yColumn);
  const xColumn = result.columns[xIndex];
  if (xIndex === -1 || yIndex === -1 || xColumn === undefined) {
    return null;
  }

  const points: ChartPoint[] = result.rows.flatMap((row) => {
    const value = toChartNumber(row[yIndex]);
    return value === null ? [] : [{ label: formatCell(row[xIndex], xColumn.type), value }];
  });
  if (points.length === 0) {
    return null;
  }
  // One color per slice; bars and lines are a single series in the accent color.
  const slices = points.map((point, index) => ({
    ...point,
    fill: CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? SERIES_COLOR,
  }));

  const tooltip = (
    <Tooltip
      key="tooltip"
      formatter={(value) => formatCell(value, 'numeric')}
      contentStyle={TOOLTIP_STYLE}
    />
  );
  const axes = [
    <CartesianGrid key="grid" vertical={false} stroke="var(--line)" />,
    <XAxis key="x" dataKey="label" stroke={AXIS_COLOR} fontSize={11.5} tickLine={false} />,
    <YAxis
      key="y"
      stroke={AXIS_COLOR}
      fontSize={11}
      width={72}
      tickLine={false}
      axisLine={false}
      tickFormatter={formatAxisNumber}
    />,
    tooltip,
  ];

  let chart;
  if (chartType === 'bar') {
    chart = (
      <BarChart data={points} {...size}>
        {axes}
        <Bar
          dataKey="value"
          name={visualization.yColumn}
          fill={SERIES_COLOR}
          radius={2}
          maxBarSize={36}
        />
      </BarChart>
    );
  } else if (chartType === 'line') {
    chart = (
      <LineChart data={points} {...size}>
        {axes}
        <Line
          dataKey="value"
          name={visualization.yColumn}
          stroke={SERIES_COLOR}
          strokeWidth={2}
          dot={{ r: 3.5, fill: 'var(--surface)', stroke: SERIES_COLOR, strokeWidth: 2 }}
        />
      </LineChart>
    );
  } else {
    chart = (
      <PieChart {...size}>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="label"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={1}
          stroke="none"
          isAnimationActive={false}
        />
        {tooltip}
      </PieChart>
    );
  }

  // Only how the slices are labelled: each one's part of what is drawn.
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <figure
      aria-label={`Gráfico de ${CHART_TYPE_NAMES[chartType]}: ${visualization.yColumn} por ${visualization.xColumn}`}
      className="m-0 flex flex-wrap items-center gap-x-6 gap-y-2"
    >
      <div className="min-w-0 flex-1 basis-64">
        {size ? (
          chart
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            {chart}
          </ResponsiveContainer>
        )}
      </div>
      {chartType === 'donut' && (
        <ul className="min-w-0 flex-1 basis-56 space-y-2 text-[13px]">
          {slices.map((point, index) => (
            <li key={`${point.label}-${String(index)}`} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: point.fill }}
              />
              <span className="min-w-0 flex-1 truncate">{point.label}</span>
              <span className="font-mono text-[12.5px] text-text-2">
                {total > 0 && `${formatShare(point.value / total)} · `}
                {formatAxisNumber(point.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
