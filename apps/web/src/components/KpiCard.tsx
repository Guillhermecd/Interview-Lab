import { MessageSquareIcon } from './ui/icons';

export type KpiTrend = 'up' | 'down' | 'flat';
export type KpiSentiment = 'good' | 'bad' | 'neutral';

interface KpiCardProps {
  label: string;
  // Value, variation and texts arrive ready to display.
  value: string;
  delta: string;
  // Direction of the arrow.
  trend: KpiTrend;
  // Color of the variation: a rise can be bad (stock days) and a fall good.
  sentiment: KpiSentiment;
  compareLabel: string;
  sub?: string;
  // Recent values, oldest first, drawn as a sparkline.
  spark: number[];
  onAsk: () => void;
}

const SPARK_WIDTH = 80;
const SPARK_HEIGHT = 28;
const SPARK_TOP = 4;
const SPARK_BOTTOM = 25;

const SENTIMENT_CLASSES: Record<KpiSentiment, string> = {
  good: 'bg-ok-soft text-ok',
  bad: 'bg-crit-soft text-crit',
  neutral: 'bg-surface-3 text-text-2',
};

const TREND_PATHS: Record<KpiTrend, string | undefined> = {
  up: 'M5 8.5v-7M2 4.5l3-3 3 3',
  down: 'M5 1.5v7M2 5.5l3 3 3-3',
  flat: undefined,
};

// Scales the values into the sparkline box; only where to draw, nothing else.
function sparkLine(values: number[]): string {
  if (values.length < 2) {
    return '';
  }
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * SPARK_WIDTH;
      const y = SPARK_BOTTOM - ((value - min) / range) * (SPARK_BOTTOM - SPARK_TOP);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function KpiCard({
  label,
  value,
  delta,
  trend,
  sentiment,
  compareLabel,
  sub,
  spark,
  onAsk,
}: KpiCardProps) {
  const line = sparkLine(spark);
  const trendPath = TREND_PATHS[trend];

  return (
    <article className="flex h-full min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-3">
      <div className="flex min-h-6 items-center gap-1.5">
        <h3 className="min-w-0 flex-1 text-[12.5px] leading-[1.3] font-medium text-text-2">
          {label}
        </h3>
        <button
          type="button"
          onClick={onAsk}
          title="Perguntar sobre isto"
          aria-label={`Perguntar sobre isto: ${label}`}
          className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-3 hover:bg-accent-soft hover:text-accent-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <MessageSquareIcon />
        </button>
      </div>
      <p className="text-2xl leading-[1.1] font-semibold tracking-[-0.01em] whitespace-nowrap tabular-nums">
        {value}
      </p>
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span
          data-sentiment={sentiment}
          className={`inline-flex h-5 items-center gap-[3px] rounded px-1.5 font-semibold tabular-nums ${SENTIMENT_CLASSES[sentiment]}`}
        >
          {trendPath !== undefined && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={trendPath} />
            </svg>
          )}
          {delta}
        </span>
        <span className="min-w-0 truncate text-text-3">{compareLabel}</span>
        <div className="flex-1" />
        {line !== '' && (
          <svg
            width="64"
            height="22"
            viewBox={`0 0 ${String(SPARK_WIDTH)} ${String(SPARK_HEIGHT)}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="shrink-0 overflow-visible"
          >
            <path
              d={`${line} L${String(SPARK_WIDTH)} ${String(SPARK_HEIGHT)} L0 ${String(SPARK_HEIGHT)} Z`}
              className="fill-accent-soft"
            />
            <path
              d={line}
              className="fill-none stroke-accent"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
      {sub !== undefined && sub !== '' && (
        <p className="mt-0.5 border-t border-line pt-1.5 text-xs text-text-2 tabular-nums">{sub}</p>
      )}
    </article>
  );
}
