import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { useReviewPreference } from '../../hooks/useReviewPreference';
import { useTheme } from '../../hooks/useTheme';
import { AnswerCard } from './AnswerCard';
import { ConversationSidebar } from './ConversationSidebar';
import { QuestionForm } from './QuestionForm';
import { useChat } from './useChat';
import { useConversationList } from './useConversationList';

const EXAMPLE_QUESTIONS = [
  'Qual foi o faturamento por região no último trimestre?',
  'Quais são os 5 produtos mais vendidos?',
  'Como evoluiu o número de pedidos por mês?',
];

export function ChatPage() {
  const { theme, toggleTheme } = useTheme();
  const { review, setReview } = useReviewPreference();
  const conversationList = useConversationList();
  const [selectedId, setSelectedId] = useState<string>();
  const { refresh } = conversationList;

  const handleCreated = useCallback((conversationId: string) => {
    setSelectedId(conversationId);
  }, []);
  const chat = useChat(selectedId, handleCreated);
  const endRef = useRef<HTMLDivElement>(null);

  // The list shows titles and order coming from the server: refresh it once an
  // answer finishes.
  const wasAnsweringRef = useRef(false);
  useEffect(() => {
    if (wasAnsweringRef.current && !chat.isAnswering) {
      void refresh();
    }
    wasAnsweringRef.current = chat.isAnswering;
  }, [chat.isAnswering, refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.items]);

  function ask(question: string) {
    void chat.ask(question, review ? 'review' : 'auto');
  }

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <ConversationSidebar
        conversations={conversationList.conversations}
        isLoading={conversationList.isLoading}
        error={conversationList.error}
        selectedId={selectedId}
        theme={theme}
        onSelect={setSelectedId}
        onNew={() => {
          setSelectedId(undefined);
        }}
        onToggleTheme={toggleTheme}
      />

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-4 p-4">
            {chat.isLoadingHistory && <Spinner label="Carregando a conversa…" />}
            {chat.historyError && <ErrorMessage message={chat.historyError} />}

            {!chat.isLoadingHistory && !chat.historyError && chat.items.length === 0 && (
              <section className="space-y-3 py-10 text-center">
                <h2 className="text-lg font-semibold">Pergunte em português</h2>
                <p className="text-sm text-muted">
                  A IA escreve o SQL, ele é validado e executado com um usuário somente leitura, e a
                  resposta volta com tabela, gráfico e explicação.
                </p>
                <ul className="flex flex-wrap justify-center gap-2">
                  {EXAMPLE_QUESTIONS.map((question) => (
                    <li key={question}>
                      <button
                        type="button"
                        onClick={() => {
                          ask(question);
                        }}
                        disabled={chat.isAnswering}
                        className="rounded-full border border-border bg-surface px-3 py-1 text-sm hover:bg-surface-sunken"
                      >
                        {question}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {chat.items.map((item) =>
              item.kind === 'question' ? (
                <p
                  key={item.id}
                  className="ml-auto w-fit max-w-[85%] rounded-xl bg-primary px-4 py-2 text-sm text-on-primary"
                >
                  {item.text}
                </p>
              ) : (
                <AnswerCard
                  key={item.id}
                  answer={item}
                  isBusy={chat.isAnswering}
                  onExecuteReview={(answerId, messageId, sql) => {
                    void chat.executeReview(answerId, messageId, sql);
                  }}
                />
              ),
            )}
            <div ref={endRef} />
          </div>
        </div>

        <QuestionForm
          isAnswering={chat.isAnswering}
          review={review}
          onReviewChange={setReview}
          onAsk={ask}
          onCancel={chat.cancel}
        />
      </main>
    </div>
  );
}
