import { expect, test } from '@playwright/test';
import { useFakeBackend, type StreamEvent } from './fake-backend';

const BELOW_MINIMUM: StreamEvent[] = [
  {
    event: 'sql',
    data: {
      sql: 'SELECT p.name AS material, s.quantity AS saldo, s.minimum_quantity AS minimo FROM stock_levels s JOIN products p ON p.id = s.product_id WHERE s.quantity < s.minimum_quantity',
      attempt: 1,
    },
  },
  {
    event: 'rows',
    data: {
      result: {
        columns: [
          { name: 'material', type: 'text' },
          { name: 'saldo', type: 'int8' },
          { name: 'minimo', type: 'int8' },
        ],
        rows: [
          ['Vergalhão CA-50 10 mm', '120', '400'],
          ['Cimento CP-II-E-32 50 kg', '310', '900'],
        ],
        rowCount: 2,
        truncated: false,
        durationMs: 18,
      },
      visualization: { type: 'table' },
    },
  },
  { event: 'token', data: { text: 'Dois materiais estão abaixo do mínimo.' } },
  {
    event: 'done',
    data: {
      messageId: '2',
      status: 'answered',
      attempts: 1,
      usage: { inputTokens: 900, outputTokens: 120, calls: 2 },
    },
  },
];

test('opens on the dashboard, with indicators, charts and tables', async ({ page }) => {
  await useFakeBackend(page);
  await page.goto('/');

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Operações e vendas' })).toBeVisible();

  const indicators = page.getByRole('region', { name: 'Indicadores' });
  await expect(indicators.getByRole('article')).toHaveCount(6);
  await expect(indicators).toContainText('R$ 43,8 mi');
  await expect(indicators).toContainText('92,4%');

  await expect(page.getByRole('figure', { name: /Faturamento diário do período/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Faturamento por região' })).toContainText(
    'Sudeste',
  );
  await expect(page.getByRole('region', { name: 'Curva ABC dos materiais' })).toContainText(
    'Classe A',
  );
  await expect(
    page.getByRole('region', { name: 'Alertas de ruptura' }).getByRole('row'),
  ).toHaveCount(3);
  await expect(
    page.getByRole('region', { name: 'Últimas movimentações de estoque' }),
  ).toContainText('CD Campinas → CD Curitiba');
});

test('sends the period and the filters chosen to the API', async ({ page }) => {
  const backend = await useFakeBackend(page);
  await page.goto('/dashboard');
  await page.getByRole('region', { name: 'Indicadores' }).waitFor();

  await page.getByRole('button', { name: 'Trimestre' }).click();
  await page.getByRole('button', { name: /Região/ }).click();
  await page.getByRole('option', { name: 'Sul' }).click();

  await expect
    .poll(() => backend.dashboardRequests)
    .toContain('overview?period=quarter&regionId=2');
  await expect.poll(() => backend.dashboardRequests).toContain('stock-alerts?regionId=2');

  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByRole('button', { name: 'Limpar filtros' })).toHaveCount(0);
});

test('takes a question about a card to the floating chat, written but not sent', async ({
  page,
}) => {
  const backend = await useFakeBackend(page);
  await page.goto('/dashboard');

  await page.getByRole('button', { name: 'Perguntar sobre isto: Alertas de ruptura' }).click();

  const chat = page.getByRole('dialog', { name: 'Converse com seus dados' });
  await expect(chat.getByText('Contexto: Alertas de ruptura')).toBeVisible();
  await expect(chat.getByRole('textbox', { name: /^Pergunta/ })).toHaveValue(
    'Quais materiais estão abaixo do estoque mínimo?',
  );
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(backend.questions).toEqual([]);
});

test('asks about a card in the floating chat and opens the conversation in full screen', async ({
  page,
}) => {
  const backend = await useFakeBackend(page, { answers: [BELOW_MINIMUM] });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Perguntar sobre isto: Alertas de ruptura' }).click();
  const chat = page.getByRole('dialog', { name: 'Converse com seus dados' });

  await chat.getByRole('button', { name: 'Enviar' }).click();

  const answer = chat.getByRole('article', { name: 'Resposta' });
  await expect(answer.getByText('Dois materiais estão abaixo do mínimo.')).toBeVisible();
  await expect(answer.getByRole('table')).toContainText('Vergalhão CA-50 10 mm');
  expect(backend.questions).toEqual([
    'Quais materiais estão abaixo do estoque mínimo? (Contexto: Alertas de ruptura)',
  ]);
  // The window stays whole on screen, whatever the answer holds.
  await expect(chat).toBeInViewport({ ratio: 1 });

  await chat.getByRole('button', { name: 'Minimizar' }).click();
  await expect(answer).toBeHidden();
  await chat.getByRole('button', { name: 'Restaurar' }).click();
  await expect(answer.getByText('Dois materiais estão abaixo do mínimo.')).toBeVisible();

  await chat.getByRole('button', { name: 'Tela cheia' }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(chat).toHaveCount(0);
  await expect(
    page.getByRole('heading', {
      name: 'Quais materiais estão abaixo do estoque mínimo? (Contexto: Alertas de ruptura)',
    }),
  ).toBeVisible();
});

test('keeps the filters in view while the page scrolls', async ({ page }) => {
  await useFakeBackend(page);
  await page.setViewportSize({ width: 834, height: 600 });
  await page.goto('/dashboard');
  await page.getByRole('region', { name: 'Indicadores' }).waitFor();

  await page
    .getByRole('region', { name: 'Últimas movimentações de estoque' })
    .scrollIntoViewIfNeeded();

  await expect(page.getByRole('search', { name: 'Filtros do dashboard' })).toBeInViewport();
});

test('hides the amounts in reais with the eye and keeps them hidden after a reload', async ({
  page,
}) => {
  await useFakeBackend(page);
  await page.goto('/dashboard');
  const indicators = page.getByRole('region', { name: 'Indicadores' });
  await expect(indicators).toContainText('R$ 43,8 mi');

  await page.getByRole('button', { name: 'Ocultar valores em reais' }).click();

  await expect(indicators).toContainText('R$ ••••');
  await expect(indicators).not.toContainText(/R\$\s\d/);
  await expect(indicators).toContainText('92,4%');

  await page.reload();

  await expect(page.getByRole('region', { name: 'Indicadores' })).toContainText('R$ ••••');
  await expect(page.getByRole('button', { name: 'Ocultar valores em reais' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
