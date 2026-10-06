import type { SchemaOverview } from '@interview-lab/shared';
import { requestJson } from './api';

// Only transports data: the server decides which tables the AI can read.
export const SchemaService = {
  overview(signal?: AbortSignal): Promise<SchemaOverview> {
    return requestJson<SchemaOverview>('/schema', { signal: signal ?? null });
  },
};
