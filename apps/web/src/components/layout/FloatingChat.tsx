import { lazy, Suspense } from 'react';
import { useFloatingChat } from '../../hooks/useFloatingChat';
import { MessageSquareIcon } from '../ui/icons';
import { Spinner } from '../ui/Spinner';

// The window brings the SQL editor and the charts; it is loaded when first
// opened, so the screens under it do not carry that weight.
const FloatingChatWindow = lazy(() => import('../../pages/ChatPage/FloatingChatWindow'));

function WindowLoading() {
  return (
    <div className="fixed right-6 bottom-6 z-40 flex h-12 w-[min(420px,calc(100vw-32px))] items-center rounded-xl border border-line-2 bg-surface-2 px-3 shadow-elevated">
      <Spinner label="Abrindo o chat…" />
    </div>
  );
}

// The chat over a screen (Phase 09d): a floating button while closed, the
// window once opened.
export function FloatingChat() {
  const { status, open } = useFloatingChat();

  if (status === 'closed') {
    return (
      <button
        type="button"
        onClick={open}
        className="fixed right-6 bottom-6 z-40 inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-accent px-4 text-[13.5px] font-semibold text-on-accent shadow-elevated hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <MessageSquareIcon size={16} />
        Converse com seus dados
      </button>
    );
  }
  return (
    <Suspense fallback={<WindowLoading />}>
      <FloatingChatWindow />
    </Suspense>
  );
}
