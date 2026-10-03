import type { QueryResult } from '@interview-lab/shared';
import { formatCell, isNumericType } from '../utils/format';

interface ResultTableProps {
  result: QueryResult;
}

export function ResultTable({ result }: ResultTableProps) {
  if (result.rows.length === 0) {
    return <p className="text-sm text-muted">A consulta não retornou nenhuma linha.</p>;
  }

  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-surface-sunken">
          <tr>
            {result.columns.map((column, index) => (
              <th
                key={`${column.name}-${String(index)}`}
                scope="col"
                className={`border-b border-border px-3 py-2 font-semibold whitespace-nowrap ${
                  isNumericType(column.type) ? 'text-right' : 'text-left'
                }`}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-surface even:bg-surface-muted">
              {result.columns.map((column, columnIndex) => (
                <td
                  key={columnIndex}
                  className={`border-b border-border px-3 py-1.5 whitespace-nowrap ${
                    isNumericType(column.type) ? 'text-right tabular-nums' : 'text-left'
                  }`}
                >
                  {formatCell(row[columnIndex], column.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
