import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SqlEditor } from './SqlEditor';
import { Button } from './ui/Button';
import {
  BanIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  PencilIcon,
  PlayIcon,
  ShieldCheckIcon,
  ShieldXIcon,
} from './ui/icons';
import { SpinnerRing } from './ui/Spinner';

export type SqlBlockMode = 'generating' | 'review' | 'running' | 'view';
// What the backend said about this SQL. Absent while nothing was said yet.
export type SqlBlockStatus = 'validated' | 'blocked';

export interface SqlRunRequest {
  sql: string;
  edited: boolean;
}

interface SqlBlockProps {
  sql: string;
  mode: SqlBlockMode;
  status?: SqlBlockStatus | undefined;
  // Replaces the default text beside the badge.
  reason?: string | undefined;
  // The SQL shown is not the one the AI wrote.
  edited?: boolean;
  // Time the query has been running, already formatted.
  elapsed?: string | undefined;
  // Blocks the actions that start something (another answer is in progress).
  disabled?: boolean;
  onApprove?: (request: SqlRunRequest) => void;
  onCancel?: () => void;
  onRun?: (request: SqlRunRequest) => void;
  onEdit?: (sql: string) => void;
  // Goes back to the SQL the AI wrote; shown while an edit waits for approval.
  onUndoEdit?: () => void;
}

const COLLAPSE_ABOVE_LINES = 8;
const COLLAPSED_LINES = 4;
const COPIED_FEEDBACK_MS = 1500;

const BADGE_CLASS =
  'inline-flex h-[22px] items-center gap-[5px] rounded px-2 text-xs font-semibold whitespace-nowrap';

function reasonFor(
  mode: SqlBlockMode,
  status: SqlBlockStatus | undefined,
  edited: boolean,
  reason: string | undefined,
): string {
  if (mode === 'generating') {
    return 'Validação de segurança em seguida';
  }
  if (status === 'blocked') {
    return reason ?? 'Recusada pelas regras de segurança';
  }
  if (status === undefined) {
    return 'Será revalidada pela segurança ao executar';
  }
  if (edited) {
    return 'Revalidado após sua edição · somente leitura';
  }
  return reason ?? 'Somente leitura';
}

function Footer({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 border-t py-[9px] pr-2.5 pl-3 ${tone}`}>
      {children}
    </div>
  );
}

// The SQL of an answer, with what the security validation said about it and the
// actions of each moment: review (approve, edit, cancel), running (stop) and
// view (copy, and run again when the caller supports it). Editing happens here;
// the edited SQL is validated by the backend when it runs.
export function SqlBlock({
  sql,
  mode,
  status,
  reason,
  edited = false,
  elapsed,
  disabled = false,
  onApprove,
  onCancel,
  onRun,
  onEdit,
  onUndoEdit,
}: SqlBlockProps) {
  const [baseSql, setBaseSql] = useState(sql);
  const [baseMode, setBaseMode] = useState(mode);
  // An edit saved here and not yet taken over by the caller through `sql`.
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (baseSql !== sql) {
    setBaseSql(sql);
    setSaved(null);
    setEditing(false);
    setExpanded(null);
  }
  if (baseMode !== mode) {
    setBaseMode(mode);
    setExpanded(null);
  }

  useEffect(
    () => () => {
      clearTimeout(copiedTimer.current);
    },
    [],
  );

  const current = saved ?? sql;
  const isEdited = edited || saved !== null;
  // A local edit has not been seen by the backend: what it said no longer applies.
  const currentStatus = saved === null ? status : undefined;
  const isBlocked = mode !== 'generating' && currentStatus === 'blocked';
  const isValidated = mode !== 'generating' && currentStatus === 'validated';

  const lines = current.split('\n');
  const collapsible = mode === 'view' && !isBlocked && lines.length > COLLAPSE_ABOVE_LINES;
  const isExpanded = expanded ?? !collapsible;
  const shownSql = isExpanded ? current : lines.slice(0, COLLAPSED_LINES).join('\n');

  const request: SqlRunRequest = { sql: current, edited: isEdited };
  const canEdit = onEdit !== undefined && !editing;

  function startEditing() {
    setDraft(current);
    setEditing(true);
  }

  function saveDraft() {
    setEditing(false);
    setSaved(draft.trim() === sql.trim() ? null : draft);
    onEdit?.(draft);
  }

  function undoEdit() {
    setSaved(null);
    onUndoEdit?.();
  }

  function copy() {
    // Without clipboard access (insecure origin) there is nothing to copy to.
    void navigator.clipboard.writeText(current).then(
      () => {
        setCopied(true);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => {
          setCopied(false);
        }, COPIED_FEEDBACK_MS);
      },
      () => undefined,
    );
  }

  const frame = isBlocked
    ? 'border-line-blocked'
    : mode === 'review'
      ? 'border-line-review'
      : 'border-line';

  return (
    <section
      aria-label={mode === 'review' ? 'Revisão do SQL' : 'Consulta SQL'}
      className={`min-w-0 overflow-hidden rounded-lg border bg-surface ${frame}`}
    >
      <header className="flex min-h-7 flex-wrap items-center gap-2 border-b border-line bg-surface-2 py-[7px] pr-2 pl-3">
        <span className="font-mono text-[11px] leading-none font-semibold tracking-[0.06em] text-text-2">
          SQL
        </span>
        <span className="text-xs text-text-3">PostgreSQL · somente leitura</span>
        {isValidated && (
          <span className={`${BADGE_CLASS} bg-ok-soft text-ok`}>
            <ShieldCheckIcon size={13} />
            Validado
          </span>
        )}
        {isBlocked && (
          <span className={`${BADGE_CLASS} bg-crit-soft text-crit`}>
            <ShieldXIcon size={13} />
            Bloqueado
          </span>
        )}
        {mode === 'generating' && (
          <span className={`${BADGE_CLASS} gap-1.5 bg-surface-3 text-text-2`}>
            <SpinnerRing />
            Gerando
          </span>
        )}
        <span className={`text-xs ${isBlocked ? 'text-crit' : 'text-text-3'}`}>
          {reasonFor(mode, currentStatus, isEdited, reason)}
        </span>
        {isEdited && (
          <span className={`${BADGE_CLASS} bg-accent-soft text-accent-text`}>
            <PencilIcon size={12} />
            Editado por você
          </span>
        )}
        <div className="flex-1" />
        <div className="flex gap-1">
          {isEdited && mode === 'review' && !editing && onUndoEdit && (
            <Button variant="ghost" size="sm" onClick={undoEdit}>
              Desfazer edição
            </Button>
          )}
          {isBlocked && mode !== 'review' && (
            <Button size="sm" disabled title="Consulta bloqueada não pode ser executada">
              <PlayIcon size={10} />
              Executar
            </Button>
          )}
          {mode === 'view' && isValidated && !editing && onRun && (
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => {
                onRun(request);
              }}
            >
              <PlayIcon size={10} />
              Executar
            </Button>
          )}
          {mode === 'view' && !isBlocked && canEdit && onRun && (
            <Button variant="secondary" size="sm" onClick={startEditing}>
              <PencilIcon size={12} />
              Editar
            </Button>
          )}
          {mode !== 'generating' && (
            <Button variant="secondary" size="sm" onClick={copy}>
              <CopyIcon size={12} />
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          )}
        </div>
      </header>

      {editing ? (
        <>
          <SqlEditor value={draft} onChange={setDraft} label="SQL para revisar" />
          <Footer tone="border-line bg-surface-2">
            <span className="min-w-[200px] flex-1 text-[12.5px] text-text-2">
              Editando. A consulta será revalidada pela segurança ao executar.
            </span>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setEditing(false);
              }}
            >
              Descartar
            </Button>
            <Button size="md" disabled={draft.trim() === ''} onClick={saveDraft}>
              Salvar alterações
            </Button>
          </Footer>
        </>
      ) : (
        <>
          {mode === 'generating' && current === '' ? (
            <div className="bg-code-bg py-2.5 pl-10 font-mono text-[12.5px] leading-[1.65]">
              <span className="inline-block h-[1.2em] w-[7px] animate-blink bg-accent align-[-3px]" />
            </div>
          ) : (
            <SqlEditor value={shownSql} />
          )}
          {collapsible && (
            <button
              type="button"
              onClick={() => {
                setExpanded(!isExpanded);
              }}
              className="flex h-[30px] w-full cursor-pointer items-center justify-center gap-1.5 border-t border-line bg-surface text-xs font-medium text-text-2 hover:bg-surface-2 hover:text-text"
            >
              {isExpanded
                ? 'Recolher consulta'
                : `Mostrar consulta completa · ${String(lines.length)} linhas`}
            </button>
          )}
        </>
      )}

      {mode === 'review' && !editing && (
        <Footer tone="border-line bg-accent-soft">
          <EyeIcon size={15} className="shrink-0 text-accent-text" />
          <span className="min-w-[220px] flex-1 text-[12.5px] font-medium text-accent-text">
            Revisão necessária. Confira a consulta antes de executar no banco.
          </span>
          {onCancel && (
            <Button variant="ghost" size="md" onClick={onCancel}>
              Cancelar
            </Button>
          )}
          {canEdit && (
            <Button variant="secondary" size="md" onClick={startEditing}>
              <PencilIcon size={12} />
              Editar
            </Button>
          )}
          <Button
            size="md"
            disabled={disabled || isBlocked || current.trim() === ''}
            title={isBlocked ? 'Consulta bloqueada não pode ser executada' : undefined}
            onClick={() => {
              onApprove?.(request);
            }}
          >
            <CheckIcon size={12} strokeWidth={1.8} />
            Aprovar e executar
          </Button>
        </Footer>
      )}

      {mode === 'running' && (
        <Footer tone="border-line bg-surface-2">
          <SpinnerRing />
          <span role="status" className="flex-1 text-[12.5px] text-text-2">
            Executando consulta…
            {elapsed !== undefined && <span className="font-mono text-text"> {elapsed}</span>}
          </span>
          {onCancel && (
            <Button variant="secondary" size="md" onClick={onCancel}>
              Interromper
            </Button>
          )}
        </Footer>
      )}

      {isBlocked && !editing && (
        <div className="flex items-center gap-2 border-t border-line-crit bg-crit-soft px-3 py-[9px] text-[12.5px] font-medium text-crit">
          <BanIcon size={14} className="shrink-0" />
          Não executada. A consulta foi recusada pela validação de segurança.
        </div>
      )}
    </section>
  );
}
