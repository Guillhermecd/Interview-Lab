import type { ApiErrorDetail } from '@interview-lab/shared';

export class ValidationError extends Error {
  constructor(readonly details: ApiErrorDetail[]) {
    super('Um ou mais campos são inválidos.');
    this.name = 'ValidationError';
  }
}
