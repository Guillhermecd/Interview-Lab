import {
  ASK_MODES,
  type AskMode,
  type LoginRequest,
  type RegisterRequest,
} from '@interview-lab/shared';
import { ValidationError } from './validation-error.js';

export const MAX_SQL_LENGTH = 10_000;
const MAX_QUESTION_LENGTH = 1000;

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null && name in body
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

function invalid(name: string, message: string): ValidationError {
  return new ValidationError([{ field: name, message }]);
}

export function readSql(body: unknown): string {
  const sql = field(body, 'sql');
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw invalid('sql', 'Informe a consulta SQL.');
  }
  if (sql.length > MAX_SQL_LENGTH) {
    throw invalid('sql', `A consulta SQL pode ter no máximo ${String(MAX_SQL_LENGTH)} caracteres.`);
  }
  return sql;
}

export function readQuestion(body: unknown): string {
  const question = field(body, 'question');
  if (typeof question !== 'string' || question.trim() === '') {
    throw invalid('question', 'Informe a pergunta.');
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw invalid(
      'question',
      `A pergunta pode ter no máximo ${String(MAX_QUESTION_LENGTH)} caracteres.`,
    );
  }
  return question.trim();
}

export function readAskMode(body: unknown): AskMode {
  const mode = field(body, 'mode');
  if (mode === undefined) {
    return 'auto';
  }
  const known = ASK_MODES.find((candidate) => candidate === mode);
  if (known === undefined) {
    throw invalid('mode', 'O modo deve ser "auto" ou "review".');
  }
  return known;
}

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
// Deliberately simple: something@something.something. Ownership of the address
// is not verified in this version.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(body: unknown): string {
  const email = field(body, 'email');
  if (typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH) {
    throw invalid('email', 'Informe um e-mail válido.');
  }
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw invalid('email', 'Informe um e-mail válido.');
  }
  return normalized;
}

export function readRegistration(body: unknown): RegisterRequest {
  const name = field(body, 'name');
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME_LENGTH) {
    throw invalid('name', `Informe um nome com até ${String(MAX_NAME_LENGTH)} caracteres.`);
  }
  const password = field(body, 'password');
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw invalid(
      'password',
      `A senha deve ter entre ${String(MIN_PASSWORD_LENGTH)} e ${String(MAX_PASSWORD_LENGTH)} caracteres.`,
    );
  }
  return { name: name.trim(), email: readEmail(body), password };
}

export function readLogin(body: unknown): LoginRequest {
  const password = field(body, 'password');
  if (typeof password !== 'string' || password === '' || password.length > MAX_PASSWORD_LENGTH) {
    throw invalid('password', 'Informe a senha.');
  }
  return { email: readEmail(body), password };
}
