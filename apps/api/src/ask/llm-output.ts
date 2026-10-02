import {
  VISUALIZATION_TYPES,
  type QueryColumn,
  type VisualizationSuggestion,
  type VisualizationType,
} from '@interview-lab/shared';
import { LlmError } from '../llm/llm-error.js';

export const MAX_EXPLANATION_LENGTH = 2000;
const MAX_REASON_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 2000;

// What the LLM proposed, before it is checked against the real result.
export interface ProposedVisualization {
  type: string;
  xColumn: string;
  yColumn: string;
}

export type SqlGeneration =
  | { kind: 'sql'; sql: string; visualization: ProposedVisualization }
  | { kind: 'refusal'; reason: string };

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
    return {
      kind: 'sql',
      sql,
      visualization: {
        type: readText(object, 'visualization'),
        xColumn: readText(object, 'xColumn'),
        yColumn: readText(object, 'yColumn'),
      },
    };
  }

  const reason = readText(object, 'cannotAnswerReason');
  if (reason === '') {
    throw new LlmError('LLM_INVALID_RESPONSE');
  }
  return { kind: 'refusal', reason: reason.slice(0, MAX_REASON_LENGTH) };
}

// A chart only makes sense with two different columns that exist in the
// result; otherwise the suggestion falls back to a table.
export function resolveVisualization(
  proposed: ProposedVisualization,
  columns: QueryColumn[],
): VisualizationSuggestion {
  const { type, xColumn, yColumn } = proposed;
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

export function parseSummary(data: unknown): string {
  const summary = readText(asObject(data), 'summary');
  if (summary === '') {
    throw new LlmError('LLM_INVALID_RESPONSE');
  }
  return summary.slice(0, MAX_SUMMARY_LENGTH);
}
