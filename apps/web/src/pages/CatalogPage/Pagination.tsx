import { Button } from '../../components/ui/Button';
import { formatInteger } from '../../utils/format';

interface PaginationProps {
  // What is being listed, in the plural: "materiais", "movimentações".
  label: string;
  page: number;
  pageSize: number;
  // How many items the server says there are in all.
  total: number;
  onPageChange: (page: number) => void;
}

// Where the page stands in the list, and the way to the pages around it.
export function Pagination({ label, page, pageSize, total, onPageChange }: PaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={`Páginas de ${label}`}
      className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-text-3"
    >
      <span className="flex-1">
        {formatInteger(first)}–{formatInteger(last)} de {formatInteger(total)} {label}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => {
          onPageChange(page - 1);
        }}
      >
        Anterior
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={last >= total}
        onClick={() => {
          onPageChange(page + 1);
        }}
      >
        Próxima
      </Button>
    </nav>
  );
}
