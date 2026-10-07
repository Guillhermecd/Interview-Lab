import { useState } from 'react';
import { CatalogService } from '../../api/modules/catalog.service';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { useApiData } from '../../hooks/useApiData';
import { MovementsTab } from './MovementsTab';
import { ProductsTab } from './ProductsTab';

type Tab = 'products' | 'movements';

const TABS: { value: Tab; label: string }[] = [
  { value: 'products', label: 'Materiais' },
  { value: 'movements', label: 'Movimentações' },
];

// The registry (Phase 09e): where products and stock movements are recorded,
// feeding the dashboard and the chat. The screen is offered only to users the
// server allows, and the server checks every request again.
export function CatalogPage() {
  const [tab, setTab] = useState<Tab>('products');
  const options = useApiData('catalog-options', (signal) => CatalogService.options(signal));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-6 pt-[18px] pb-24">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em]">Cadastro</h1>
          <p className="mt-[3px] text-[12.5px] text-text-3">
            Materiais e movimentações de estoque. O que é lançado aqui aparece no dashboard e nas
            respostas do chat.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Seções do cadastro"
          className="flex gap-1 border-b border-line"
        >
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => {
                setTab(item.value);
              }}
              className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13.5px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                tab === item.value
                  ? 'border-accent font-semibold text-text'
                  : 'border-transparent font-medium text-text-2 hover:text-text'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {options.error !== undefined && <ErrorMessage message={options.error} />}
        {!options.data && options.error === undefined && <Spinner label="Carregando o cadastro…" />}
        {options.data && tab === 'products' && <ProductsTab options={options.data} />}
        {options.data && tab === 'movements' && <MovementsTab options={options.data} />}
      </div>
    </div>
  );
}
