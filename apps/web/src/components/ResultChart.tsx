import type { QueryResult, VisualizationSuggestion } from '@interview-lab/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCell, toChartNumber } from '../utils/format';

interface ResultChartProps {
  result: QueryResult;
  visualization: VisualizationSuggestion;
  // Fixed size for environments without layout (tests); responsive otherwise.
  size?: { width: number; height: number };
}

const CHART_HEIGHT = 280;
const CHART_COLOR = 'var(--chart-1)';
const AXIS_COLOR = 'var(--text-muted)';

interface ChartPoint {
  label: string;
  value: number;
}

// Draws the chart suggested by the API. Returns nothing when the suggestion is
// a table or its columns are not in the result.
export function ResultChart({ result, visualization, size }: ResultChartProps) {
  if (visualization.type === 'table' || !visualization.xColumn || !visualization.yColumn) {
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

  const axes = [
    <CartesianGrid key="grid" strokeDasharray="3 3" stroke="var(--border)" />,
    <XAxis key="x" dataKey="label" stroke={AXIS_COLOR} fontSize={12} />,
    <YAxis key="y" stroke={AXIS_COLOR} fontSize={12} width={80} />,
    <Tooltip key="tooltip" />,
  ];
  const chart =
    visualization.type === 'bar' ? (
      <BarChart data={points} {...size}>
        {axes}
        <Bar dataKey="value" name={visualization.yColumn} fill={CHART_COLOR} />
      </BarChart>
    ) : (
      <LineChart data={points} {...size}>
        {axes}
        <Line dataKey="value" name={visualization.yColumn} stroke={CHART_COLOR} dot={false} />
      </LineChart>
    );

  return (
    <figure
      aria-label={`Gráfico de ${visualization.type === 'bar' ? 'barras' : 'linha'}: ${visualization.yColumn} por ${visualization.xColumn}`}
      className="rounded-lg border border-border bg-surface p-2"
    >
      {size ? (
        chart
      ) : (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          {chart}
        </ResponsiveContainer>
      )}
    </figure>
  );
}
