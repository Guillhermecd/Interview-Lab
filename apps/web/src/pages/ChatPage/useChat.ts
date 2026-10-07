import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../../api/modules/api';
import type { AskMode } from '@interview-lab/shared';
import { ConversationService, type AnswerEvent } from '../../api/modules/conversation.service';
import {
  applyAnswerEvent,
  cancelReview as cancelPendingReview,
  editReviewDraft,
  itemsFromMessages,
  newAnswer,
  reopenReview as reopenPendingReview,
  startReviewExecution,
  type AnswerItem,
  type ChatItem,
} from './chat-state';

export interface ChatState {
  items: ChatItem[];
  isLoadingHistory: boolean;
  historyError: string | undefined;
  isAnswering: boolean;
  ask: (question: string, mode?: AskMode) => Promise<void>;
  executeReview: (answerId: string, messageId: string, sql: string) => Promise<void>;
  // Review mode, on screen only: change the SQL to send (undefined goes back to
  // the generated one), give up running it, or review it again.
  editReview: (answerId: string, sql: string | undefined) => void;
  cancelReview: (answerId: string) => void;
  reopenReview: (answerId: string) => void;
  cancel: () => void;
}

// What is on screen, and which conversation it belongs to. When the selected
// conversation changes, the screen shows nothing until its history arrives.
interface LoadedChat {
  conversationId: string | undefined;
  items: ChatItem[];
  historyError?: string;
}

let localIdCounter = 0;
function localId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}-${String(localIdCounter)}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

// Screen logic of one conversation: loads its history, sends questions and
// follows the answer stream. When there is no conversation yet, the first
// question creates one and reports it through `onConversationCreated`.
export function useChat(
  conversationId: string | undefined,
  onConversationCreated: (conversationId: string) => void,
): ChatState {
  const [loaded, setLoaded] = useState<LoadedChat>({ conversationId: undefined, items: [] });
  const [isAnswering, setIsAnswering] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  // The conversation the answer in progress belongs to.
  const streamingForRef = useRef<string | undefined>(undefined);

  const isCurrent = loaded.conversationId === conversationId;

  useEffect(() => {
    if (conversationId === undefined || loaded.conversationId === conversationId) {
      return undefined;
    }
    let active = true;
    ConversationService.messages(conversationId)
      .then((messages) => {
        if (active) {
          setLoaded({ conversationId, items: itemsFromMessages(messages) });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoaded({ conversationId, items: [], historyError: toApiError(error).message });
        }
      });
    return () => {
      active = false;
    };
  }, [conversationId, loaded.conversationId]);

  // Leaving a conversation stops the answer being streamed into it. Selecting
  // the conversation that the answer itself just created is not leaving it.
  useEffect(() => {
    if (abortRef.current && streamingForRef.current !== conversationId) {
      abortRef.current.abort();
    }
  }, [conversationId]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const updateAnswer = useCallback(
    (answerId: string, update: (answer: AnswerItem) => AnswerItem) => {
      setLoaded((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.kind === 'answer' && item.id === answerId ? update(item) : item,
        ),
      }));
    },
    [],
  );

  // Streams events into one answer until the stream ends. On failure the
  // answer shows the error; on abort it is marked cancelled (or, for a review
  // being executed, goes back to review).
  const follow = useCallback(
    async (answerId: string, abort: AbortController, events: () => AsyncIterable<AnswerEvent>) => {
      setIsAnswering(true);
      abortRef.current = abort;
      try {
        for await (const event of events()) {
          updateAnswer(answerId, (answer) => applyAnswerEvent(answer, event));
        }
      } catch (error) {
        if (isAbort(error)) {
          updateAnswer(answerId, (answer) => ({
            ...answer,
            status: answer.executingReview === true ? 'pending_review' : 'cancelled',
            executingReview: false,
          }));
        } else {
          const apiError = toApiError(error);
          updateAnswer(answerId, (answer) =>
            applyAnswerEvent(answer, {
              event: 'error',
              data: {
                code: apiError.code,
                message: apiError.message,
                details: apiError.details,
                retryAfterSeconds: apiError.retryAfterSeconds,
              },
            }),
          );
        }
      } finally {
        if (abortRef.current === abort) {
          abortRef.current = undefined;
        }
        setIsAnswering(false);
      }
    },
    [updateAnswer],
  );

  const ask = useCallback(
    async (question: string, mode: AskMode = 'auto') => {
      const answerId = localId('answer');
      const now = new Date().toISOString();
      const pending: ChatItem[] = [
        { kind: 'question', id: localId('question'), text: question, time: now },
        newAnswer(answerId, now),
      ];
      setLoaded((current) => ({
        conversationId,
        items: current.conversationId === conversationId ? [...current.items, ...pending] : pending,
      }));
      const abort = new AbortController();
      streamingForRef.current = conversationId;

      await follow(answerId, abort, async function* () {
        let targetId = conversationId;
        if (targetId === undefined) {
          const created = (await ConversationService.create()).id;
          // The user left (or stopped) while the conversation was being created:
          // do not pull them back to it.
          if (abort.signal.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          targetId = created;
          streamingForRef.current = created;
          // The new conversation already shows this question: its (empty)
          // history must not be loaded over it.
          setLoaded((current) => ({ ...current, conversationId: created }));
          onConversationCreated(created);
        }
        yield* ConversationService.ask(targetId, question, mode, abort.signal);
      });
    },
    [conversationId, follow, onConversationCreated],
  );

  // Sends the SQL the user approved or edited for an answer waiting for review.
  const executeReview = useCallback(
    async (answerId: string, messageId: string, sql: string) => {
      if (conversationId === undefined) {
        return;
      }
      updateAnswer(answerId, (answer) => startReviewExecution(answer, sql));
      const abort = new AbortController();
      streamingForRef.current = conversationId;
      await follow(answerId, abort, () =>
        ConversationService.executeReview(conversationId, messageId, sql, abort.signal),
      );
    },
    [conversationId, follow, updateAnswer],
  );

  const editReview = useCallback(
    (answerId: string, sql: string | undefined) => {
      updateAnswer(answerId, (answer) => editReviewDraft(answer, sql));
    },
    [updateAnswer],
  );

  const cancelReview = useCallback(
    (answerId: string) => {
      updateAnswer(answerId, cancelPendingReview);
    },
    [updateAnswer],
  );

  const reopenReview = useCallback(
    (answerId: string) => {
      updateAnswer(answerId, reopenPendingReview);
    },
    [updateAnswer],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    items: isCurrent ? loaded.items : [],
    isLoadingHistory: conversationId !== undefined && !isCurrent,
    historyError: isCurrent ? loaded.historyError : undefined,
    isAnswering,
    ask,
    executeReview,
    editReview,
    cancelReview,
    reopenReview,
    cancel,
  };
}
