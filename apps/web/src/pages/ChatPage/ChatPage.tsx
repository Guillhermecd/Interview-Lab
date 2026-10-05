import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { useReviewPreference } from '../../hooks/useReviewPreference';
import { formatTime } from '../../utils/format';
import { AiMessage } from './AiMessage';
import type { ChatItem } from './chat-state';
import { ConversationSidebar } from './ConversationSidebar';
import { QuestionForm } from './QuestionForm';
import { useChat } from './useChat';
import { useConversationList } from './useConversationList';
import { useQuotaBlock } from './useQuotaBlock';
import { useUsage } from './useUsage';

const EXAMPLE_QUESTIONS = [
  'Qual foi o faturamento por região no último trimestre?',
  'Quais são os 5 produtos mais vendidos?',
  'Como evoluiu o número de pedidos por mês?',
];

interface ChatPageProps {
  // A question brought from another screen: written in the composer for the
  // user to review and send, never sent by itself.
  initialQuestion?: string | undefined;
}

// The question an answer replies to: the item right before it.
function questionBefore(items: ChatItem[], index: number): string | undefined {
  const previous = items[index - 1];
  return previous?.kind === 'question' ? previous.text : undefined;
}

export function ChatPage({ initialQuestion }: ChatPageProps) {
  const { review, setReview } = useReviewPreference();
  const conversationList = useConversationList();
  const usage = useUsage();
  const { refresh: refreshUsage } = usage;
  const [selectedId, setSelectedId] = useState<string>();
  const { refresh } = conversationList;

  const handleCreated = useCallback((conversationId: string) => {
    setSelectedId(conversationId);
  }, []);
  const chat = useChat(selectedId, handleCreated);
  const quotaBlock = useQuotaBlock(chat.items);
  const endRef = useRef<HTMLDivElement>(null);

  // The list shows titles and order coming from the server: refresh it once an
  // answer finishes.
  const wasAnsweringRef = useRef(false);
  useEffect(() => {
    if (wasAnsweringRef.current && !chat.isAnswering) {
      void refresh();
      void refreshUsage();
    }
    wasAnsweringRef.current = chat.isAnswering;
  }, [chat.isAnswering, refresh, refreshUsage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.items]);

  function ask(question: string) {
    void chat.ask(question, review ? 'review' : 'auto');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <ConversationSidebar
        conversations={conversationList.conversations}
        isLoading={conversationList.isLoading}
        error={conversationList.error}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={() => {
          setSelectedId(undefined);
        }}
        usage={usage.usage}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[900px] space-y-5 p-6">
            {chat.isLoadingHistory && <Spinner label="Carregando a conversa…" />}
            {chat.historyError && <ErrorMessage message={chat.historyError} />}

            {!chat.isLoadingHistory && !chat.historyError && chat.items.length === 0 && (
              <section className="space-y-3 py-10 text-center">
                <h2 className="text-xl font-semibold tracking-[-0.015em]">Pergunte em português</h2>
                <p className="mx-auto max-w-[60ch] text-sm text-text-2">
                  A IA escreve o SQL, ele é validado e executado com um usuário somente leitura, e a
                  resposta volta com tabela, gráfico e explicação.
                </p>
                <ul className="flex flex-wrap justify-center gap-2 pt-2">
                  {EXAMPLE_QUESTIONS.map((question) => (
                    <li key={question}>
                      <button
                        type="button"
                        onClick={() => {
                          ask(question);
                        }}
                        disabled={chat.isAnswering}
                        className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-[13px] hover:border-line-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {question}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {chat.items.map((item, index) => {
              if (item.kind === 'question') {
                return (
                  <div
                    key={item.id}
                    className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1"
                  >
                    <span className="text-xs text-text-3">Você · {formatTime(item.time)}</span>
                    <p className="rounded-[12px_12px_3px_12px] bg-surface-3 px-3.5 py-2.5 text-sm whitespace-pre-wrap">
                      {item.text}
                    </p>
                  </div>
                );
              }
              const question = questionBefore(chat.items, index);
              return (
                <AiMessage
                  key={item.id}
                  answer={item}
                  isBusy={chat.isAnswering}
                  usage={usage.usage}
                  onExecuteReview={(answerId, messageId, sql) => {
                    void chat.executeReview(answerId, messageId, sql);
                  }}
                  onEditReview={chat.editReview}
                  onCancelReview={chat.cancelReview}
                  onReopenReview={chat.reopenReview}
                  onStop={chat.cancel}
                  onRetry={
                    question === undefined || chat.isAnswering
                      ? undefined
                      : () => {
                          ask(question);
                        }
                  }
                />
              );
            })}
            <div ref={endRef} />
          </div>
        </div>

        <QuestionForm
          isAnswering={chat.isAnswering}
          review={review}
          initialQuestion={initialQuestion}
          blockedReason={quotaBlock}
          onReviewChange={setReview}
          onAsk={ask}
          onCancel={chat.cancel}
        />
      </main>
    </div>
  );
}
