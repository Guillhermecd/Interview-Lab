import fastifyCookie from '@fastify/cookie';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiExceptionFilter } from './http/api-exception.filter.js';

export const API_PREFIX = 'api';

// Shared by main.ts and the tests so both run with the same HTTP configuration.
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  // Reads the session cookie (D-08).
  await app.register(fastifyCookie);
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
