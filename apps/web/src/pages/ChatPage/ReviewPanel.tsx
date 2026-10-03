import { useState } from 'react';
import { SqlEditor } from '../../components/SqlEditor';
import { Button } from '../../components/ui/Button';

interface ReviewPanelProps {
  // The SQL generated for review, and the version to start editing from.
  sql: string;
  initialDraft: string;
  disabled: boolean;
  onExecute: (sql: string) => void;
}

// Review mode (Phase 07): the SQL waits here until the user runs it, as
// generated or edited. Whatever is sent is validated again by the backend.
export function ReviewPanel({ sql, initialDraft, disabled, onExecute }: ReviewPanelProps) {
  const [draft, setDraft] = useState(initialDraft);
  const changed = draft.trim() !== sql.trim();
  const empty = draft.trim() === '';

  return (
    <section aria-label="Revisão do SQL" className="space-y-2">
      <p className="text-sm">
        Revise o SQL antes de executar. Você pode editá-lo; ele passa de novo pelas regras de
        segurança no servidor.
      </p>
      <SqlEditor value={draft} onChange={setDraft} label="SQL para revisar" />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={disabled || empty}
          onClick={() => {
            onExecute(draft);
          }}
        >
          {changed ? 'Executar SQL editado' : 'Executar'}
        </Button>
        {changed && (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setDraft(sql);
            }}
          >
            Desfazer edição
          </Button>
        )}
      </div>
    </section>
  );
}
