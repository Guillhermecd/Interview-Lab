export class InvalidEnvError extends Error {
  constructor(variable: string, reason: string) {
    super(`Invalid environment variable ${variable}: ${reason}`);
    this.name = 'InvalidEnvError';
  }
}

interface IntegerOptions {
  defaultValue: number;
  min: number;
  max: number;
}

function isBlank(value: string | undefined): value is undefined | '' {
  return value === undefined || value === '';
}

export function requireValue(source: NodeJS.ProcessEnv, variable: string): string {
  const value = source[variable];
  if (isBlank(value)) {
    throw new InvalidEnvError(variable, 'is required');
  }
  return value;
}

export function parseInteger(
  source: NodeJS.ProcessEnv,
  variable: string,
  options: IntegerOptions,
): number {
  const rawValue = source[variable];
  if (isBlank(rawValue)) {
    return options.defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < options.min || value > options.max) {
    throw new InvalidEnvError(
      variable,
      `expected an integer between ${String(options.min)} and ${String(options.max)}`,
    );
  }
  return value;
}

export function parseBoolean(
  source: NodeJS.ProcessEnv,
  variable: string,
  defaultValue: boolean,
): boolean {
  const rawValue = source[variable];
  if (isBlank(rawValue)) {
    return defaultValue;
  }
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  throw new InvalidEnvError(variable, 'expected "true" or "false"');
}
