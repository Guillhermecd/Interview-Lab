import type { QueryResult, VisualizationSuggestion } from '@interview-lab/shared';
import { useState } from 'react';
import { downloadCsv, toCsv } from '../utils/csv';
import { formatInteger, formatRowCount } from '../utils/format';
import {
  CHART_TYPE_LABELS,
  CHART_TYPES,
  ResultChart,
  suggestedChartType,
  type ChartType,
} from './ResultChart';
import { ResultTable } from './ResultTable';
import { Button } from './ui/Button';

interface ResultPanelProps {
  result: QueryResult;
  visualization?: VisualizationSuggestion | undefined;
}

type Tab = 'table' | 'chart';

const TAB_LABELS: Record<Tab, string> = { table: 'Tabela', chart: 'Gráfico' };
// Rows shown before "Ver todas".
const PREVIEW_ROWS = 6;
const CSV_FILE_NAME = 'resultado.csv';

// The rows of an answer, as a table or as a chart. The chart draws the columns
// the API suggested; the user may switch between bars, line and donut.
export function ResultPanel({ result, visualization }: ResultPanelProps) {
  const [tab, setTab] = useState<Tab>('table');
  const [chartType, setChartType] = useState<ChartType>();
  const [showAll, setShowAll] = useState(false);

  const suggested = visualization && suggestedChartType(visualization);
  const hasChart =
    visualization !== undefined &&
    suggested !== undefined &&
    Boolean(visualization.xColumn) &&
    Boolean(visualization.yColumn);
  const tabs: Tab[] = hasChart ? ['table', 'chart'] : ['table'];
  const shownRows = showAll ? result.rows.length : Math.min(PREVIEW_ROWS, result.rows.length);

  return (
    <section
      aria-label="Resultado"
      className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <div role="tablist" aria-label="Formato do resultado" className="flex gap-1">
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => {
                setTab(name);
              }}
              className={`h-[26px] cursor-pointer rounded-md px-2.5 text-[12.5px] font-medium ${
                tab === name ? 'bg-surface-3 text-text' : 'text-text-2 hover:text-text'
              }`}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'table' && (
          <>
            <span className="pr-1.5 text-xs text-text-3">{formatRowCount(result.rowCount)}</span>
            <Button
              variant="secondary"
              size="sm"
              className="text-text-2"
              onClick={() => {
                downloadCsv(CSV_FILE_NAME, toCsv(result));
              }}
            >
              Exportar CSV
            </Button>
          </>
        )}
        {tab === 'chart' && suggested !== undefined && (
          <>
            <span className="pr-1 text-xs text-text-3">
              Sugerido: {CHART_TYPE_LABELS[suggested]}
            </span>
            <div
              role="group"
              aria-label="Tipo de gráfico"
              className="flex gap-0.5 rounded-[7px] bg-surface-3 p-0.5"
            >
              {CHART_TYPES.map((type) => {
                const selected = (chartType ?? suggested) === type;
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setChartType(type);
                    }}
                    className={`h-[22px] cursor-pointer rounded-[5px] px-2 text-xs font-medium ${
                      selected ? 'bg-surface text-text shadow-control' : 'text-text-2'
                    }`}
                  >
                    {CHART_TYPE_LABELS[type]}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {tab === 'table' && (
        <>
          {result.truncated && (
            <p className="border-b border-line bg-warn-soft px-3 py-1.5 text-xs text-warn">
              Mostrando as primeiras {formatInteger(result.rowCount)} linhas; a consulta tinha mais.
            </p>
          )}
          <ResultTable result={result} maxRows={shownRows} />
          {result.rows.length > PREVIEW_ROWS && (
            <p className="flex gap-2 px-3 py-[7px] text-xs text-text-3">
              Mostrando {formatInteger(shownRows)} de {formatInteger(result.rows.length)} linhas.
              <button
                type="button"
                onClick={() => {
                  setShowAll(!showAll);
                }}
                className="cursor-pointer text-accent-text hover:underline"
              >
                {showAll ? 'Ver menos' : 'Ver todas'}
              </button>
            </p>
          )}
        </>
      )}

      {tab === 'chart' && visualization !== undefined && (
        <div className="px-3.5 pt-3 pb-2">
          <ResultChart result={result} visualization={visualization} type={chartType} />
        </div>
      )}
    </section>
  );
}
