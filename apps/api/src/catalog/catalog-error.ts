import { HttpException, HttpStatus } from '@nestjs/common';

const ERRORS = {
  PRODUCT_NOT_FOUND: [HttpStatus.NOT_FOUND, 'Material não encontrado.'],
  DISTRIBUTION_CENTER_NOT_FOUND: [HttpStatus.NOT_FOUND, 'Centro de distribuição não encontrado.'],
  SKU_IN_USE: [HttpStatus.CONFLICT, 'Já existe um material com este SKU.'],
  NAME_IN_USE: [HttpStatus.CONFLICT, 'Já existe um material com este nome.'],
  PRODUCT_ARCHIVED: [
    HttpStatus.CONFLICT,
    'O material está arquivado. Restaure-o para lançar movimentações.',
  ],
  INSUFFICIENT_STOCK: [
    HttpStatus.CONFLICT,
    'O estoque do centro de distribuição é menor que a quantidade informada.',
  ],
  STOCK_LIMIT_EXCEEDED: [
    HttpStatus.UNPROCESSABLE_ENTITY,
    'O estoque resultante passa do limite que o sistema registra.',
  ],
} as const;

export type CatalogErrorCode = keyof typeof ERRORS;

// A refusal of the registry, with a stable code the client decides by.
export class CatalogError extends HttpException {
  constructor(readonly code: CatalogErrorCode) {
    const [status, message] = ERRORS[code];
    super({ code, message }, status);
  }
}
