import {
  STOCK_MOVEMENT_TYPES,
  type CatalogOptions,
  type CatalogProduct,
  type RecordedStockMovement,
  type StockMovementType,
} from '@interview-lab/shared';
import { useState } from 'react';
import { CatalogService } from '../../api/modules/catalog.service';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { SelectField, TextField } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { useApiData } from '../../hooks/useApiData';
import { formatInteger } from '../../utils/format';
import { MOVEMENT_TYPE_LABELS } from '../DashboardPage/labels';
import { MovementsTable } from '../DashboardPage/tables';
import { NO_ERRORS, parseNumber, toFormErrors, type FormErrors } from './catalog-helpers';
import { Pagination } from './Pagination';
import { ProductPicker } from './ProductPicker';

interface MovementsTabProps {
  options: CatalogOptions;
}

const PAGE_SIZE = 10;
const FIELDS = [
  'type',
  'productId',
  'distributionCenterId',
  'destinationCenterId',
  'quantity',
  'document',
] as const;

const QUANTITY_HINTS: Record<StockMovementType, string> = {
  inbound: 'Quanto entrou no centro.',
  outbound: 'Quanto saiu do centro.',
  transfer: 'Quanto vai da origem para o destino.',
  adjustment: 'Positivo para acrescentar, negativo para retirar (ex.: -12).',
};

function isMovementType(value: string): value is StockMovementType {
  return STOCK_MOVEMENT_TYPES.some((type) => type === value);
}

// Records stock movements and lists the latest. A movement is never edited or
// removed: a mistake is fixed with an adjustment. Whether there is enough
// stock is decided by the server, which updates the balance with the movement.
export function MovementsTab({ options }: MovementsTabProps) {
  const [type, setType] = useState<StockMovementType>('inbound');
  const [product, setProduct] = useState<CatalogProduct>();
  const [centerId, setCenterId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [document, setDocument] = useState('');
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [saving, setSaving] = useState(false);
  const [recorded, setRecorded] = useState<RecordedStockMovement>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);

  const movements = useApiData(`movements:${String(page)}:${String(revision)}`, (signal) =>
    CatalogService.listMovements({ page, pageSize: PAGE_SIZE }, signal),
  );
  const centers = options.distributionCenters.map((center) => ({
    value: center.id,
    label: center.name,
  }));

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    const amount = parseNumber(quantity);
    // Only what cannot even be sent is stopped here.
    if (product === undefined || amount === undefined) {
      setErrors({
        fields: {
          ...(product === undefined && { productId: 'Escolha o material.' }),
          ...(amount === undefined && { quantity: 'Informe a quantidade.' }),
        },
      });
      return;
    }

    setSaving(true);
    setErrors(NO_ERRORS);
    setRecorded(undefined);
    try {
      const result = await CatalogService.recordMovement({
        type,
        productId: product.id,
        distributionCenterId: centerId,
        ...(type === 'transfer' && { destinationCenterId: destinationId }),
        quantity: amount,
        document,
      });
      setRecorded(result);
      setQuantity('');
      setDocument('');
      setPage(1);
      setRevision((current) => current + 1);
    } catch (error) {
      setErrors(toFormErrors(error, FIELDS));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Movimentações" className="flex flex-col gap-4">
      <form
        aria-label="Lançar movimentação"
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">Lançar movimentação</h2>
        {errors.general !== undefined && <ErrorMessage message={errors.general} />}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
          <SelectField
            label="Tipo"
            options={STOCK_MOVEMENT_TYPES.map((item) => ({
              value: item,
              label: MOVEMENT_TYPE_LABELS[item],
            }))}
            value={type}
            onChange={(event) => {
              if (isMovementType(event.target.value)) {
                setType(event.target.value);
              }
            }}
            error={errors.fields.type}
          />
          <ProductPicker value={product} onChange={setProduct} error={errors.fields.productId} />
          <SelectField
            label={type === 'transfer' ? 'Centro de origem' : 'Centro de distribuição'}
            placeholder="Escolha…"
            options={centers}
            value={centerId}
            onChange={(event) => {
              setCenterId(event.target.value);
            }}
            error={errors.fields.distributionCenterId}
          />
          {type === 'transfer' && (
            <SelectField
              label="Centro de destino"
              placeholder="Escolha…"
              options={centers}
              value={destinationId}
              onChange={(event) => {
                setDestinationId(event.target.value);
              }}
              error={errors.fields.destinationCenterId}
            />
          )}
          <TextField
            label={product ? `Quantidade (${product.unit})` : 'Quantidade'}
            mono
            inputMode="numeric"
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
            error={errors.fields.quantity}
            hint={QUANTITY_HINTS[type]}
          />
          <TextField
            label="Documento ou motivo"
            value={document}
            onChange={(event) => {
              setDocument(event.target.value);
            }}
            error={errors.fields.document}
            hint="Nota fiscal, pedido ou o motivo do ajuste."
            maxLength={80}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-3">
            Data, hora e responsável são registrados pelo sistema.
          </p>
          <Button type="submit" disabled={saving}>
            {saving ? 'Lançando…' : 'Lançar movimentação'}
          </Button>
        </div>
      </form>

      {recorded && (
        <Alert
          variant="ok"
          title="Movimentação registrada"
          body={recorded.stockLevels
            .map(
              (level) =>
                `Saldo em ${level.distributionCenter}: ${formatInteger(level.quantity)} ${recorded.movement.unit}.`,
            )
            .join(' ')}
        />
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <h2 className="px-4 pt-3.5 pb-2.5 text-sm font-semibold">Últimas movimentações</h2>
        {movements.error !== undefined && (
          <div className="px-4 pb-3">
            <ErrorMessage message={movements.error} />
          </div>
        )}
        {!movements.data && movements.error === undefined && (
          <div className="px-4 pb-3">
            <Spinner label="Carregando movimentações…" />
          </div>
        )}
        {movements.data && (
          <>
            <MovementsTable movements={movements.data.items} />
            <Pagination
              label="movimentações"
              page={movements.data.page}
              pageSize={movements.data.pageSize}
              total={movements.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </section>
  );
}
