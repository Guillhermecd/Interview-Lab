import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { replaceSqlEditorText } from '../test/sql-editor';
import { SqlBlock } from './SqlBlock';

const SQL = 'SELECT name FROM regions ORDER BY name';
const LONG_SQL = Array.from({ length: 10 }, (_item, index) => `-- linha ${String(index + 1)}`).join(
  '\n',
);

describe('SqlBlock', () => {
  it('shows a validated SQL with its reason', () => {
    render(<SqlBlock sql={SQL} mode="view" status="validated" />);

    expect(screen.getByLabelText('SQL gerado')).toHaveTextContent(SQL);
    expect(screen.getByText('Validado')).toBeInTheDocument();
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    expect(screen.queryByText('Editado por você')).not.toBeInTheDocument();
  });

  it('marks the SQL as edited after the user saves a change', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<SqlBlock sql={SQL} mode="review" status="validated" onEdit={onEdit} />);
    expect(screen.queryByText('Editado por você')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    replaceSqlEditorText('SQL para revisar', `${SQL} LIMIT 5`);
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(screen.getByText('Editado por você')).toBeInTheDocument();
    expect(onEdit).toHaveBeenCalledWith(`${SQL} LIMIT 5`);
    expect(screen.getByLabelText('SQL gerado')).toHaveTextContent(`${SQL} LIMIT 5`);
    // The new text has not been validated: the badge and its reason say so.
    expect(screen.queryByText('Validado')).not.toBeInTheDocument();
    expect(screen.getByText('Será revalidada pela segurança ao executar')).toBeInTheDocument();
  });

  it('does not mark as edited when the saved text is the same', async () => {
    const user = userEvent.setup();
    render(<SqlBlock sql={SQL} mode="review" status="validated" onEdit={() => undefined} />);

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(screen.queryByText('Editado por você')).not.toBeInTheDocument();
    expect(screen.getByText('Validado')).toBeInTheDocument();
  });

  it('keeps the SQL when the edit is discarded', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<SqlBlock sql={SQL} mode="review" status="validated" onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    replaceSqlEditorText('SQL para revisar', 'SELECT 1');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(screen.getByLabelText('SQL gerado')).toHaveTextContent(SQL);
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByText('Editado por você')).not.toBeInTheDocument();
  });

  it('approves the SQL under review, telling whether it was edited', async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(
      <SqlBlock
        sql={SQL}
        mode="review"
        status="validated"
        onApprove={onApprove}
        onEdit={() => undefined}
      />,
    );
    expect(screen.getByRole('region', { name: 'Revisão do SQL' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    replaceSqlEditorText('SQL para revisar', 'SELECT 1');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await user.click(screen.getByRole('button', { name: 'Aprovar e executar' }));

    expect(onApprove).toHaveBeenCalledWith({ sql: 'SELECT 1', edited: true });
  });

  it('cancels the review', async () => {
    const onCancel = vi.fn();
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(
      <SqlBlock
        sql={SQL}
        mode="review"
        status="validated"
        onCancel={onCancel}
        onApprove={onApprove}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApprove).not.toHaveBeenCalled();
  });

  describe('blocked', () => {
    it('cannot be run in view mode', async () => {
      const onRun = vi.fn();
      const user = userEvent.setup();
      render(
        <SqlBlock
          sql="DELETE FROM regions"
          mode="view"
          status="blocked"
          reason="Apenas consultas SELECT são permitidas."
          onRun={onRun}
          onEdit={() => undefined}
        />,
      );

      expect(screen.getByText('Bloqueado')).toBeInTheDocument();
      expect(screen.getByText('Apenas consultas SELECT são permitidas.')).toBeInTheDocument();
      const run = screen.getByRole('button', { name: 'Executar' });
      expect(run).toBeDisabled();
      await user.click(run);
      expect(onRun).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
      expect(screen.getByText(/Não executada\./)).toBeInTheDocument();
    });

    it('cannot be approved under review', async () => {
      const onApprove = vi.fn();
      const user = userEvent.setup();
      render(
        <SqlBlock sql="DELETE FROM regions" mode="review" status="blocked" onApprove={onApprove} />,
      );

      const approve = screen.getByRole('button', { name: 'Aprovar e executar' });
      expect(approve).toBeDisabled();
      await user.click(approve);
      expect(onApprove).not.toHaveBeenCalled();
    });
  });

  it('runs a validated SQL again when the caller supports it', async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SqlBlock sql={SQL} mode="view" status="validated" />);
    expect(screen.queryByRole('button', { name: 'Executar' })).not.toBeInTheDocument();

    rerender(<SqlBlock sql={SQL} mode="view" status="validated" onRun={onRun} />);
    await user.click(screen.getByRole('button', { name: 'Executar' }));

    expect(onRun).toHaveBeenCalledWith({ sql: SQL, edited: false });
  });

  it('shows the running clock and stops on request', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<SqlBlock sql={SQL} mode="running" elapsed="2,4 s" onCancel={onCancel} />);

    expect(screen.getByRole('status')).toHaveTextContent('Executando consulta… 2,4 s');
    await user.click(screen.getByRole('button', { name: 'Interromper' }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('says the SQL is being generated, with no actions', () => {
    render(<SqlBlock sql="" mode="generating" />);

    expect(screen.getByText('Gerando')).toBeInTheDocument();
    expect(screen.getByText('Validação de segurança em seguida')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('collapses a long SQL in view mode and expands it on request', async () => {
    const user = userEvent.setup();
    render(<SqlBlock sql={LONG_SQL} mode="view" status="validated" />);

    const viewer = screen.getByLabelText('SQL gerado');
    expect(viewer).toHaveTextContent('-- linha 4');
    expect(viewer).not.toHaveTextContent('-- linha 5');

    await user.click(screen.getByRole('button', { name: 'Mostrar consulta completa · 10 linhas' }));

    expect(viewer).toHaveTextContent('-- linha 10');
    expect(screen.getByRole('button', { name: 'Recolher consulta' })).toBeInTheDocument();
  });

  it('copies the SQL', async () => {
    const user = userEvent.setup();
    render(<SqlBlock sql={SQL} mode="view" status="validated" />);

    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe(SQL);
  });
});
