import type { QueryResult } from '@interview-lab/shared';
import { formatCell, isNumericType } from '../utils/format';

interface ResultTableProps {
  result: QueryResult;
  // Shows only the first rows; all of them when absent.
  maxRows?: number | undefined;
}

export function ResultTable({ result, maxRows }: ResultTableProps) {
  if (result.rows.length === 0) {
    return (
      <p className="px-3 py-2 text-[13px] text-text-2">A consulta não retornou nenhuma linha.</p>
    );
  }
  const rows = maxRows === undefined ? result.rows : result.rows.slice(0, maxRows);

  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            {result.columns.map((column, index) => (
              <th
                key={`${column.name}-${String(index)}`}
                scope="col"
                className={`border-b border-line px-3 py-[7px] font-mono text-[11.5px] font-medium whitespace-nowrap text-text-3 ${
                  isNumericType(column.type) ? 'text-right' : 'text-left'
                }`}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-surface-2">
              {result.columns.map((column, columnIndex) => (
                <td
                  key={columnIndex}
                  className={`border-b border-line px-3 py-[7px] text-[12.5px] whitespace-nowrap ${
                    isNumericType(column.type) ? 'text-right font-mono' : 'text-left'
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
