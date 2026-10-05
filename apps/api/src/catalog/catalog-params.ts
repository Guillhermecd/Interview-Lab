import {
  PRODUCT_STATUS_FILTERS,
  PRODUCT_UNITS,
  STOCK_MOVEMENT_TYPES,
  type ProductInput,
  type StockMovementInput,
} from '@interview-lab/shared';
import { ValidationError } from '../http/validation-error.js';
import type { MovementListFilter, ProductListFilter } from './catalog.repository.js';

const ID_PATTERN = /^[1-9][0-9]{0,17}$/;
// Letters, digits and hyphens, starting with a letter or digit.
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,29}$/;
const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 100;
const MAX_SEARCH_LENGTH = 100;
const MAX_DOCUMENT_LENGTH = 80;
// numeric(12, 2) in the database.
const MAX_MONEY = 9_999_999_999.99;
const CENTS = 100;
// Far above any real movement, and far below what an integer column holds.
export const MAX_MOVEMENT_QUANTITY = 1_000_000;
const MAX_MINIMUM_STOCK = 10_000_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function invalid(name: string, message: string): ValidationError {
  return new ValidationError([{ field: name, message }]);
}

function field(source: unknown, name: string): unknown {
  return typeof source === 'object' && source !== null
    ? (source as Record<string, unknown>)[name]
    : undefined;
}

// A query parameter given once, as text. Absent or empty means "not given".
function queryText(query: unknown, name: string): string | undefined {
  const value = field(query, name);
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw invalid(name, 'Informe um único valor.');
  }
  return value;
}

function oneOf<Value extends string>(
  value: unknown,
  name: string,
  allowed: readonly Value[],
): Value {
  const known = allowed.find((candidate) => candidate === value);
  if (known === undefined) {
    throw invalid(name, `Valores aceitos: ${allowed.join(', ')}.`);
  }
  return known;
}

// An identifier in the address or in the body. `name` is the field reported.
export function readId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw invalid(name, 'Identificador inválido.');
  }
  return value;
}

function readText(body: unknown, name: string, min: number, max: number, label: string): string {
  const value = field(body, name);
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max) {
    throw invalid(
      name,
      min === max
        ? `${label} deve ter ${String(min)} caracteres.`
        : `${label} deve ter entre ${String(min)} e ${String(max)} caracteres.`,
    );
  }
  return text;
}

function readMoney(body: unknown, name: string, label: string): number {
  const value = field(body, name);
  const isMoney =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_MONEY &&
    Math.round(value * CENTS) / CENTS === value;
  if (!isMoney) {
    throw invalid(name, `${label} deve ser um valor maior que zero, com até duas casas decimais.`);
  }
  return value;
}

function readInteger(body: unknown, name: string): number | undefined {
  const value = field(body, name);
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

// The category is checked against the existing ones by the service (D-59).
export function readProductInput(body: unknown): ProductInput {
  const sku = field(body, 'sku');
  const normalizedSku = typeof sku === 'string' ? sku.trim().toUpperCase() : '';
  if (!SKU_PATTERN.test(normalizedSku)) {
    throw invalid('sku', 'O SKU deve ter de 2 a 30 caracteres: letras, números e hífen.');
  }
  return {
    sku: normalizedSku,
    name: readText(body, 'name', MIN_NAME_LENGTH, MAX_NAME_LENGTH, 'O nome'),
    category: readText(body, 'category', 1, MAX_CATEGORY_LENGTH, 'A categoria'),
    unit: oneOf(field(body, 'unit'), 'unit', PRODUCT_UNITS),
    price: readMoney(body, 'price', 'O preço'),
    cost: readMoney(body, 'cost', 'O custo'),
  };
}

export function readMinimumStock(body: unknown): number {
  const minimum = readInteger(body, 'minimumQuantity');
  if (minimum === undefined || minimum < 0 || minimum > MAX_MINIMUM_STOCK) {
    throw invalid(
      'minimumQuantity',
      `O estoque mínimo deve ser um número inteiro entre 0 e ${String(MAX_MINIMUM_STOCK)}.`,
    );
  }
  return minimum;
}

export function readMovementInput(body: unknown): StockMovementInput {
  const type = oneOf(field(body, 'type'), 'type', STOCK_MOVEMENT_TYPES);
  const productId = readId(field(body, 'productId'), 'productId');
  const distributionCenterId = readId(field(body, 'distributionCenterId'), 'distributionCenterId');

  const quantity = readInteger(body, 'quantity');
  const outOfRange =
    quantity === undefined || quantity === 0 || Math.abs(quantity) > MAX_MOVEMENT_QUANTITY;
  // Only an adjustment carries a sign: it may take stock out.
  if (outOfRange || (type !== 'adjustment' && quantity < 0)) {
    throw invalid(
      'quantity',
      type === 'adjustment'
        ? `A quantidade deve ser um número inteiro diferente de zero, até ${String(MAX_MOVEMENT_QUANTITY)} para mais ou para menos.`
        : `A quantidade deve ser um número inteiro entre 1 e ${String(MAX_MOVEMENT_QUANTITY)}.`,
    );
  }

  const input: StockMovementInput = {
    type,
    productId,
    distributionCenterId,
    quantity,
    document: readText(body, 'document', 1, MAX_DOCUMENT_LENGTH, 'O documento'),
  };
  if (type === 'transfer') {
    const destination = readId(field(body, 'destinationCenterId'), 'destinationCenterId');
    if (destination === distributionCenterId) {
      throw invalid('destinationCenterId', 'O destino deve ser diferente da origem.');
    }
    input.destinationCenterId = destination;
  }
  return input;
}

function readPage(query: unknown): { page: number; pageSize: number } {
  const read = (name: string, fallback: number, max: number) => {
    const text = queryText(query, name);
    if (text === undefined) {
      return fallback;
    }
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw invalid(name, `Informe um número inteiro entre 1 e ${String(max)}.`);
    }
    return value;
  };
  return {
    page: read('page', 1, Number.MAX_SAFE_INTEGER),
    pageSize: read('pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

export function readProductListFilter(query: unknown): ProductListFilter {
  const search = queryText(query, 'search')?.trim();
  if (search !== undefined && search.length > MAX_SEARCH_LENGTH) {
    throw invalid('search', `A busca pode ter no máximo ${String(MAX_SEARCH_LENGTH)} caracteres.`);
  }
  const category = queryText(query, 'category');
  if (category !== undefined && category.length > MAX_CATEGORY_LENGTH) {
    throw invalid('category', 'Categoria inválida.');
  }
  const status = queryText(query, 'status');
  return {
    search: search === '' ? undefined : search,
    category,
    status: status === undefined ? 'active' : oneOf(status, 'status', PRODUCT_STATUS_FILTERS),
    ...readPage(query),
  };
}

export function readMovementListFilter(query: unknown): MovementListFilter {
  const productId = queryText(query, 'productId');
  const type = queryText(query, 'type');
  return {
    productId: productId === undefined ? undefined : readId(productId, 'productId'),
    type: type === undefined ? undefined : oneOf(type, 'type', STOCK_MOVEMENT_TYPES),
    ...readPage(query),
  };
}
