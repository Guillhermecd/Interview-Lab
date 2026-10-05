import { useEffect, useState, type ReactNode } from 'react';
import { formatCountdown, formatInteger } from '../utils/format';
import { Button } from './ui/Button';
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, InfoIcon, ShieldXIcon } from './ui/icons';

export type AlertVariant = 'crit' | 'warn' | 'ok' | 'info';

interface AlertProps {
  variant: AlertVariant;
  title: string;
  body?: ReactNode;
  // Seconds left when the alert appears; it counts down by itself.
  countdown?: number | undefined;
  countdownLabel?: string;
  meterUsed?: number | undefined;
  meterTotal?: number | undefined;
  actions?: string[];
  onAction?: (label: string) => void;
}

const ONE_SECOND_MS = 1000;
const FULL_PERCENT = 100;

const VARIANTS: Record<AlertVariant, { box: string; text: string; fill: string; icon: ReactNode }> =
  {
    crit: {
      box: 'border-line-crit bg-crit-soft',
      text: 'text-crit',
      fill: 'bg-crit',
      icon: <ShieldXIcon size={18} />,
    },
    warn: {
      box: 'border-line-warn bg-warn-soft',
      text: 'text-warn',
      fill: 'bg-warn',
      icon: <AlertTriangleIcon size={18} />,
    },
    ok: {
      box: 'border-line-ok bg-ok-soft',
      text: 'text-ok',
      fill: 'bg-ok',
      icon: <CheckCircleIcon size={18} />,
    },
    info: {
      box: 'border-line-info bg-accent-soft',
      text: 'text-accent-text',
      fill: 'bg-accent-text',
      icon: <InfoIcon size={18} />,
    },
  };

// Seconds left of `initial`, counting down once per second until zero.
function useCountdown(initial: number | undefined): number | undefined {
  const [state, setState] = useState({ initial, remaining: initial });
  if (state.initial !== initial) {
    setState({ initial, remaining: initial });
  }

  useEffect(() => {
    if (initial === undefined) {
      return undefined;
    }
    const timer = setInterval(() => {
      setState((current) =>
        current.remaining === undefined
          ? current
          : { ...current, remaining: Math.max(0, current.remaining - 1) },
      );
    }, ONE_SECOND_MS);
    return () => {
      clearInterval(timer);
    };
  }, [initial]);

  return state.initial === initial ? state.remaining : initial;
}

// A status message: critical, warning, ok or informative, optionally with a
// countdown, a usage meter and actions. Colors are semantic and fixed.
export function Alert({
  variant,
  title,
  body,
  countdown,
  countdownLabel = 'Libera em',
  meterUsed,
  meterTotal,
  actions = [],
  onAction,
}: AlertProps) {
  const style = VARIANTS[variant];
  const remaining = useCountdown(countdown);
  const hasMeter = meterUsed !== undefined && meterTotal !== undefined && meterTotal > 0;

  return (
    <div role="alert" className={`flex min-w-0 gap-2.5 rounded-lg border px-3.5 py-3 ${style.box}`}>
      <div className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center ${style.text}`}>
        {style.icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <p className="min-w-[200px] flex-1 text-[13.5px] leading-[1.35] font-semibold">{title}</p>
          {remaining !== undefined && (
            <p className="inline-flex items-center gap-1.5 text-xs text-text-2">
              <ClockIcon size={13} className="self-center" />
              {countdownLabel}
              <span role="timer" className={`font-mono text-[13px] font-semibold ${style.text}`}>
                {formatCountdown(remaining)}
              </span>
            </p>
          )}
        </div>
        {body !== undefined && body !== '' && (
          <div className="text-[13px] leading-normal text-pretty text-text-2">{body}</div>
        )}
        {hasMeter && (
          <div className="flex items-center gap-2.5 text-xs text-text-2">
            <div
              role="meter"
              aria-label="Uso"
              aria-valuemin={0}
              aria-valuemax={meterTotal}
              aria-valuenow={meterUsed}
              className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-surface-3"
            >
              <div
                className={`h-full ${style.fill}`}
                style={{
                  width: `${String(Math.min(FULL_PERCENT, (meterUsed / meterTotal) * FULL_PERCENT))}%`,
                }}
              />
            </div>
            <span className="font-mono">
              {formatInteger(meterUsed)} / {formatInteger(meterTotal)}
            </span>
          </div>
        )}
        {actions.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {actions.map((label) => (
              <Button
                key={label}
                variant="secondary"
                size="md"
                onClick={() => {
                  onAction?.(label);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
