import { GoogleGenAI } from '@google/genai';
import { Module, type DynamicModule } from '@nestjs/common';
import type { AppEnv, LlmEnv } from '../config/env.js';
import { GeminiLlmProvider } from '../llm/gemini-llm-provider.js';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm-provider.js';
import { UnconfiguredLlmProvider } from '../llm/unconfigured-llm-provider.js';
import { ANSWER_CACHE, RedisAnswerCache } from './answer-cache.js';
import { ASK_LIMITS, AskService, type AskLimits } from './ask.service.js';

export function createLlmProvider(llm: LlmEnv): LlmProvider {
  if (llm.geminiApiKey === undefined) {
    return new UnconfiguredLlmProvider();
  }
  return new GeminiLlmProvider(new GoogleGenAI({ apiKey: llm.geminiApiKey }), {
    model: llm.model,
    timeoutMs: llm.timeoutMs,
  });
}

@Module({})
export class AskModule {
  static register(env: AppEnv): DynamicModule {
    const limits: AskLimits = {
      maxRows: env.query.maxRows,
      explainMaxRows: env.llm.explainMaxRows,
    };

    return {
      module: AskModule,
      providers: [
        { provide: LLM_PROVIDER, useFactory: () => createLlmProvider(env.llm) },
        { provide: ASK_LIMITS, useValue: limits },
        { provide: ANSWER_CACHE, useClass: RedisAnswerCache },
        AskService,
      ],
      // LLM_PROVIDER is exported for the conversation summary (D-27).
      exports: [AskService, LLM_PROVIDER],
    };
  }
}
