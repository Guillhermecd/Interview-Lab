import type { CatalogProduct, ProductStockLevel } from '@interview-lab/shared';
import { useState } from 'react';
import { toApiError } from '../../api/modules/api';
import { CatalogService } from '../../api/modules/catalog.service';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { CONTROL_CLASS } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useApiData } from '../../hooks/useApiData';
import { formatInteger } from '../../utils/format';
import { parseNumber } from './catalog-helpers';

interface StockLevelsDialogProps {
  product: CatalogProduct;
  onClose: () => void;
}

const HEAD_CLASS = 'border-b border-line py-2 text-[11.5px] font-medium text-text-3';

// The stock of a product in each center. The balance only changes through
// movements, so it is shown and not edited; the minimum is what is set here.
export function StockLevelsDialog({ product, onClose }: StockLevelsDialogProps) {
  const detail = useApiData(`product:${product.id}`, (signal) =>
    CatalogService.product(product.id, signal),
  );
  // What the user typed, by center; a center not in here keeps its minimum.
  const [typed, setTyped] = useState<Record<string, string>>({});
  // What the server confirmed after saving, by center.
  const [saved, setSaved] = useState<Record<string, ProductStockLevel>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const levels = (detail.data?.stockLevels ?? []).map(
    (level) => saved[level.distributionCenterId] ?? level,
  );
  const changes = levels.flatMap((level) => {
    const text = typed[level.distributionCenterId];
    const minimum = text === undefined ? undefined : parseNumber(text);
    return minimum === undefined || minimum === level.minimumQuantity
      ? []
      : [{ centerId: level.distributionCenterId, minimumQuantity: minimum }];
  });

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      for (const change of changes) {
        const level = await CatalogService.setMinimumStock(product.id, change.centerId, {
          minimumQuantity: change.minimumQuantity,
        });
        setSaved((current) => ({ ...current, [change.centerId]: level }));
        setTyped((current) => {
          const { [change.centerId]: _done, ...rest } = current;
          return rest;
        });
      }
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Estoque · ${product.name}`} onClose={onClose} size="lg">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[12.5px] text-text-2">
          O saldo muda só por movimentações. Aqui você define o estoque mínimo de cada centro, usado
          nos alertas de ruptura.
        </p>
        {detail.error !== undefined && <ErrorMessage message={detail.error} />}
        {error !== undefined && <ErrorMessage message={error} />}
        {detail.isLoading && !detail.data && <Spinner label="Carregando o estoque…" />}
        {detail.data && (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th scope="col" className={`${HEAD_CLASS} text-left`}>
                  Centro de distribuição
                </th>
                <th scope="col" className={`${HEAD_CLASS} text-right`}>
                  Saldo ({product.unit})
                </th>
                <th scope="col" className={`${HEAD_CLASS} w-36 pl-4 text-left`}>
                  Estoque mínimo
                </th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr key={level.distributionCenterId} className="border-b border-line">
                  <td className="py-2">{level.distributionCenter}</td>
                  <td className="py-2 text-right font-mono">{formatInteger(level.quantity)}</td>
                  <td className="py-1.5 pl-4">
                    <input
                      aria-label={`Estoque mínimo em ${level.distributionCenter}`}
                      inputMode="numeric"
                      value={
                        typed[level.distributionCenterId] ?? String(level.minimumQuantity)
                      }
                      onChange={(event) => {
                        setTyped({ ...typed, [level.distributionCenterId]: event.target.value });
                      }}
                      className={`${CONTROL_CLASS} font-mono`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button
            disabled={saving || changes.length === 0}
            onClick={() => {
              void save();
            }}
          >
            {saving ? 'Salvando…' : 'Salvar mínimos'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
