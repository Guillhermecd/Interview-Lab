import type { CatalogProduct } from '@interview-lab/shared';
import { useId, useState } from 'react';
import { CatalogService } from '../../api/modules/catalog.service';
import { Button } from '../../components/ui/Button';
import { CONTROL_CLASS } from '../../components/ui/Field';
import { useApiData } from '../../hooks/useApiData';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

interface ProductPickerProps {
  value: CatalogProduct | undefined;
  onChange: (product: CatalogProduct | undefined) => void;
  error?: string | undefined;
}

const RESULTS = 8;
const SEARCH_DELAY_MS = 300;
const MIN_SEARCH_LENGTH = 2;

// Picks one active product by typing part of its SKU or name. The catalog is
// too long for a plain list, so the server does the searching.
export function ProductPicker({ value, onChange, error }: ProductPickerProps) {
  const inputId = useId();
  const errorId = useId();
  const [text, setText] = useState('');
  const search = useDebouncedValue(text.trim(), SEARCH_DELAY_MS);
  const searching = value === undefined && search.length >= MIN_SEARCH_LENGTH;
  const results = useApiData(`pick:${searching ? search : ''}`, (signal) =>
    searching
      ? CatalogService.listProducts({ search, status: 'active', pageSize: RESULTS }, signal)
      : Promise.resolve(undefined),
  );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={inputId} className="text-xs font-medium text-text-2">
        Material
      </label>
      {value ? (
        <div className="flex h-8 items-center gap-2 rounded-md border border-line-2 bg-surface-2 pr-1 pl-2.5 text-[13px]">
          <span className="font-mono text-xs text-text-2">{value.sku}</span>
          <span className="min-w-0 flex-1 truncate">{value.name}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(undefined);
              setText('');
            }}
          >
            Trocar
          </Button>
        </div>
      ) : (
        <input
          id={inputId}
          type="search"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          placeholder="Digite o SKU ou parte do nome"
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          autoComplete="off"
          className={CONTROL_CLASS}
        />
      )}
      {error !== undefined && (
        <p id={errorId} className="text-xs text-crit">
          {error}
        </p>
      )}
      {searching && results.data && (
        <ul
          aria-label="Materiais encontrados"
          className="max-h-56 overflow-y-auto rounded-md border border-line bg-surface p-1"
        >
          {results.data.items.length === 0 && (
            <li className="px-2 py-1.5 text-[12.5px] text-text-2">
              Nenhum material ativo encontrado.
            </li>
          )}
          {results.data.items.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(product);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
              >
                <span className="font-mono text-xs text-text-2">{product.sku}</span>
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
