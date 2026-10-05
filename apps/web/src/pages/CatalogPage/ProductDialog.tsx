import {
  PRODUCT_UNITS,
  type CatalogOptions,
  type CatalogProduct,
  type ProductUnit,
} from '@interview-lab/shared';
import { useState, type FormEvent } from 'react';
import { CatalogService } from '../../api/modules/catalog.service';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { SelectField, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import {
  NO_ERRORS,
  parseNumber,
  toFormErrors,
  UNIT_LABELS,
  type FormErrors,
} from './catalog-helpers';

interface ProductDialogProps {
  // The product being edited; absent to create one.
  product?: CatalogProduct | undefined;
  options: CatalogOptions;
  onSaved: () => void;
  onClose: () => void;
}

const FIELDS = ['sku', 'name', 'category', 'unit', 'price', 'cost'] as const;

function isUnit(value: string): value is ProductUnit {
  return PRODUCT_UNITS.some((unit) => unit === value);
}

// Creates a product or replaces its data. The form only collects what was
// typed; SKU and name uniqueness, the category and the values are checked by
// the server, and what it refuses appears under the field.
export function ProductDialog({ product, options, onSaved, onClose }: ProductDialogProps) {
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [unit, setUnit] = useState<string>(product?.unit ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [cost, setCost] = useState(product ? String(product.cost) : '');
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const priceValue = parseNumber(price);
    const costValue = parseNumber(cost);
    // Only what cannot even be sent is stopped here.
    if (!isUnit(unit) || priceValue === undefined || costValue === undefined) {
      setErrors({
        fields: {
          ...(!isUnit(unit) && { unit: 'Escolha a unidade.' }),
          ...(priceValue === undefined && { price: 'Informe o preço.' }),
          ...(costValue === undefined && { cost: 'Informe o custo.' }),
        },
      });
      return;
    }

    const input = { sku, name, category, unit, price: priceValue, cost: costValue };
    setSaving(true);
    setErrors(NO_ERRORS);
    try {
      if (product) {
        await CatalogService.updateProduct(product.id, input);
      } else {
        await CatalogService.createProduct(input);
      }
      onSaved();
    } catch (error) {
      setErrors(toFormErrors(error, FIELDS));
      setSaving(false);
    }
  }

  return (
    <Modal title={product ? 'Editar material' : 'Novo material'} onClose={onClose}>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        className="flex flex-col gap-3 p-4"
      >
        {errors.general !== undefined && <ErrorMessage message={errors.general} />}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <TextField
            label="SKU"
            mono
            value={sku}
            onChange={(event) => {
              setSku(event.target.value);
            }}
            error={errors.fields.sku}
            maxLength={30}
            autoComplete="off"
          />
          <TextField
            label="Nome"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            error={errors.fields.name}
            maxLength={120}
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Categoria"
            placeholder="Escolha…"
            options={options.categories.map((item) => ({ value: item, label: item }))}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
            error={errors.fields.category}
          />
          <SelectField
            label="Unidade"
            placeholder="Escolha…"
            options={options.units.map((item) => ({ value: item, label: UNIT_LABELS[item] }))}
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value);
            }}
            error={errors.fields.unit}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Preço de venda (R$)"
            mono
            inputMode="decimal"
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
            }}
            error={errors.fields.price}
          />
          <TextField
            label="Custo (R$)"
            mono
            inputMode="decimal"
            value={cost}
            onChange={(event) => {
              setCost(event.target.value);
            }}
            error={errors.fields.cost}
          />
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
