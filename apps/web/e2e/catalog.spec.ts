import { expect, test } from '@playwright/test';
import { useFakeBackend } from './fake-backend';

test('does not offer the registry to a user who may not use it', async ({ page }) => {
  await useFakeBackend(page);
  await page.goto('/dashboard');
  await page.getByRole('region', { name: 'Indicadores' }).waitFor();

  await expect(page.getByRole('link', { name: 'Cadastro' })).toHaveCount(0);

  await page.goto('/cadastro');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('an administrator creates a product and sees it in the list', async ({ page }) => {
  const backend = await useFakeBackend(page, { admin: true });
  await page.goto('/dashboard');

  await page.getByRole('link', { name: 'Cadastro' }).click();
  await expect(page.getByRole('heading', { name: 'Cadastro' })).toBeVisible();
  const list = page.getByRole('region', { name: 'Materiais' });
  await expect(list.getByRole('row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Novo material' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo material' });
  await dialog.getByLabel('SKU').fill('cab-25');
  await dialog.getByLabel('Nome').fill('Cabo flexível 2,5 mm 100 m');
  await dialog.getByLabel('Categoria').selectOption('Aço e metais');
  await dialog.getByLabel('Unidade').selectOption('rl');
  await dialog.getByLabel('Preço de venda (R$)').fill('265,50');
  await dialog.getByLabel('Custo (R$)').fill('180');
  await dialog.getByRole('button', { name: 'Salvar' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(list.getByRole('row')).toHaveCount(3);
  await expect(list).toContainText('CAB-25');
  expect(backend.catalogWrites).toEqual([
    {
      method: 'POST',
      path: 'products',
      body: {
        sku: 'cab-25',
        name: 'Cabo flexível 2,5 mm 100 m',
        category: 'Aço e metais',
        unit: 'rl',
        price: 265.5,
        cost: 180,
      },
    },
  ]);
});

test('an administrator records a stock movement', async ({ page }) => {
  const backend = await useFakeBackend(page, { admin: true });
  await page.goto('/cadastro');

  await page.getByRole('tab', { name: 'Movimentações' }).click();
  const form = page.getByRole('form', { name: 'Lançar movimentação' });
  await form.getByLabel('Tipo').selectOption('outbound');
  await form.getByLabel('Material').fill('cim');
  await page
    .getByRole('list', { name: 'Materiais encontrados' })
    .getByRole('button', { name: /Cimento CP-II-E-32 50 kg/ })
    .click();
  await form.getByLabel('Centro de distribuição').selectOption('1');
  await form.getByLabel('Quantidade (sc)').fill('50');
  await form.getByLabel('Documento ou motivo').fill('Pedido 77');
  await form.getByRole('button', { name: 'Lançar movimentação' }).click();

  await expect(page.getByRole('alert')).toContainText('Saldo em CD Campinas: 2.950 sc.');
  await expect(page.getByRole('table')).toContainText('Pedido 77');
  expect(backend.catalogWrites).toEqual([
    {
      method: 'POST',
      path: 'stock-movements',
      body: {
        type: 'outbound',
        productId: '1',
        distributionCenterId: '1',
        quantity: 50,
        document: 'Pedido 77',
      },
    },
  ]);
});
