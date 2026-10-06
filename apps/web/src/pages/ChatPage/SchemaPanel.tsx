import type { SchemaColumn, SchemaTable } from '@interview-lab/shared';
import { SchemaService } from '../../api/modules/schema.service';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { ChevronDownIcon } from '../../components/ui/icons';
import { Spinner } from '../../components/ui/Spinner';
import { useApiData } from '../../hooks/useApiData';

interface SchemaPanelProps {
  // Tables read by the last query of the conversation, as the server reported.
  usedTables: string[];
}

function KeyMark({ column }: { column: SchemaColumn }) {
  if (column.primaryKey) {
    return (
      <abbr
        title="Chave primária"
        className="rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent-text no-underline"
      >
        PK
      </abbr>
    );
  }
  if (column.references) {
    return (
      <abbr
        title={`Chave estrangeira para ${column.references.table}.${column.references.column}`}
        className="rounded bg-surface-3 px-1 text-[10px] font-semibold text-text-2 no-underline"
      >
        FK
      </abbr>
    );
  }
  return null;
}

function TableEntry({ table, used }: { table: SchemaTable; used: boolean }) {
  return (
    <li>
      <details className="group rounded-md">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon
            size={12}
            className="shrink-0 -rotate-90 text-text-3 transition-transform group-open:rotate-0"
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{table.name}</span>
          {used && (
            <span
              role="img"
              aria-label="Usada na última consulta"
              title="Usada na última consulta"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            />
          )}
          <span className="text-[11px] text-text-3">{table.columns.length}</span>
        </summary>
        <ul className="pt-0.5 pb-1.5 pl-7">
          {table.columns.map((column) => (
            <li key={column.name} className="flex items-center gap-1.5 py-[3px] pr-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono">{column.name}</span>
              <KeyMark column={column} />
              <span className="shrink-0 font-mono text-[11px] text-text-3">{column.type}</span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

// The tables the AI can read, with their columns, types and keys. A dot marks
// the tables the last query of the conversation used.
export function SchemaPanel({ usedTables }: SchemaPanelProps) {
  const schema = useApiData('schema', (signal) => SchemaService.overview(signal));

  return (
    <aside
      aria-label="Schema"
      className="flex max-h-[40dvh] w-full shrink-0 flex-col border-t border-line bg-surface-2 md:h-full md:max-h-none md:w-[300px] md:border-t-0 md:border-l"
    >
      <div className="border-b border-line px-3 py-2.5">
        <h2 className="text-[13px] font-semibold">Schema</h2>
        <p className="mt-0.5 text-[11.5px] text-text-3">
          Tabelas que a IA pode ler. Tudo é somente leitura.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {schema.error !== undefined && <ErrorMessage message={schema.error} />}
        {!schema.data && schema.error === undefined && <Spinner label="Carregando o schema…" />}
        {schema.data && (
          <ul className="space-y-0.5">
            {schema.data.tables.map((table) => (
              <TableEntry key={table.name} table={table} used={usedTables.includes(table.name)} />
            ))}
          </ul>
        )}
      </div>
      {usedTables.length > 0 && (
        <p className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-[11.5px] text-text-3">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
          Usada na última consulta
        </p>
      )}
    </aside>
  );
}
