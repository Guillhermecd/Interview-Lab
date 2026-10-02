import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export const API_PREFIX = 'api';

// Shared by main.ts and the tests so both run with the same HTTP configuration.
export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(API_PREFIX);
}
