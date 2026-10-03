import type { ServerResponse } from 'node:http';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScriptedLlmProvider } from '../../test/support/scripted-llm-provider.js';
import type { AnswerStreamEvent } from './sse.js';
import { ConversationController } from './conversation.controller.js';
import type { ConversationRepository, PendingReview } from './conversation.repository.js';
import { ConversationService } from './conversation.service.js';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const PENDING: PendingReview = {
  messageId: '7',
  question: 'Quais regiões?',
  generatedSql: 'SELECT name FROM regions',
  proposedVisualization: { type: 'table', xColumn: '', yColumn: '' },
};

function serviceWith(findPendingReview: () => Promise<PendingReview | undefined>) {
  const repository = { findPendingReview } as unknown as ConversationRepository;
  const askService = {
    stream: vi.fn(),
    streamReview: vi.fn(),
    streamReviewedExecution: vi.fn(),
  };
  return new ConversationService(repository, askService, new ScriptedLlmProvider([]));
}

describe('ConversationService.claimPendingReview', () => {
  it('lets only one of two simultaneous requests claim the same review', async () => {
    // Both lookups resolve together, as when two requests arrive at once.
    const service = serviceWith(() => Promise.resolve(PENDING));

    const results = await Promise.allSettled([
      service.claimPendingReview(CONVERSATION_ID, '7'),
      service.claimPendingReview(CONVERSATION_ID, '7'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictException);
  });

  it('can be claimed again after it is released', async () => {
    const service = serviceWith(() => Promise.resolve(PENDING));
    await service.claimPendingReview(CONVERSATION_ID, '7');

    service.releaseReview('7');

    await expect(service.claimPendingReview(CONVERSATION_ID, '7')).resolves.toEqual(PENDING);
  });

  it('answers 404 when the message is not waiting for review', async () => {
    const service = serviceWith(() => Promise.resolve(undefined));

    await expect(service.claimPendingReview(CONVERSATION_ID, '7')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// A stand-in for the raw Node response, recording what is written.
function fakeResponse() {
  const written: string[] = [];
  const raw = {
    writableEnded: false,
    on: vi.fn(),
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      raw.writableEnded = true;
    }),
  };
  return { reply: { hijack: vi.fn(), raw: raw as unknown as ServerResponse }, raw, written };
}

describe('ConversationController execute stream', () => {
  it('ends the response with an error event when the stream fails unexpectedly', async () => {
    const releaseReview = vi.fn();
    async function* failingExecution(): AsyncGenerator<AnswerStreamEvent> {
      await Promise.resolve();
      yield { event: 'token', data: { text: 'Começo' } };
      throw new Error('boom: internal detail');
    }
    const service = {
      claimPendingReview: vi.fn(() => Promise.resolve(PENDING)),
      executeReview: vi.fn(() => failingExecution()),
      releaseReview,
      refreshMemory: vi.fn(() => Promise.resolve(false)),
    } as unknown as ConversationService;
    const controller = new ConversationController(service);
    const { reply, raw, written } = fakeResponse();

    await controller.execute(CONVERSATION_ID, '7', { sql: PENDING.generatedSql }, reply);

    expect(raw.end).toHaveBeenCalledTimes(1);
    expect(written).toEqual([
      'event: token\ndata: {"text":"Começo"}\n\n',
      'event: error\ndata: {"code":"INTERNAL_ERROR","message":"Ocorreu um erro interno."}\n\n',
    ]);
    expect(releaseReview).toHaveBeenCalledWith('7');
  });

  it('releases the review even if the response could not be started', async () => {
    const releaseReview = vi.fn();
    const service = {
      claimPendingReview: vi.fn(() => Promise.resolve(PENDING)),
      executeReview: vi.fn(),
      releaseReview,
    } as unknown as ConversationService;
    const controller = new ConversationController(service);
    const { reply } = fakeResponse();
    reply.hijack.mockImplementation(() => {
      throw new Error('cannot hijack');
    });

    await expect(
      controller.execute(CONVERSATION_ID, '7', { sql: PENDING.generatedSql }, reply),
    ).rejects.toThrow('cannot hijack');
    expect(releaseReview).toHaveBeenCalledWith('7');
  });
});
