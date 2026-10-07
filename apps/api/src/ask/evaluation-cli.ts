import type { AskResponse } from '@interview-lab/shared';
import { loadModule } from 'libpg-query';
import { loadEnv } from '../config/env.js';
import { GuardedQueryService } from '../query/guarded-query.service.js';
import { QueryExecutor } from '../query/query-executor.service.js';
import { createReadonlyPool } from '../query/readonly-pool.js';
import { SchemaCatalog } from '../query/schema-catalog.service.js';
import { MAX_JOINS, SqlGuard } from '../sql-guard/sql-guard.js';
import { NoAnswerCache } from './answer-cache.js';
import { createLlmProvider } from './ask.module.js';
import { AskService } from './ask.service.js';
import { EVALUATION_QUESTIONS } from './evaluation-questions.js';

// The free tier of the provider limits requests per minute.
const PAUSE_BETWEEN_QUESTIONS_MS = 5000;
const PREVIEW_ROWS = 3;

function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    const details =
      'details' in error && Array.isArray(error.details) ? JSON.stringify(error.details) : '';
    return `${error.code} ${error.message} ${details}`.trim();
  }
  return error instanceof Error ? error.message : 'unknown error';
}

function printResponse(response: AskResponse): void {
  print(
    `- Tokens: ${String(response.usage.inputTokens)} entrada, ` +
      `${String(response.usage.outputTokens)} saída, ${String(response.usage.calls)} chamadas`,
  );
  if (response.status === 'not_answerable') {
    print(`- Resultado: não respondida — ${response.reason}`);
    return;
  }

  const { result } = response;
  print(`- Tentativas de SQL: ${String(response.attempts)}`);
  print(
    `- Linhas: ${String(result.rowCount)}${result.truncated ? ' (truncado)' : ''}, ` +
      `${String(result.durationMs)} ms`,
  );
  print(`- Visualização: ${JSON.stringify(response.visualization)}`);
  print(`- Explicação: ${response.explanation}`);
  print(`- Primeiras linhas: ${JSON.stringify(result.rows.slice(0, PREVIEW_ROWS))}`);
  print('');
  print('```sql');
  print(response.sql);
  print('```');
}

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  if (env.llm.geminiApiKey === undefined) {
    throw new Error('Set GEMINI_API_KEY in .env to run the evaluation.');
  }

  await loadModule();
  const pool = createReadonlyPool(env.database);
  const queries = new GuardedQueryService(
    new SqlGuard({ maxRows: env.query.maxRows, maxJoins: MAX_JOINS }),
    new QueryExecutor(pool, env.query),
  );
  const service = new AskService(
    createLlmProvider(env.llm),
    new SchemaCatalog(pool),
    queries,
    { maxRows: env.query.maxRows, explainMaxRows: env.llm.explainMaxRows },
    // The evaluation measures the LLM, so nothing is served from cache.
    new NoAnswerCache(),
  );

  print(`# Avaliação manual — modelo ${env.llm.model}`);
  print(`Limite de custo (QUERY_MAX_COST): ${String(env.query.maxCost)}`);
  try {
    for (const [index, question] of EVALUATION_QUESTIONS.entries()) {
      print('');
      print(`## ${String(index + 1)}. ${question}`);
      try {
        const response = await service.ask(question);
        printResponse(response);
        if (response.status === 'answered') {
          // What the planner estimated for the SQL the LLM wrote: the numbers
          // QUERY_MAX_COST is calibrated from (D-65).
          print(`- Custo estimado: ${String(Math.round(await queries.check(response.sql)))}`);
        }
      } catch (error) {
        print(`- Resultado: erro — ${describeError(error)}`);
      }
      await pause(PAUSE_BETWEEN_QUESTIONS_MS);
    }
  } finally {
    await pool.end();
  }
}

await main();
