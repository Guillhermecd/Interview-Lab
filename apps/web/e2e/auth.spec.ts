import { expect, test } from '@playwright/test';
import { useFakeBackend } from './fake-backend';

test('signs in, sees the chat with the usage, and signs out', async ({ page }) => {
  const backend = await useFakeBackend(page, { signedOut: true });
  await page.goto('/chat');

  const form = page.getByRole('form', { name: 'Entrar' });
  await expect(form).toBeVisible();
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('senha-segura-1');
  await form.getByRole('button', { name: 'Entrar' }).click();

  await expect(
    page.getByRole('heading', { name: 'O que você quer saber sobre a operação?' }),
  ).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Tokens usados hoje' })).toBeVisible();
  await expect(page.getByText('1.500 / 200.000')).toBeVisible();
  expect(backend.logins).toEqual([{ email: 'ana@example.com', password: 'senha-segura-1' }]);

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('form', { name: 'Entrar' })).toBeVisible();
});
