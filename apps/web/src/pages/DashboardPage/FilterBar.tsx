import {
  DASHBOARD_PERIODS,
  type DashboardFilterOptions,
  type DashboardPeriod,
  type DashboardRange,
} from '@interview-lab/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DashboardFilters } from '../../api/modules/dashboard.service';
import { Button } from '../../components/ui/Button';
import { CalendarIcon, CheckIcon, ChevronDownIcon } from '../../components/ui/icons';
import { Segmented } from './DashboardCard';
import { PERIOD_LABELS, rangeLabel } from './labels';

interface FilterBarProps {
  period: DashboardPeriod;
  // The days the server resolved the period to; unknown until it answers.
  range: DashboardRange | undefined;
  previousRange: DashboardRange | undefined;
  filters: DashboardFilters;
  options: DashboardFilterOptions | undefined;
  // A preset, or the days of a custom period.
  onPeriodChange: (period: Exclude<DashboardPeriod, 'custom'> | DashboardRange) => void;
  onFiltersChange: (filters: DashboardFilters) => void;
}

const PERIOD_OPTIONS = DASHBOARD_PERIODS.map((period) => ({
  value: period,
  label: PERIOD_LABELS[period],
}));

const POPOVER_CLASS =
  'absolute top-[calc(100%+6px)] left-0 z-30 rounded-[10px] border border-line bg-surface shadow-elevated';

// Closes whatever is open when the user clicks elsewhere or presses Escape.
function useDismiss(open: boolean, close: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && containerRef.current?.contains(event.target) !== true) {
        close();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return containerRef;
}

interface FilterMenuProps {
  label: string;
  // What "no filter" is called: "Todos" or "Todas".
  allLabel: string;
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

// One filter: a button that shows the choice and opens the list of options.
function FilterMenu({ label, allLabel, options, value, onChange }: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useDismiss(open, () => {
    setOpen(false);
  });
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const choices = [{ value: undefined, label: allLabel }, ...options];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setOpen(!open);
        }}
        className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] border pr-[9px] pl-2.5 text-[12.5px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-accent ${
          selected ? 'border-accent bg-accent-soft' : 'border-line-2 bg-surface'
        }`}
      >
        <span className="text-text-3">{label}</span>
        {selected?.label ?? allLabel}
        <ChevronDownIcon size={12} strokeWidth={1.8} className="text-text-3" />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className={`${POPOVER_CLASS} flex max-h-80 min-w-[220px] flex-col overflow-y-auto p-1`}
        >
          {choices.map((choice) => (
            <li
              key={choice.value ?? ''}
              role="option"
              aria-selected={choice.value === value}
              tabIndex={0}
              onClick={() => {
                onChange(choice.value);
                setOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onChange(choice.value);
                  setOpen(false);
                }
              }}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] whitespace-nowrap hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
            >
              <span aria-hidden="true" className="flex w-3.5 text-accent-text">
                {choice.value === value && <CheckIcon size={12} strokeWidth={2} />}
              </span>
              {choice.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface RangePickerProps {
  range: DashboardRange | undefined;
  previousRange: DashboardRange | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (range: DashboardRange) => void;
}

// Shows the days of the period and lets the user type a custom one.
function RangePicker({ range, previousRange, open, onOpenChange, onApply }: RangePickerProps) {
  // What the user typed; until then, the days on screen.
  const [typed, setTyped] = useState<Partial<DashboardRange>>({});
  const from = typed.from ?? range?.from ?? '';
  const to = typed.to ?? range?.to ?? '';
  const setFrom = (value: string) => {
    setTyped((current) => ({ ...current, from: value }));
  };
  const setTo = (value: string) => {
    setTyped((current) => ({ ...current, to: value }));
  };
  const setOpen = (next: boolean) => {
    if (!next) {
      setTyped({});
    }
    onOpenChange(next);
  };
  const containerRef = useDismiss(open, () => {
    setOpen(false);
  });
  // Only spares a request that the server would refuse anyway.
  const canApply = from !== '' && to !== '' && from <= to;

  function toggle() {
    setOpen(!open);
  }

  let summary: ReactNode = 'Carregando período…';
  if (range) {
    summary = (
      <>
        <span className="tabular-nums">{rangeLabel(range)}</span>
        {previousRange && <span className="text-text-3">vs. {rangeLabel(previousRange)}</span>}
      </>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className="inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-[7px] border border-line-2 bg-surface px-2.5 text-[12.5px] font-medium whitespace-nowrap hover:border-text-3 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <CalendarIcon size={13} />
        {summary}
      </button>
      {open && (
        <form
          role="dialog"
          aria-label="Intervalo personalizado"
          onSubmit={(event) => {
            event.preventDefault();
            if (canApply) {
              onApply({ from, to });
              setOpen(false);
            }
          }}
          className={`${POPOVER_CLASS} flex w-80 flex-col gap-3 p-3.5`}
        >
          <p className="text-[13px] font-semibold">Intervalo personalizado</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'De', value: from, onChange: setFrom },
              { label: 'Até', value: to, onChange: setTo },
            ].map((field) => (
              <label key={field.label} className="flex flex-col gap-1 text-xs text-text-2">
                {field.label}
                <input
                  type="date"
                  required
                  value={field.value}
                  onChange={(event) => {
                    field.onChange(event.target.value);
                  }}
                  className="h-8 rounded-md border border-line-2 bg-surface px-2 font-mono text-[13px] text-text focus:border-accent focus:outline-none"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-text-2">
            A comparação é feita com o período anterior de mesma duração.
          </p>
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" size="md" disabled={!canApply}>
              Aplicar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// The filters of the whole dashboard, kept in view while the page scrolls.
export function FilterBar({
  period,
  range,
  previousRange,
  filters,
  options,
  onPeriodChange,
  onFiltersChange,
}: FilterBarProps) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const hasFilters =
    filters.distributionCenterId !== undefined ||
    filters.regionId !== undefined ||
    filters.category !== undefined;

  return (
    <div
      role="search"
      aria-label="Filtros do dashboard"
      className="sticky top-0 z-[15] flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-line bg-bg px-6 py-3"
    >
      <Segmented
        label="Período"
        size="md"
        options={PERIOD_OPTIONS}
        value={period}
        onChange={(value) => {
          // "Personalizado" only asks for the days; it applies when they are given.
          if (value === 'custom') {
            setRangeOpen(true);
          } else {
            onPeriodChange(value);
          }
        }}
      />
      <RangePicker
        range={range}
        previousRange={previousRange}
        open={rangeOpen}
        onOpenChange={setRangeOpen}
        onApply={onPeriodChange}
      />
      <span aria-hidden="true" className="mx-0.5 h-[22px] w-px bg-line-2" />
      <FilterMenu
        label="Centro de distribuição"
        allLabel="Todos"
        options={(options?.distributionCenters ?? []).map((center) => ({
          value: center.id,
          label: center.name,
        }))}
        value={filters.distributionCenterId}
        onChange={(distributionCenterId) => {
          onFiltersChange({ ...filters, distributionCenterId });
        }}
      />
      <FilterMenu
        label="Região"
        allLabel="Todas"
        options={(options?.regions ?? []).map((region) => ({
          value: region.id,
          label: region.name,
        }))}
        value={filters.regionId}
        onChange={(regionId) => {
          onFiltersChange({ ...filters, regionId });
        }}
      />
      <FilterMenu
        label="Categoria"
        allLabel="Todas"
        options={(options?.categories ?? []).map((category) => ({
          value: category,
          label: category,
        }))}
        value={filters.category}
        onChange={(category) => {
          onFiltersChange({ ...filters, category });
        }}
      />
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            onFiltersChange({});
          }}
          className="h-8 cursor-pointer rounded-md px-2 text-[12.5px] font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
