import { describe, expect, it } from 'vitest';
import { ValidationError } from '../http/validation-error.js';
import {
  readId,
  readMinimumStock,
  readMovementInput,
  readMovementListFilter,
  readProductInput,
  readProductListFilter,
} from './catalog-params.js';

const PRODUCT = {
  sku: ' cim-50 ',
  name: '  Cimento 50 kg ',
  category: 'Cimento',
  unit: 'sc',
  price: 38.5,
  cost: 25,
};

const MOVEMENT = {
  type: 'inbound',
  productId: '1',
  distributionCenterId: '2',
  quantity: 10,
  document: ' NF-e 1 ',
};

function fieldOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.details[0]?.field;
    }
    throw error;
  }
  return undefined;
}

describe('readProductInput', () => {
  it('trims the texts and puts the SKU in upper case', () => {
    expect(readProductInput(PRODUCT)).toEqual({
      sku: 'CIM-50',
      name: 'Cimento 50 kg',
      category: 'Cimento',
      unit: 'sc',
      price: 38.5,
      cost: 25,
    });
  });

  it('keeps only the known fields', () => {
    const input = readProductInput({ ...PRODUCT, id: '99', active: false, totalQuantity: 5 });

    expect(Object.keys(input).sort()).toEqual(['category', 'cost', 'name', 'price', 'sku', 'unit']);
  });

  it.each([
    ['sku', { sku: '' }],
    ['sku', { sku: 'a' }],
    ['sku', { sku: '-ABC' }],
    ['sku', { sku: 'X'.repeat(31) }],
    ['sku', { sku: 12 }],
    ['name', { name: 'ab' }],
    ['name', { name: 'x'.repeat(121) }],
    ['category', { category: '   ' }],
    ['unit', { unit: 'kg' }],
    ['price', { price: 0 }],
    ['price', { price: -1 }],
    ['price', { price: 10.001 }],
    ['price', { price: '10' }],
    ['price', { price: Number.NaN }],
    ['price', { price: 10_000_000_000 }],
    ['cost', { cost: undefined }],
  ])('refuses an invalid %s (%j)', (field, change) => {
    expect(fieldOf(() => readProductInput({ ...PRODUCT, ...change }))).toBe(field);
  });

  it('refuses a body that is not an object', () => {
    expect(fieldOf(() => readProductInput(undefined))).toBe('sku');
    expect(fieldOf(() => readProductInput('texto'))).toBe('sku');
  });
});

describe('readMovementInput', () => {
  it('reads an entry, ignoring fields the server sets', () => {
    const input = readMovementInput({
      ...MOVEMENT,
      responsibleName: 'Outra pessoa',
      movedAt: '2020-01-01',
      destinationCenterId: '3',
    });

    expect(input).toEqual({
      type: 'inbound',
      productId: '1',
      distributionCenterId: '2',
      quantity: 10,
      document: 'NF-e 1',
    });
  });

  it('reads a transfer with its destination', () => {
    expect(
      readMovementInput({ ...MOVEMENT, type: 'transfer', destinationCenterId: '3' }),
    ).toMatchObject({ type: 'transfer', destinationCenterId: '3' });
  });

  it('accepts a negative quantity only for an adjustment', () => {
    expect(readMovementInput({ ...MOVEMENT, type: 'adjustment', quantity: -5 }).quantity).toBe(-5);
    expect(fieldOf(() => readMovementInput({ ...MOVEMENT, type: 'outbound', quantity: -5 }))).toBe(
      'quantity',
    );
  });

  it.each([
    ['type', { type: 'theft' }],
    ['productId', { productId: 1 }],
    ['productId', { productId: '0' }],
    ['distributionCenterId', { distributionCenterId: '1 OR 1=1' }],
    ['quantity', { quantity: 0 }],
    ['quantity', { quantity: 1.5 }],
    ['quantity', { quantity: '10' }],
    ['quantity', { quantity: 1_000_001 }],
    ['quantity', { type: 'adjustment', quantity: -1_000_001 }],
    ['document', { document: '' }],
    ['document', { document: 'x'.repeat(81) }],
    ['destinationCenterId', { type: 'transfer' }],
    ['destinationCenterId', { type: 'transfer', destinationCenterId: '2' }],
  ])('refuses an invalid %s (%j)', (field, change) => {
    expect(fieldOf(() => readMovementInput({ ...MOVEMENT, ...change }))).toBe(field);
  });
});

describe('other parameters', () => {
  it('reads identifiers', () => {
    expect(readId('42', 'id')).toBe('42');
    expect(fieldOf(() => readId('abc', 'id'))).toBe('id');
    expect(fieldOf(() => readId(undefined, 'centerId'))).toBe('centerId');
  });

  it('reads the minimum stock', () => {
    expect(readMinimumStock({ minimumQuantity: 0 })).toBe(0);
    expect(readMinimumStock({ minimumQuantity: 40 })).toBe(40);
    expect(fieldOf(() => readMinimumStock({ minimumQuantity: -1 }))).toBe('minimumQuantity');
    expect(fieldOf(() => readMinimumStock({ minimumQuantity: 1.5 }))).toBe('minimumQuantity');
    expect(fieldOf(() => readMinimumStock({}))).toBe('minimumQuantity');
  });

  it('lists active products on the first page by default', () => {
    expect(readProductListFilter({})).toEqual({
      search: undefined,
      category: undefined,
      status: 'active',
      page: 1,
      pageSize: 20,
    });
  });

  it('reads the filters and the page of the product list', () => {
    expect(
      readProductListFilter({
        search: '  cimento ',
        category: 'Aço',
        status: 'all',
        page: '3',
        pageSize: '50',
      }),
    ).toEqual({ search: 'cimento', category: 'Aço', status: 'all', page: 3, pageSize: 50 });
    expect(readProductListFilter({ search: '   ' }).search).toBeUndefined();
  });

  it.each([
    ['status', { status: 'deleted' }],
    ['page', { page: '0' }],
    ['page', { page: 'x' }],
    ['pageSize', { pageSize: '101' }],
    ['search', { search: 'x'.repeat(101) }],
    ['search', { search: ['a', 'b'] }],
  ])('refuses an invalid %s in the product list', (field, query) => {
    expect(fieldOf(() => readProductListFilter(query))).toBe(field);
  });

  it('reads the filters of the movement list', () => {
    expect(readMovementListFilter({ productId: '7', type: 'transfer' })).toEqual({
      productId: '7',
      type: 'transfer',
      page: 1,
      pageSize: 20,
    });
    expect(fieldOf(() => readMovementListFilter({ productId: 'x' }))).toBe('productId');
    expect(fieldOf(() => readMovementListFilter({ type: 'x' }))).toBe('type');
  });
});
