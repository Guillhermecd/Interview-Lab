import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import {
  ChevronDownIcon,
  CloseIcon,
  MaximizeIcon,
  MessageSquareIcon,
} from '../../components/ui/icons';
import { Spinner } from '../../components/ui/Spinner';
import { useFloatingChat } from '../../hooks/useFloatingChat';
import { useReviewPreference } from '../../hooks/useReviewPreference';
import { CHAT_PATH, type ChatLocationState } from '../../routes';
import { MessageList } from './MessageList';
import { QuestionForm } from './QuestionForm';
import { FLOATING_SUGGESTIONS } from './suggestions';
import { useChat } from './useChat';
import { useQuotaBlock } from './useQuotaBlock';
import { useUsage } from './useUsage';

const TITLE = 'Converse com seus dados';
const HEADER_BUTTON_CLASS =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-2 hover:bg-surface-3 hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

// The chat in a window over the dashboard and the registry (Phase 09d): the
// same conversation flow of the chat screen, in less room. It is rendered only
// while open or minimized, so closing it starts over; minimizing keeps all.
export function FloatingChatWindow() {
  const navigate = useNavigate();
  const { status, prompt, toggleMinimized, close, clearPrompt } = useFloatingChat();
  const { review, setReview } = useReviewPreference();
  const { usage, refresh: refreshUsage } = useUsage();
  const [conversationId, setConversationId] = useState<string>();
  const handleCreated = useCallback((createdId: string) => {
    setConversationId(createdId);
  }, []);
  const chat = useChat(conversationId, handleCreated);
  const quotaBlock = useQuotaBlock(chat.items);
  const endRef = useRef<HTMLDivElement>(null);
  const minimized = status === 'minimized';

  const wasAnsweringRef = useRef(false);
  useEffect(() => {
    if (wasAnsweringRef.current && !chat.isAnswering) {
      void refreshUsage();
    }
    wasAnsweringRef.current = chat.isAnswering;
  }, [chat.isAnswering, refreshUsage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.items]);

  function ask(question: string) {
    void chat.ask(question, review ? 'review' : 'auto');
  }

  // The context goes inside the question text (D-42): the model reads it and
  // the history keeps exactly what was sent.
  function askFromComposer(question: string) {
    const context = prompt?.context ?? '';
    ask(context === '' ? question : `${question} (Contexto: ${context})`);
    clearPrompt();
  }

  function openFullScreen() {
    const state: ChatLocationState = conversationId === undefined ? {} : { conversationId };
    close();
    void navigate(CHAT_PATH, { state });
  }

  return (
    <section
      role="dialog"
      aria-label={TITLE}
      className={`fixed right-6 bottom-6 z-40 flex w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-line-2 bg-bg shadow-elevated ${
        minimized ? 'h-12' : 'h-[680px] max-h-[calc(100dvh-48px)]'
      }`}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pr-2 pl-3">
        <button
          type="button"
          onClick={toggleMinimized}
          title={minimized ? 'Restaurar' : 'Minimizar'}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <MessageSquareIcon size={15} className="shrink-0 text-accent" />
          <span className="truncate text-[13.5px] font-semibold">{TITLE}</span>
        </button>
        <button
          type="button"
          onClick={openFullScreen}
          // Leaving the window stops the answer being written into it.
          disabled={chat.isAnswering}
          aria-label="Tela cheia"
          title={chat.isAnswering ? 'Aguarde a resposta terminar' : 'Abrir na tela do chat'}
          className={HEADER_BUTTON_CLASS}
        >
          <MaximizeIcon size={14} />
        </button>
        <button
          type="button"
          onClick={toggleMinimized}
          aria-label={minimized ? 'Restaurar' : 'Minimizar'}
          aria-expanded={!minimized}
          className={HEADER_BUTTON_CLASS}
        >
          <ChevronDownIcon
            size={15}
            className={`transition-transform ${minimized ? 'rotate-180' : ''}`}
          />
        </button>
        <button type="button" onClick={close} aria-label="Fechar" className={HEADER_BUTTON_CLASS}>
          <CloseIcon size={14} />
        </button>
      </header>

      {/* Hidden, not removed, while minimized: the conversation and what was
          typed stay as they were. */}
      <div hidden={minimized} className={minimized ? '' : 'flex min-h-0 flex-1 flex-col'}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-3.5">
            {chat.isLoadingHistory && <Spinner label="Carregando a conversa…" />}
            {chat.historyError && <ErrorMessage message={chat.historyError} />}

            {chat.items.length === 0 && !chat.isLoadingHistory && !chat.historyError && (
              <div className="py-3">
                <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
                  Pergunte sobre o que está na tela
                </h3>
                <p className="mt-1.5 text-[13px] text-text-2">
                  A IA escreve o SQL, a consulta passa pela validação de segurança e o resultado
                  volta como tabela, gráfico e explicação.
                </p>
                <ul className="mt-4 flex flex-col gap-2">
                  {FLOATING_SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion.question}>
                      <button
                        type="button"
                        onClick={() => {
                          ask(suggestion.question);
                        }}
                        disabled={chat.isAnswering}
                        className="w-full cursor-pointer rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-[13px] hover:border-line-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {suggestion.question}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <MessageList chat={chat} usage={usage} onAsk={ask} />
            <div ref={endRef} />
          </div>
        </div>

        <QuestionForm
          // A new request from a card rewrites the composer.
          key={prompt?.id ?? 0}
          compact
          isAnswering={chat.isAnswering}
          review={review}
          initialQuestion={prompt?.question}
          context={prompt?.context}
          onRemoveContext={clearPrompt}
          blockedReason={quotaBlock}
          onReviewChange={setReview}
          onAsk={askFromComposer}
          onCancel={chat.cancel}
        />
      </div>
    </section>
  );
}

export default FloatingChatWindow;
