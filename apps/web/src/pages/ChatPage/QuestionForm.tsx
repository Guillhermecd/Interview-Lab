import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ArrowUpIcon } from '../../components/ui/icons';

// Mirrors the backend limit only to warn early; the backend validates again.
const MAX_QUESTION_LENGTH = 1000;

interface QuestionFormProps {
  isAnswering: boolean;
  review: boolean;
  // Text the composer starts with.
  initialQuestion?: string | undefined;
  // Set when the server refused the last question for a reason that sending
  // another one will not fix (the daily quota): explains why, and blocks sending.
  blockedReason?: string | undefined;
  onReviewChange: (review: boolean) => void;
  onAsk: (question: string) => void;
  onCancel: () => void;
}

export function QuestionForm({
  isAnswering,
  review,
  initialQuestion = '',
  blockedReason,
  onReviewChange,
  onAsk,
  onCancel,
}: QuestionFormProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const reviewLabelId = useId();
  const trimmed = question.trim();
  const blocked = blockedReason !== undefined;
  const canSend =
    !isAnswering && !blocked && trimmed !== '' && question.length <= MAX_QUESTION_LENGTH;

  function submit(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    if (canSend) {
      onAsk(trimmed);
      setQuestion('');
    }
  }

  // Enter sends; Shift+Enter breaks the line.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line bg-bg px-4 pt-3 pb-3.5">
      <div className="mx-auto max-w-[900px] space-y-2">
        <div className="rounded-[10px] border border-line-2 bg-surface focus-within:border-accent">
          <label className="block">
            <span className="sr-only">Pergunta</span>
            <textarea
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
              }}
              onKeyDown={handleKeyDown}
              rows={2}
              maxLength={MAX_QUESTION_LENGTH}
              disabled={blocked}
              placeholder={
                blockedReason ?? 'Pergunte sobre faturamento, estoque, pedidos, clientes…'
              }
              className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm placeholder:text-text-3 focus:outline-none disabled:cursor-not-allowed"
            />
          </label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2.5 pb-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={review}
              aria-labelledby={reviewLabelId}
              onClick={() => {
                onReviewChange(!review);
              }}
              className="group inline-flex cursor-pointer items-center gap-2 rounded-md py-1 pr-1.5 pl-1 text-[12.5px] text-text-2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span
                aria-hidden="true"
                className={`relative h-4 w-7 rounded-full transition-colors ${
                  review ? 'bg-accent' : 'bg-line-2'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-[left] ${
                    review ? 'left-3.5' : 'left-0.5'
                  }`}
                />
              </span>
              <span id={reviewLabelId}>Revisar SQL antes de executar</span>
            </button>
            <div className="flex-1" />
            <span className="text-[11.5px] text-text-3">
              Enter envia · Shift+Enter quebra linha
            </span>
            {isAnswering ? (
              <Button variant="secondary" onClick={onCancel}>
                Parar
              </Button>
            ) : (
              <Button type="submit" disabled={!canSend}>
                <ArrowUpIcon size={13} strokeWidth={2} />
                Enviar
              </Button>
            )}
          </div>
        </div>
        <p className="text-center text-[11.5px] text-text-3">
          A IA só lê dados. Toda consulta passa pela validação de segurança antes de ser executada.
        </p>
      </div>
    </form>
  );
}
