import {
  VISUALIZATION_TYPES,
  type QueryColumn,
  type VisualizationSuggestion,
  type VisualizationType,
} from '@interview-lab/shared';
import { LlmError } from '../llm/llm-error.js';

const MAX_EXPLANATION_LENGTH = 2000;
const MAX_REASON_LENGTH = 500;

export type SqlGeneration = { kind: 'sql'; sql: string } | { kind: 'refusal'; reason: string };

export interface Explanation {
  explanation: string;
  visualization: VisualizationSuggestion;
}

type JsonObject = Record<string, unknown>;

function asObject(data: unknown): JsonObject {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new LlmError('LLM_INVALID_RESPONSE');
  }
  return data as JsonObject;
}

function readText(object: JsonObject, field: string): string {
  const value = object[field];
  return typeof value === 'string' ? value.trim() : '';
}

function isVisualizationType(value: string): value is VisualizationType {
  return VISUALIZATION_TYPES.some((type) => type === value);
}

// The LLM's answers are untrusted input: nothing is used before its shape and
// values are checked here.
export function parseSqlGeneration(data: unknown): SqlGeneration {
  const object = asObject(data);
  const sql = readText(object, 'sql');
  if (sql !== '') {
    return { kind: 'sql', sql };
  }

  const reason = readText(object, 'cannotAnswerReason');
  if (reason === '') {
    throw new LlmError('LLM_INVALID_RESPONSE');
  }
  return { kind: 'refusal', reason: reason.slice(0, MAX_REASON_LENGTH) };
}

// A chart only makes sense with two columns that exist in the result;
// otherwise the suggestion falls back to a table.
function readVisualization(object: JsonObject, columns: QueryColumn[]): VisualizationSuggestion {
  const type = readText(object, 'visualization');
  const xColumn = readText(object, 'xColumn');
  const yColumn = readText(object, 'yColumn');
  const columnNames = new Set(columns.map((column) => column.name));

  if (
    !isVisualizationType(type) ||
    type === 'table' ||
    xColumn === yColumn ||
    !columnNames.has(xColumn) ||
    !columnNames.has(yColumn)
  ) {
    return { type: 'table' };
  }
  return { type, xColumn, yColumn };
}

export function parseExplanation(data: unknown, columns: QueryColumn[]): Explanation {
  const object = asObject(data);
  const explanation = readText(object, 'explanation');
  if (explanation === '') {
    throw new LlmError('LLM_INVALID_RESPONSE');
  }

  return {
    explanation: explanation.slice(0, MAX_EXPLANATION_LENGTH),
    visualization: readVisualization(object, columns),
  };
}
