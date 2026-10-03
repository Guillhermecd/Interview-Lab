import { ASK_MODES, type AskMode } from '@interview-lab/shared';
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
