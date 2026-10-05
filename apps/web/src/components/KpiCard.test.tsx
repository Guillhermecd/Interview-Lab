import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KpiCard } from './KpiCard';

const BASE = {
  label: 'Giro de estoque',
  value: '36 dias',
  delta: '+3 dias',
  compareLabel: 'vs. agosto',
  spark: [33, 34, 33, 35, 36],
  onAsk: () => undefined,
};

describe('KpiCard', () => {
  it('shows the value, the variation and what it is compared to', () => {
    render(<KpiCard {...BASE} trend="up" sentiment="bad" sub="Agosto: 33 dias" />);

    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('Giro de estoque');
    expect(card).toHaveTextContent('36 dias');
    expect(card).toHaveTextContent('+3 dias');
    expect(card).toHaveTextContent('vs. agosto');
    expect(card).toHaveTextContent('Agosto: 33 dias');
  });

  it('colors the variation by sentiment, not by direction', () => {
    const { rerender } = render(<KpiCard {...BASE} trend="up" sentiment="bad" />);
    // A rise that is bad news (more days of stock) is shown as critical.
    expect(screen.getByText('+3 dias')).toHaveAttribute('data-sentiment', 'bad');
    expect(screen.getByText('+3 dias')).toHaveClass('text-crit');

    rerender(<KpiCard {...BASE} trend="up" sentiment="good" />);
    expect(screen.getByText('+3 dias')).toHaveClass('text-ok');

    rerender(<KpiCard {...BASE} trend="down" sentiment="neutral" />);
    expect(screen.getByText('+3 dias')).toHaveClass('text-text-2');
  });

  it('asks about the indicator', async () => {
    const onAsk = vi.fn();
    const user = userEvent.setup();
    render(<KpiCard {...BASE} trend="flat" sentiment="neutral" onAsk={onAsk} />);

    await user.click(screen.getByRole('button', { name: 'Perguntar sobre isto: Giro de estoque' }));

    expect(onAsk).toHaveBeenCalledOnce();
  });

  it('draws no sparkline without at least two values', () => {
    const { container } = render(
      <KpiCard {...BASE} spark={[36]} trend="flat" sentiment="neutral" />,
    );

    expect(container.querySelector('svg[viewBox="0 0 80 28"]')).toBeNull();
  });
});
