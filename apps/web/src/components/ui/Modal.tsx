import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  // Width of the window: forms are narrow, tables wider.
  size?: 'md' | 'lg';
}

const SIZE_CLASSES = { md: 'max-w-md', lg: 'max-w-2xl' };

// A window over the page for one task. Escape and the close button dismiss it;
// focus moves into it when it opens and returns to where it was when it closes.
export function Modal({ title, onClose, children, size = 'md' }: ModalProps) {
  const titleId = useId();
  const windowRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement;
    const first = windowRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    (first ?? windowRef.current)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div
        ref={windowRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${SIZE_CLASSES[size]} rounded-xl border border-line-2 bg-surface shadow-elevated focus:outline-none`}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 id={titleId} className="flex-1 text-sm font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-2 hover:bg-surface-3 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            <CloseIcon size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
