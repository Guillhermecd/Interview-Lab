import type { ProductUnit } from '@interview-lab/shared';
import { toApiError } from '../../api/modules/api';

export const UNIT_LABELS: Record<ProductUnit, string> = {
  sc: 'Saco (sc)',
  br: 'Barra (br)',
  rl: 'Rolo (rl)',
  pr: 'Par (pr)',
  un: 'Unidade (un)',
};

// Which field a refusal of the server is about, when its code says so.
const FIELD_OF_CODE: Record<string, string> = {
  SKU_IN_USE: 'sku',
  NAME_IN_USE: 'name',
  PRODUCT_NOT_FOUND: 'productId',
  PRODUCT_ARCHIVED: 'productId',
  DISTRIBUTION_CENTER_NOT_FOUND: 'distributionCenterId',
  INSUFFICIENT_STOCK: 'quantity',
  STOCK_LIMIT_EXCEEDED: 'quantity',
};

export interface FormErrors {
  // Message per field, as the server sent it.
  fields: Record<string, string>;
  // A failure that belongs to no field of the form.
  general?: string;
}

export const NO_ERRORS: FormErrors = { fields: {} };

// Places what the server refused next to the field it is about. The decision is
// made by the error code and the field names of the API, never by the text.
export function toFormErrors(error: unknown, knownFields: readonly string[]): FormErrors {
  const apiError = toApiError(error);
  const fields: Record<string, string> = {};
  for (const detail of apiError.details ?? []) {
    if (knownFields.includes(detail.field)) {
      fields[detail.field] = detail.message;
    }
  }
  const field = FIELD_OF_CODE[apiError.code];
  if (field !== undefined && knownFields.includes(field)) {
    fields[field] = apiError.message;
  }
  return Object.keys(fields).length > 0 ? { fields } : { fields, general: apiError.message };
}

// A number typed in a form field; undefined while it is empty or not a number.
export function parseNumber(text: string): number | undefined {
  const value = Number(text.replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(value) ? undefined : value;
}
