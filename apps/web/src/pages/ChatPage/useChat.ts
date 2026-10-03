import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../../api/modules/api';
import { ConversationService } from '../../api/modules/conversation.service';
import {
  applyAnswerEvent,
  itemsFromMessages,
  newAnswer,
  type AnswerItem,
  type ChatItem,
} from './chat-state';

interface ChatState {
  items: ChatItem[];
  isLoadingHistory: boolean;
  historyError: string | undefined;
  isAnswering: boolean;
  ask: (question: string) => Promise<void>;
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

  // Leaving a conversation stops the answer being streamed into it.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [conversationId],
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

  const ask = useCallback(
    async (question: string) => {
      const answerId = localId('answer');
      const pending: ChatItem[] = [
        { kind: 'question', id: localId('question'), text: question },
        newAnswer(answerId),
      ];
      setLoaded((current) => ({
        conversationId,
        items: current.conversationId === conversationId ? [...current.items, ...pending] : pending,
      }));
      setIsAnswering(true);
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        let targetId = conversationId;
        if (targetId === undefined) {
          const created = (await ConversationService.create()).id;
          targetId = created;
          // The new conversation already shows this question: its (empty)
          // history must not be loaded over it.
          setLoaded((current) => ({ ...current, conversationId: created }));
          onConversationCreated(created);
        }

        let currentId = answerId;
        for await (const event of ConversationService.ask(targetId, question, abort.signal)) {
          const idBefore = currentId;
          if (event.event === 'done') {
            currentId = event.data.messageId;
          }
          updateAnswer(idBefore, (answer) => applyAnswerEvent(answer, event));
        }
      } catch (error) {
        if (isAbort(error)) {
          updateAnswer(answerId, (answer) => ({ ...answer, status: 'cancelled' }));
        } else {
          const apiError = toApiError(error);
          updateAnswer(answerId, (answer) => ({
            ...answer,
            status: 'error',
            error: { message: apiError.message, details: apiError.details },
          }));
        }
      } finally {
        if (abortRef.current === abort) {
          abortRef.current = undefined;
        }
        setIsAnswering(false);
      }
    },
    [conversationId, onConversationCreated, updateAnswer],
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
    cancel,
  };
}
