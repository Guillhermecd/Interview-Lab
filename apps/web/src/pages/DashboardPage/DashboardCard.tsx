import type { ReactNode } from 'react';
import { MessageSquareIcon } from '../../components/ui/icons';

interface DashboardCardProps {
  title: string;
  subtitle?: string | undefined;
  // Opens the chat with a question about this card.
  onAsk: () => void;
  // The wide card spells the action out; the others say only "Perguntar".
  askLabel?: string;
  // Controls shown beside the title (legend, toggles).
  actions?: ReactNode;
  // Tables go edge to edge; charts keep the padding of the card.
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

// The frame of every chart and table of the dashboard: title, what it shows,
// and the way to ask the chat about it.
export function DashboardCard({
  title,
  subtitle,
  onAsk,
  askLabel = 'Perguntar',
  actions,
  flush = false,
  className = '',
  children,
}: DashboardCardProps) {
  return (
    <section
      aria-label={title}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface ${
        flush ? '' : 'gap-2.5 px-4 pt-3.5 pb-3'
      } ${className}`}
    >
      <div className={`flex flex-wrap items-start gap-2.5 ${flush ? 'px-4 pt-3.5 pb-2.5' : ''}`}>
        <div className="min-w-[180px] flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle !== undefined && <p className="mt-0.5 text-xs text-text-3">{subtitle}</p>}
        </div>
        {actions}
        <button
          type="button"
          onClick={onAsk}
          aria-label={`Perguntar sobre isto: ${title}`}
          className="inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-[9px] text-xs font-medium whitespace-nowrap text-text-2 hover:border-accent hover:bg-accent-soft hover:text-accent-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <MessageSquareIcon size={13} />
          {askLabel}
        </button>
      </div>
      {children}
    </section>
  );
}

interface SegmentedProps<Value extends string> {
  label: string;
  options: { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  // 24px inside cards, 28px in the filter bar.
  size?: 'sm' | 'md';
}

// A set of mutually exclusive choices shown side by side.
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
  size = 'sm',
}: SegmentedProps<Value>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex gap-0.5 bg-surface-3 p-0.5 ${size === 'md' ? 'rounded-lg' : 'rounded-[7px]'}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
          className={`cursor-pointer font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-accent ${
            size === 'md'
              ? 'h-7 rounded-md px-2.5 text-[12.5px]'
              : 'h-6 rounded-[5px] px-[9px] text-xs'
          } ${
            option.value === value
              ? 'bg-surface text-text shadow-control'
              : 'text-text-2 hover:text-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface ChipsProps<Value extends string> {
  label: string;
  options: { value: Value; label: string; color: string; count?: number | undefined }[];
  value: Value;
  onChange: (value: Value) => void;
  // Status chips use a round dot; type chips a square one.
  dot?: 'round' | 'square';
}

// Filter chips above a table.
export function Chips<Value extends string>({
  label,
  options,
  value,
  onChange,
  dot = 'round',
}: ChipsProps<Value>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5 px-4 pb-2.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
          className={`inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-full border px-[9px] text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${
            option.value === value ? 'border-text-2 bg-surface-3' : 'border-line bg-surface'
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-[7px] w-[7px] ${dot === 'round' ? 'rounded-full' : 'rounded-sm'}`}
            style={{ backgroundColor: option.color }}
          />
          {option.label}
          {option.count !== undefined && (
            <span className="font-mono text-[11px] text-text-3">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
