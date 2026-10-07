import type { UsageSummary } from '@interview-lab/shared';
import { formatTime } from '../../utils/format';
import { AiMessage } from './AiMessage';
import type { ChatItem } from './chat-state';
import type { ChatState } from './useChat';

interface MessageListProps {
  chat: ChatState;
  usage: UsageSummary | undefined;
  // Sends a question again, the way the screen sends any question.
  onAsk: (question: string) => void;
}

// The question an answer replies to: the item right before it.
function questionBefore(items: ChatItem[], index: number): string | undefined {
  const previous = items[index - 1];
  return previous?.kind === 'question' ? previous.text : undefined;
}

// The questions and answers of a conversation, the same in the chat screen and
// in the floating window.
export function MessageList({ chat, usage, onAsk }: MessageListProps) {
  return (
    <>
      {chat.items.map((item, index) => {
        if (item.kind === 'question') {
          return (
            <div key={item.id} className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1">
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
            usage={usage}
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
                    onAsk(question);
                  }
            }
          />
        );
      })}
    </>
  );
}
