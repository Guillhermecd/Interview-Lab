import {
  PRODUCT_STATUS_FILTERS,
  type CatalogOptions,
  type CatalogProduct,
  type ProductStatusFilter,
} from '@interview-lab/shared';
import { useState } from 'react';
import { toApiError } from '../../api/modules/api';
import { CatalogService } from '../../api/modules/catalog.service';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { CONTROL_CLASS } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useApiData } from '../../hooks/useApiData';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useMoney } from '../../hooks/useMoneyVisibility';
import { formatInteger } from '../../utils/format';
import { Pagination } from './Pagination';
import { ProductDialog } from './ProductDialog';
import { StockLevelsDialog } from './StockLevelsDialog';

interface ProductsTabProps {
  options: CatalogOptions;
}

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
const STATUS_LABELS: Record<ProductStatusFilter, string> = {
  active: 'Ativos',
  archived: 'Arquivados',
  all: 'Todos',
};
const HEAD_CLASS =
  'border-y border-line bg-surface-2 px-3 py-[7px] text-[11.5px] font-medium whitespace-nowrap text-text-3';

// What is open over the list: a form, the stock of a product, or a confirmation.
type Open =
  | { kind: 'create' }
  | { kind: 'edit'; product: CatalogProduct }
  | { kind: 'stock'; product: CatalogProduct }
  | { kind: 'archive'; product: CatalogProduct };

// The products of the registry: search, create, edit, set the minimum stock,
// archive and restore. Archiving replaces deleting: the history stays.
export function ProductsTab({ options }: ProductsTabProps) {
  const money = useMoney();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<ProductStatusFilter>('active');
  const [page, setPage] = useState(1);
  // Changes after each write, so the list is read again.
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState<Open>();
  const [actionError, setActionError] = useState<string>();

  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const query = {
    search: debouncedSearch,
    category,
    status,
    page,
    pageSize: PAGE_SIZE,
  };
  const products = useApiData(`products:${JSON.stringify(query)}:${String(revision)}`, (signal) =>
    CatalogService.listProducts(query, signal),
  );

  function reload() {
    setOpen(undefined);
    setRevision((current) => current + 1);
  }

  // A filter change goes back to the first page of the new list.
  function filter(change: () => void) {
    change();
    setPage(1);
  }

  async function setActive(product: CatalogProduct, active: boolean) {
    setActionError(undefined);
    try {
      await (active
        ? CatalogService.restoreProduct(product.id)
        : CatalogService.archiveProduct(product.id));
      reload();
    } catch (error) {
      setOpen(undefined);
      setActionError(toApiError(error).message);
    }
  }

  return (
    <section aria-label="Materiais" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-text-2">
          Buscar
          <input
            type="search"
            value={search}
            onChange={(event) => {
              filter(() => {
                setSearch(event.target.value);
              });
            }}
            placeholder="SKU ou nome do material"
            className={CONTROL_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text-2">
          Categoria
          <select
            value={category}
            onChange={(event) => {
              filter(() => {
                setCategory(event.target.value);
              });
            }}
            className={CONTROL_CLASS}
          >
            <option value="">Todas</option>
            {options.categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text-2">
          Situação
          <select
            value={status}
            onChange={(event) => {
              const next = PRODUCT_STATUS_FILTERS.find((item) => item === event.target.value);
              if (next) {
                filter(() => {
                  setStatus(next);
                });
              }
            }}
            className={CONTROL_CLASS}
          >
            {PRODUCT_STATUS_FILTERS.map((item) => (
              <option key={item} value={item}>
                {STATUS_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <Button
          onClick={() => {
            setOpen({ kind: 'create' });
          }}
        >
          Novo material
        </Button>
      </div>

      {products.error !== undefined && <ErrorMessage message={products.error} />}
      {actionError !== undefined && <ErrorMessage message={actionError} />}
      {!products.data && products.error === undefined && <Spinner label="Carregando materiais…" />}

      {products.data && (
        <div
          aria-busy={products.isLoading}
          className="overflow-hidden rounded-lg border border-line bg-surface"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th scope="col" className={`${HEAD_CLASS} text-left`}>
                    SKU
                  </th>
                  <th scope="col" className={`${HEAD_CLASS} w-[30%] text-left`}>
                    Material
                  </th>
                  <th scope="col" className={`${HEAD_CLASS} text-left`}>
                    Categoria
                  </th>
                  <th scope="col" className={`${HEAD_CLASS} text-right`}>
                    Preço
                  </th>
                  <th scope="col" className={`${HEAD_CLASS} text-right`}>
                    Custo
                  </th>
                  <th scope="col" className={`${HEAD_CLASS} text-right`}>
                    Estoque
                  </th>
                  <th scope="col" className={`${HEAD_CLASS} text-left`}>
                    Situação
                  </th>
                  <th scope="col" className={`${HEAD_CLASS} text-right`}>
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.data.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-[13px] text-text-2">
                      Nenhum material para os filtros escolhidos.
                    </td>
                  </tr>
                )}
                {products.data.items.map((product) => (
                  <tr key={product.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{product.sku}</td>
                    <th scope="row" className="max-w-0 truncate px-3 py-2 text-left font-normal">
                      {product.name}
                    </th>
                    <td className="px-3 py-2 whitespace-nowrap text-text-2">{product.category}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {money.currency(product.price)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {money.currency(product.cost)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {formatInteger(product.totalQuantity)} {product.unit}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex h-[22px] items-center rounded px-2 text-xs font-semibold ${
                          product.active ? 'bg-ok-soft text-ok' : 'bg-surface-3 text-text-2'
                        }`}
                      >
                        {product.active ? 'Ativo' : 'Arquivado'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Editar ${product.name}`}
                          onClick={() => {
                            setOpen({ kind: 'edit', product });
                          }}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Estoque de ${product.name}`}
                          onClick={() => {
                            setOpen({ kind: 'stock', product });
                          }}
                        >
                          Estoque
                        </Button>
                        {product.active ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Arquivar ${product.name}`}
                            onClick={() => {
                              setOpen({ kind: 'archive', product });
                            }}
                          >
                            Arquivar
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Restaurar ${product.name}`}
                            onClick={() => {
                              void setActive(product, true);
                            }}
                          >
                            Restaurar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            label="materiais"
            page={products.data.page}
            pageSize={products.data.pageSize}
            total={products.data.total}
            onPageChange={setPage}
          />
        </div>
      )}

      {(open?.kind === 'create' || open?.kind === 'edit') && (
        <ProductDialog
          product={open.kind === 'edit' ? open.product : undefined}
          options={options}
          onSaved={reload}
          onClose={() => {
            setOpen(undefined);
          }}
        />
      )}
      {open?.kind === 'stock' && (
        <StockLevelsDialog
          product={open.product}
          onClose={() => {
            // The total of the list may be stale only if a movement happened
            // meanwhile; minimums do not change it.
            setOpen(undefined);
          }}
        />
      )}
      {open?.kind === 'archive' && (
        <Modal
          title="Arquivar material"
          onClose={() => {
            setOpen(undefined);
          }}
        >
          <div className="flex flex-col gap-3 p-4">
            <p className="text-[13px] text-text-2">
              <strong className="font-semibold text-text">{open.product.name}</strong> sai das
              listas e deixa de aceitar movimentações. O histórico de pedidos e de estoque continua,
              e o material pode ser restaurado depois.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(undefined);
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  void setActive(open.product, false);
                }}
              >
                Arquivar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
