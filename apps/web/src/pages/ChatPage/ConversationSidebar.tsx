import type { AuthUser, Conversation, UsageSummary } from '@interview-lab/shared';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import type { ThemeMode } from '../../hooks/useTheme';

interface ConversationSidebarProps {
  conversations: Conversation[];
  isLoading: boolean;
  error: string | undefined;
  selectedId: string | undefined;
  theme: ThemeMode;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onToggleTheme: () => void;
  user: AuthUser;
  usage: UsageSummary | undefined;
  onLogout: () => void;
}

const numberFormat = new Intl.NumberFormat('pt-BR');

export function ConversationSidebar({
  conversations,
  isLoading,
  error,
  selectedId,
  theme,
  onSelect,
  onNew,
  onToggleTheme,
  user,
  usage,
  onLogout,
}: ConversationSidebarProps) {
  return (
    <aside className="flex w-full flex-col gap-3 border-b border-border bg-surface p-3 md:h-full md:w-72 md:border-r md:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold">Converse com seus dados</h1>
        <Button
          variant="ghost"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </Button>
      </div>

      <Button onClick={onNew}>Nova conversa</Button>

      <nav aria-label="Conversas" className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <Spinner label="Carregando conversas…" />}
        {error && <ErrorMessage message={error} />}
        {!isLoading && !error && conversations.length === 0 && (
          <p className="text-sm text-muted">Nenhuma conversa ainda.</p>
        )}
        <ul className="space-y-1">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(conversation.id);
                }}
                aria-current={conversation.id === selectedId ? 'true' : undefined}
                className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  conversation.id === selectedId
                    ? 'bg-surface-sunken font-medium'
                    : 'text-muted hover:bg-surface-sunken hover:text-text'
                }`}
              >
                {conversation.title ?? 'Conversa sem título'}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <footer className="space-y-2 border-t border-border pt-3 text-sm">
        {usage && (
          <p className="text-xs text-muted">
            Uso hoje: {numberFormat.format(usage.today.inputTokens + usage.today.outputTokens)} de{' '}
            {numberFormat.format(usage.dailyTokenQuota)} tokens
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="truncate" title={user.email}>
            {user.name}
          </span>
          <Button variant="ghost" onClick={onLogout}>
            Sair
          </Button>
        </div>
      </footer>
    </aside>
  );
}
