import type { CenterStock, KpiSentiment, RegionRevenue, TopProducts } from '@interview-lab/shared';
import { useMoney } from '../../hooks/useMoneyVisibility';
import { formatSigned } from '../../utils/format';
import { categoryColor } from './labels';

const FULL_PERCENT = 100;

// Bar lengths are only how the values are drawn: each one against the biggest
// value on screen. The values themselves come from the server.
function widthOf(value: number, biggest: number): string {
  return biggest <= 0 ? '0%' : `${String((Math.max(value, 0) / biggest) * FULL_PERCENT)}%`;
}

const SENTIMENT_TEXT: Record<KpiSentiment, string> = {
  good: 'text-ok',
  bad: 'text-crit',
  neutral: 'text-text-2',
};

// Each region: the period (thick bar) over the previous one (thin bar).
export function RegionBars({ regions }: { regions: RegionRevenue[] }) {
  const money = useMoney();
  const biggest = Math.max(
    0,
    ...regions.flatMap((region) => [region.revenue, region.previousRevenue]),
  );

  if (regions.length === 0) {
    return (
      <p className="py-4 text-[13px] text-text-2">Nenhuma região para os filtros escolhidos.</p>
    );
  }
  return (
    <>
      <ul className="flex flex-1 flex-col justify-center gap-3">
        {regions.map((region) => (
          <li key={region.regionId} className="grid grid-cols-[96px_1fr_auto] items-center gap-2.5">
            <span className="truncate text-[13px] font-medium">{region.name}</span>
            <div aria-hidden="true" className="flex flex-col gap-[3px]">
              <div
                className="h-3 rounded-sm bg-accent"
                style={{ width: widthOf(region.revenue, biggest) }}
              />
              <div
                className="h-1 rounded-sm bg-prev"
                style={{ width: widthOf(region.previousRevenue, biggest) }}
              />
            </div>
            <div className="flex min-w-[78px] flex-col items-end leading-tight">
              <span className="text-[13px] font-semibold tabular-nums">
                {money.compactCurrency(region.revenue)}
              </span>
              <span
                className={`text-[11.5px] font-semibold tabular-nums ${SENTIMENT_TEXT[region.sentiment]}`}
              >
                {region.deltaPercent === null ? '—' : `${formatSigned(region.deltaPercent)}%`}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="flex gap-3.5 border-t border-line pt-2 text-[11.5px] text-text-3">
        <span className="inline-flex items-center gap-[5px]">
          <span aria-hidden="true" className="h-2 w-2.5 rounded-sm bg-accent" />
          Período
        </span>
        <span className="inline-flex items-center gap-[5px]">
          <span aria-hidden="true" className="h-1 w-2.5 rounded-sm bg-prev" />
          Período anterior
        </span>
      </p>
    </>
  );
}

interface TopProductsListProps {
  top: TopProducts;
  categories: string[];
}

// The best sellers of the period, each bar in the color of its category.
export function TopProductsList({ top, categories }: TopProductsListProps) {
  const money = useMoney();
  const biggest = top.items[0]?.revenue ?? 0;

  if (top.items.length === 0) {
    return <p className="py-4 text-[13px] text-text-2">Nenhuma venda no período.</p>;
  }
  return (
    <ol className="flex flex-col gap-[7px]">
      {top.items.map((item, index) => (
        <li
          key={item.productId}
          className="grid grid-cols-[18px_minmax(0,1fr)_72px] items-center gap-2"
        >
          <span
            aria-hidden="true"
            className="text-right font-mono text-[11px] font-medium text-text-3"
          >
            {index + 1}
          </span>
          <div className="flex min-w-0 flex-col gap-[3px]">
            <span className="truncate text-[12.5px]" title={`${item.name} · ${item.category}`}>
              {item.name}
            </span>
            <div
              aria-hidden="true"
              className="h-[5px] rounded-sm"
              style={{
                width: widthOf(item.revenue, biggest),
                backgroundColor: categoryColor(categories.indexOf(item.category)),
              }}
            />
          </div>
          <span className="text-right text-[12.5px] font-semibold tabular-nums">
            {money.compactCurrency(item.revenue)}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface StockByCenterBarsProps {
  centers: CenterStock[];
  categories: string[];
}

// The stock of each center, stacked by category.
export function StockByCenterBars({ centers, categories }: StockByCenterBarsProps) {
  const money = useMoney();
  const biggest = Math.max(0, ...centers.map((center) => center.total));

  if (centers.length === 0) {
    return (
      <p className="py-4 text-[13px] text-text-2">Nenhum centro para os filtros escolhidos.</p>
    );
  }
  return (
    <>
      <ul
        aria-label="Categorias"
        className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-text-2"
      >
        {categories.map((category, index) => (
          <li key={category} className="inline-flex items-center gap-[5px]">
            <span
              aria-hidden="true"
              className="h-[9px] w-[9px] rounded-sm"
              style={{ backgroundColor: categoryColor(index) }}
            />
            {category}
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-[7px]">
        {centers.map((center) => (
          <li
            key={center.distributionCenterId}
            className="grid grid-cols-[104px_minmax(0,1fr)_64px] items-center gap-2"
          >
            <span className="truncate text-[12.5px]">{center.name}</span>
            <div
              className="flex h-3.5 gap-px overflow-hidden rounded-sm"
              style={{ width: widthOf(center.total, biggest) }}
            >
              {center.byCategory.map(
                (value, index) =>
                  value > 0 && (
                    <div
                      key={categories[index] ?? index}
                      title={`${categories[index] ?? ''}: ${money.currency(value)}`}
                      className="h-full"
                      style={{ flex: value, backgroundColor: categoryColor(index) }}
                    />
                  ),
              )}
            </div>
            <span className="text-right text-xs font-semibold tabular-nums">
              {money.compactCurrency(center.total)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
