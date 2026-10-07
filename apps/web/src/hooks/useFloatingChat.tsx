import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type FloatingChatStatus = 'closed' | 'open' | 'minimized';

// What a card hands to the floating chat: what the question is about and the
// question itself, written in the composer for the user to send (D-42, D-49).
export interface FloatingChatPrompt {
  // Changes at every request, so asking twice about the same card counts twice.
  id: number;
  context: string;
  question: string;
}

interface FloatingChat {
  status: FloatingChatStatus;
  prompt: FloatingChatPrompt | undefined;
  open: () => void;
  // Opens the window with the context and the question written, not sent.
  openWith: (context: string, question: string) => void;
  toggleMinimized: () => void;
  // Closing ends what the window was showing; the conversation stays saved.
  close: () => void;
  // The context chip was removed, or the question went out.
  clearPrompt: () => void;
}

// Outside the provider (a screen rendered alone) there is no window to open.
const FloatingChatContext = createContext<FloatingChat>({
  status: 'closed',
  prompt: undefined,
  open: () => undefined,
  openWith: () => undefined,
  toggleMinimized: () => undefined,
  close: () => undefined,
  clearPrompt: () => undefined,
});

// The chat window that floats over the dashboard and the registry (Phase 09d,
// D-63). Its state lives above the screens, so moving between them keeps it.
export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FloatingChatStatus>('closed');
  const [prompt, setPrompt] = useState<FloatingChatPrompt>();

  const open = useCallback(() => {
    setStatus('open');
  }, []);

  const openWith = useCallback((context: string, question: string) => {
    setPrompt((current) => ({ id: (current?.id ?? 0) + 1, context, question }));
    setStatus('open');
  }, []);

  const toggleMinimized = useCallback(() => {
    setStatus((current) => (current === 'minimized' ? 'open' : 'minimized'));
  }, []);

  const close = useCallback(() => {
    setStatus('closed');
    setPrompt(undefined);
  }, []);

  // The id is kept: the next request still gets a new one.
  const clearPrompt = useCallback(() => {
    setPrompt((current) => (current ? { ...current, context: '', question: '' } : current));
  }, []);

  const value = useMemo(
    () => ({ status, prompt, open, openWith, toggleMinimized, close, clearPrompt }),
    [status, prompt, open, openWith, toggleMinimized, close, clearPrompt],
  );

  return <FloatingChatContext value={value}>{children}</FloatingChatContext>;
}

export function useFloatingChat(): FloatingChat {
  return useContext(FloatingChatContext);
}
