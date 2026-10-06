import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { DatabaseIcon, MessageSquareIcon } from '../../components/ui/icons';
import { Spinner } from '../../components/ui/Spinner';
import { useReviewPreference } from '../../hooks/useReviewPreference';
import { formatTime } from '../../utils/format';
import { AiMessage } from './AiMessage';
import { lastTablesUsed, type ChatItem } from './chat-state';
import { ConversationSidebar } from './ConversationSidebar';
import { QuestionForm } from './QuestionForm';
import { SchemaPanel } from './SchemaPanel';
import { TokenMeter } from './TokenMeter';
import { useChat } from './useChat';
import { useConversationList } from './useConversationList';
import { useQuotaBlock } from './useQuotaBlock';
import { useUsage } from './useUsage';

// Starting points shown on an empty conversation. The tag only says what the
// question is about.
const SUGGESTIONS = [
  { tag: 'Vendas', question: 'Qual foi o faturamento por região no último trimestre?' },
  { tag: 'Produtos', question: 'Quais são os 5 produtos mais vendidos?' },
  { tag: 'Estoque', question: 'Quais materiais estão abaixo do estoque mínimo?' },
  { tag: 'Pedidos', question: 'Como evoluiu o número de pedidos por mês?' },
  { tag: 'Entregas', question: 'Qual centro de distribuição tem mais entregas atrasadas?' },
  { tag: 'Clientes', question: 'Quais clientes mais compraram neste ano?' },
];

const NEW_CONVERSATION_TITLE = 'Nova conversa';
const UNTITLED_CONVERSATION = 'Conversa sem título';
// From this width on there is room for the schema beside the conversation.
const SCHEMA_OPEN_QUERY = '(min-width: 1200px)';

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
  const [schemaOpen, setSchemaOpen] = useState(() => window.matchMedia(SCHEMA_OPEN_QUERY).matches);

  const selected = conversationList.conversations.find(
    (conversation) => conversation.id === selectedId,
  );
  const title =
    selectedId === undefined ? NEW_CONVERSATION_TITLE : (selected?.title ?? UNTITLED_CONVERSATION);

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
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          {usage.usage && <TokenMeter usage={usage.usage} />}
          <Button
            variant="secondary"
            size="md"
            aria-pressed={schemaOpen}
            onClick={() => {
              setSchemaOpen((open) => !open);
            }}
          >
            <DatabaseIcon size={14} />
            Schema
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[900px] space-y-5 p-6">
            {chat.isLoadingHistory && <Spinner label="Carregando a conversa…" />}
            {chat.historyError && <ErrorMessage message={chat.historyError} />}

            {!chat.isLoadingHistory && !chat.historyError && chat.items.length === 0 && (
              <section className="py-10">
                <MessageSquareIcon size={36} className="text-accent" />
                <h3 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">
                  O que você quer saber sobre a operação?
                </h3>
                <p className="mt-2 max-w-[62ch] text-sm text-text-2">
                  Pergunte em português. A IA escreve o SQL sobre o banco da Rota Materiais, você
                  revisa e aprova, e o resultado volta como tabela, gráfico e explicação.
                </p>
                <ul className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-2.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion.question}>
                      <button
                        type="button"
                        onClick={() => {
                          ask(suggestion.question);
                        }}
                        disabled={chat.isAnswering}
                        className="flex h-full w-full cursor-pointer flex-col gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-left hover:border-line-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {/* Decoration: the question already says what it is about. */}
                        <span
                          aria-hidden="true"
                          className="text-[11px] font-semibold tracking-[0.05em] text-text-3 uppercase"
                        >
                          {suggestion.tag}
                        </span>
                        <span className="text-[13.5px]">{suggestion.question}</span>
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

      {schemaOpen && <SchemaPanel usedTables={lastTablesUsed(chat.items)} />}
    </div>
  );
}
