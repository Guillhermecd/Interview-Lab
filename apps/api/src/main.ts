import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadEnv } from './config/env.js';

const LISTEN_HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(env),
    new FastifyAdapter(),
  );
  await configureApp(app);
  await app.listen(env.port, LISTEN_HOST);
}

void bootstrap();
