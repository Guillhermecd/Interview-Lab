import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerItem, ChatItem } from './chat-state';
import { useQuotaBlock } from './useQuotaBlock';

const NOW = '2026-10-05T23:59:00.000Z';
const MESSAGE = 'A cota diária de uso da IA foi atingida.';

function refused(code: string, retryAfterSeconds?: number): AnswerItem {
  return {
    kind: 'answer',
    id: 'a-1',
    status: 'error',
    time: NOW,
    sqlAttempts: [],
    explanation: '',
    fromHistory: false,
    error: { code, message: MESSAGE, retryAfterSeconds },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useQuotaBlock', () => {
  it('does not block an ordinary conversation', () => {
    const { result } = renderHook(() => useQuotaBlock([]));

    expect(result.current).toBeUndefined();
  });

  it('blocks with the reason while the quota has not renewed, then lifts by itself', () => {
    const items: ChatItem[] = [refused('QUOTA_EXCEEDED', 60)];
    const { result } = renderHook(() => useQuotaBlock(items));
    expect(result.current).toBe(MESSAGE);

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current).toBe(MESSAGE);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBeUndefined();
  });

  it('stays blocked when the server gave no renewal time', () => {
    const items: ChatItem[] = [refused('QUOTA_EXCEEDED')];
    const { result } = renderHook(() => useQuotaBlock(items));

    act(() => {
      vi.advanceTimersByTime(86_400_000);
    });

    expect(result.current).toBe(MESSAGE);
  });

  it('does not block for the per-minute limit, which the user may simply retry', () => {
    const items: ChatItem[] = [refused('RATE_LIMITED', 42)];
    const { result } = renderHook(() => useQuotaBlock(items));

    expect(result.current).toBeUndefined();
  });

  it('only looks at the last answer', () => {
    const later: AnswerItem = { ...refused('QUOTA_EXCEEDED', 60), id: 'a-0' };
    const answered: AnswerItem = {
      kind: 'answer',
      id: 'a-2',
      status: 'answered',
      time: NOW,
      sqlAttempts: ['SELECT 1'],
      explanation: 'Ok.',
      fromHistory: false,
    };
    const { result } = renderHook(() => useQuotaBlock([later, answered]));

    expect(result.current).toBeUndefined();
  });
});
