import type { UsageLevel, UsageSummary } from '@interview-lab/shared';
import { formatInteger } from '../../utils/format';

const FULL_PERCENT = 100;

// The color follows the level the server sent; the screen does not compare
// the usage with the quota to decide it.
const LEVEL_FILL: Record<UsageLevel, string> = {
  normal: 'bg-accent',
  attention: 'bg-warn',
  critical: 'bg-crit',
};

// Tokens spent today against the daily quota. The length of the bar is only
// how the two numbers are drawn.
export function TokenMeter({ usage }: { usage: UsageSummary }) {
  const used = usage.today.inputTokens + usage.today.outputTokens;
  const share = usage.dailyTokenQuota <= 0 ? 0 : Math.min(1, used / usage.dailyTokenQuota);

  return (
    <div
      title="Consumo de tokens hoje"
      className="flex min-w-0 items-center gap-2.5 text-xs text-text-2"
    >
      <span className="whitespace-nowrap">Tokens hoje</span>
      <div
        role="meter"
        aria-label="Tokens usados hoje"
        aria-valuemin={0}
        aria-valuemax={usage.dailyTokenQuota}
        aria-valuenow={used}
        data-level={usage.level}
        className="h-1.5 w-[120px] min-w-10 shrink overflow-hidden rounded-[3px] bg-surface-3"
      >
        <div
          className={`h-full transition-[width] duration-300 ${LEVEL_FILL[usage.level]}`}
          style={{ width: `${String(share * FULL_PERCENT)}%` }}
        />
      </div>
      <span className="font-mono whitespace-nowrap">
        <span className="text-text">{formatInteger(used)}</span> /{' '}
        {formatInteger(usage.dailyTokenQuota)}
      </span>
    </div>
  );
}
