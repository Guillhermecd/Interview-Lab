import type { Conversation, UsageSummary } from '@interview-lab/shared';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';

interface ConversationSidebarProps {
  conversations: Conversation[];
  isLoading: boolean;
  error: string | undefined;
  selectedId: string | undefined;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  usage: UsageSummary | undefined;
}

const numberFormat = new Intl.NumberFormat('pt-BR');

export function ConversationSidebar({
  conversations,
  isLoading,
  error,
  selectedId,
  onSelect,
  onNew,
  usage,
}: ConversationSidebarProps) {
  return (
    <aside className="flex w-full flex-col gap-3 border-b border-line bg-surface-2 p-3 md:h-full md:w-[264px] md:border-r md:border-b-0">
      <h1 className="sr-only">Converse com seus dados</h1>
      <Button onClick={onNew}>Nova conversa</Button>

      <nav aria-label="Conversas" className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <Spinner label="Carregando conversas…" />}
        {error && <ErrorMessage message={error} />}
        {!isLoading && !error && conversations.length === 0 && (
          <p className="px-1 text-[13px] text-text-2">Nenhuma conversa ainda.</p>
        )}
        <ul className="space-y-0.5">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(conversation.id);
                }}
                aria-current={conversation.id === selectedId ? 'true' : undefined}
                className={`w-full cursor-pointer truncate rounded-md px-2.5 py-[7px] text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                  conversation.id === selectedId
                    ? 'bg-surface-3 font-medium text-text'
                    : 'text-text-2 hover:bg-surface-3 hover:text-text'
                }`}
              >
                {conversation.title ?? 'Conversa sem título'}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {usage && (
        <footer className="border-t border-line pt-3">
          <p className="text-xs text-text-3">
            Uso hoje: {numberFormat.format(usage.today.inputTokens + usage.today.outputTokens)} de{' '}
            {numberFormat.format(usage.dailyTokenQuota)} tokens
          </p>
        </footer>
      )}
    </aside>
  );
}
