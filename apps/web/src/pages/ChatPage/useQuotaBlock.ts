import { useEffect, useState } from 'react';
import type { ChatItem } from './chat-state';

const QUOTA_CODE = 'QUOTA_EXCEEDED';
const MILLISECONDS_PER_SECOND = 1000;

interface QuotaBlock {
  message: string;
  // When the server said the quota renews; unknown when it sent no time.
  until: number | undefined;
}

// The server refused the last question because the daily quota ran out.
function quotaBlock(items: ChatItem[]): QuotaBlock | undefined {
  const last = items.at(-1);
  if (last?.kind !== 'answer' || last.error?.code !== QUOTA_CODE) {
    return undefined;
  }
  const { retryAfterSeconds } = last.error;
  const refusedAt = Date.parse(last.time);
  return {
    message: last.error.message,
    until:
      retryAfterSeconds === undefined || Number.isNaN(refusedAt)
        ? undefined
        : refusedAt + retryAfterSeconds * MILLISECONDS_PER_SECOND,
  };
}

// Why the composer is blocked, if it is: asking again before the quota renews
// gets the same refusal. The block lifts by itself at the time the server
// gave; the server still decides whether the next question is accepted.
export function useQuotaBlock(items: ChatItem[]): string | undefined {
  const block = quotaBlock(items);
  const until = block?.until;
  // The renewal time that has already passed.
  const [passed, setPassed] = useState<number>();

  useEffect(() => {
    if (until === undefined) {
      return undefined;
    }
    const timer = setTimeout(
      () => {
        setPassed(until);
      },
      Math.max(0, until - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [until]);

  return block !== undefined && (until === undefined || until !== passed)
    ? block.message
    : undefined;
}
