const DEFAULT_PORT = 3000;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

export interface AppEnv {
  port: number;
}

export class InvalidEnvError extends Error {
  constructor(variable: string, reason: string) {
    super(`Invalid environment variable ${variable}: ${reason}`);
    this.name = 'InvalidEnvError';
  }
}

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort === '') {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new InvalidEnvError(
      'PORT',
      `expected an integer between ${String(MIN_PORT)} and ${String(MAX_PORT)}`,
    );
  }

  return port;
}

export function loadEnv(source: NodeJS.ProcessEnv): AppEnv {
  return { port: parsePort(source.PORT) };
}
