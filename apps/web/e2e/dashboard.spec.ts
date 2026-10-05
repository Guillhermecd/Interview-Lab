import { expect, test } from '@playwright/test';
import { useFakeBackend } from './fake-backend';

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

test('takes a question about a card to the chat, written but not sent', async ({ page }) => {
  const backend = await useFakeBackend(page);
  await page.goto('/dashboard');

  await page.getByRole('button', { name: 'Perguntar sobre isto: Alertas de ruptura' }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByLabel('Pergunta')).toHaveValue(
    'Quais materiais estão abaixo do estoque mínimo? (Contexto: Alertas de ruptura)',
  );
  expect(backend.questions).toEqual([]);
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
