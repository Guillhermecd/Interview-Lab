import type { Conversation, ConversationAttention } from '@interview-lab/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { CONTROL_CLASS } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { formatShortDate, formatTime } from '../../utils/format';
import { filterConversations, groupConversations } from './conversation-groups';

interface ConversationSidebarProps {
  conversations: Conversation[];
  isLoading: boolean;
  error: string | undefined;
  selectedId: string | undefined;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
}

// Why the last answer needs attention, as the server said. Fixed semantics:
// waiting for the user is the accent, blocked is critical, timeout is a warning.
const ATTENTION: Record<ConversationAttention, { label: string; color: string }> = {
  pending_review: { label: 'Aguardando revisão', color: 'text-accent-text' },
  blocked: { label: 'Bloqueada', color: 'text-crit' },
  timeout: { label: 'Timeout', color: 'text-warn' },
};

const TODAY_LABEL = 'Hoje';

// The conversations of the user: start a new one, search by title, and pick
// one. They come sorted by last activity and are shown grouped by period.
export function ConversationSidebar({
  conversations,
  isLoading,
  error,
  selectedId,
  onSelect,
  onNew,
}: ConversationSidebarProps) {
  const [search, setSearch] = useState('');
  const found = filterConversations(conversations, search);
  const groups = groupConversations(found, new Date());

  return (
    <aside className="flex w-full shrink-0 flex-col gap-2.5 border-b border-line bg-surface-2 p-3 md:h-full md:w-[264px] md:border-r md:border-b-0">
      <h1 className="sr-only">Converse com seus dados</h1>
      <Button onClick={onNew}>Nova conversa</Button>
      <label className="block">
        <span className="sr-only">Buscar conversa</span>
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Buscar conversa"
          className={CONTROL_CLASS}
        />
      </label>

      <nav aria-label="Conversas" className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <Spinner label="Carregando conversas…" />}
        {error && <ErrorMessage message={error} />}
        {!isLoading && !error && conversations.length === 0 && (
          <p className="px-1 text-[13px] text-text-2">Nenhuma conversa ainda.</p>
        )}
        {conversations.length > 0 && found.length === 0 && (
          <p className="px-1 text-[13px] text-text-2">Nenhuma conversa com esse título.</p>
        )}
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="mb-2">
            <h2 className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.05em] text-text-3 uppercase">
              {group.label}
            </h2>
            <ul className="space-y-0.5">
              {group.conversations.map((conversation) => {
                const selected = conversation.id === selectedId;
                const attention = conversation.attention && ATTENTION[conversation.attention];
                return (
                  <li
                    key={conversation.id}
                    className={`rounded-md ${selected ? 'bg-surface-3' : 'hover:bg-surface-3'}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(conversation.id);
                      }}
                      aria-current={selected ? 'true' : undefined}
                      className={`block w-full cursor-pointer truncate rounded-md px-2 pt-[7px] text-left text-[13px] focus-visible:outline-2 focus-visible:outline-accent ${
                        selected ? 'font-medium text-text' : 'text-text-2 hover:text-text'
                      }`}
                    >
                      {conversation.title ?? 'Conversa sem título'}
                    </button>
                    <p className="flex items-center gap-1.5 px-2 pb-[7px] text-[11.5px] text-text-3">
                      {attention && (
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${attention.color}`}
                        >
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-1.5 rounded-full bg-current"
                          />
                          {attention.label}
                        </span>
                      )}
                      <time dateTime={conversation.updatedAt}>
                        {group.label === TODAY_LABEL
                          ? formatTime(conversation.updatedAt)
                          : formatShortDate(conversation.updatedAt)}
                      </time>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  );
}
