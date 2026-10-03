import { useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';

// Mirrors the backend limit only to warn early; the backend validates again.
const MAX_QUESTION_LENGTH = 1000;

interface QuestionFormProps {
  isAnswering: boolean;
  onAsk: (question: string) => void;
  onCancel: () => void;
}

export function QuestionForm({ isAnswering, onAsk, onCancel }: QuestionFormProps) {
  const [question, setQuestion] = useState('');
  const trimmed = question.trim();
  const canSend = !isAnswering && trimmed !== '' && question.length <= MAX_QUESTION_LENGTH;

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
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-border bg-surface p-3">
      <label className="flex-1">
        <span className="sr-only">Pergunta</span>
        <textarea
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          rows={2}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder="Pergunte sobre os dados de vendas, ex.: qual o faturamento por região no último trimestre?"
          className="w-full resize-none rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none"
        />
      </label>
      {isAnswering ? (
        <Button variant="secondary" onClick={onCancel}>
          Parar
        </Button>
      ) : (
        <Button type="submit" disabled={!canSend}>
          Enviar
        </Button>
      )}
    </form>
  );
}
