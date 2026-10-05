import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert } from './Alert';

afterEach(() => {
  vi.useRealTimers();
});

describe('Alert', () => {
  it('shows the title and the body', () => {
    render(<Alert variant="warn" title="Atenção" body="Detalhe do aviso." />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Atenção');
    expect(alert).toHaveTextContent('Detalhe do aviso.');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('counts down once per second and stops at zero', () => {
    vi.useFakeTimers();
    render(<Alert variant="warn" title="Limite" countdown={2} />);
    expect(screen.getByRole('timer')).toHaveTextContent('00:02');
    expect(screen.getByRole('alert')).toHaveTextContent('Libera em');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('00:01');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
  });

  it('shows hours from one hour on, with its own label', () => {
    render(<Alert variant="crit" title="Cota" countdown={34_020} countdownLabel="Renova em" />);

    expect(screen.getByRole('timer')).toHaveTextContent('9:27:00');
    expect(screen.getByRole('alert')).toHaveTextContent('Renova em');
  });

  it('restarts when a new countdown arrives', () => {
    const { rerender } = render(<Alert variant="warn" title="Limite" countdown={10} />);

    rerender(<Alert variant="warn" title="Limite" countdown={42} />);

    expect(screen.getByRole('timer')).toHaveTextContent('00:42');
  });

  it('shows the usage meter', () => {
    render(<Alert variant="crit" title="Cota" meterUsed={150_000} meterTotal={200_000} />);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '150000');
    expect(meter).toHaveAttribute('aria-valuemax', '200000');
    expect(screen.getByRole('alert')).toHaveTextContent('150.000 / 200.000');
  });

  it('reports the action chosen', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <Alert
        variant="info"
        title="Dica"
        actions={['Tentar novamente', 'Fechar']}
        onAction={onAction}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(onAction).toHaveBeenCalledWith('Tentar novamente');
  });
});
