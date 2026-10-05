import { expect, test } from '@playwright/test';
import { useFakeBackend, type StreamEvent } from './fake-backend';

const GENERATED_SQL = 'SELECT name AS regiao FROM regions ORDER BY name';
const EDITED_CONDITION = " WHERE name LIKE 'N%'";

const REVIEW: StreamEvent[] = [
  { event: 'sql', data: { sql: GENERATED_SQL, attempt: 1 } },
  { event: 'review', data: { messageId: '2', sql: GENERATED_SQL } },
];

const EXECUTION: StreamEvent[] = [
  {
    event: 'rows',
    data: {
      result: {
        columns: [{ name: 'regiao', type: 'text' }],
        rows: [['Nordeste'], ['Norte']],
        rowCount: 2,
        truncated: false,
        durationMs: 8,
      },
      visualization: { type: 'table' },
    },
  },
  { event: 'token', data: { text: 'Duas regiões começam com N.' } },
  {
    event: 'done',
    data: {
      messageId: '2',
      status: 'answered',
      attempts: 1,
      usage: { inputTokens: 300, outputTokens: 30, calls: 1 },
      edited: true,
    },
  },
];

test('reviews, edits and runs the SQL before executing', async ({ page }) => {
  const backend = await useFakeBackend(page, { answers: [REVIEW], executions: [EXECUTION] });
  await page.goto('/chat');

  await page.getByRole('switch', { name: 'Revisar SQL antes de executar' }).click();
  await page.getByLabel('Pergunta').fill('Quais regiões começam com N?');
  await page.getByRole('button', { name: 'Enviar' }).click();

  const review = page.getByRole('region', { name: 'Revisão do SQL' });
  await expect(review.getByLabel('SQL gerado')).toContainText(GENERATED_SQL);
  expect(backend.modes).toEqual(['review']);
  expect(backend.executedSql).toEqual([]);

  // Edits the SQL in the editor: goes to the end of "FROM regions" and adds a filter.
  await review.getByRole('button', { name: 'Editar' }).click();
  const editor = page.getByRole('textbox', { name: 'SQL para revisar' });
  await editor.click();
  await page.keyboard.press('Control+End');
  for (let index = 0; index < ' ORDER BY name'.length; index += 1) {
    await page.keyboard.press('ArrowLeft');
  }
  await page.keyboard.type(EDITED_CONDITION);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(review.getByText('Editado por você')).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar e executar' }).click();

  await expect(page.getByText('Duas regiões começam com N.')).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Nordeste');
  await expect(page.getByText('Editado por você')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Revisão do SQL' })).toHaveCount(0);
  expect(backend.executedSql).toEqual([
    `SELECT name AS regiao FROM regions${EDITED_CONDITION} ORDER BY name`,
  ]);
});

test('shows the reason and keeps the review open when the edited SQL is refused', async ({
  page,
}) => {
  const backend = await useFakeBackend(page, {
    answers: [REVIEW],
    executions: [
      [
        {
          event: 'error',
          data: {
            code: 'QUERY_REJECTED',
            message: 'A consulta foi recusada pelas regras de segurança.',
            details: [{ field: 'sql', message: 'Apenas consultas SELECT são permitidas.' }],
          },
        },
      ],
    ],
  });
  await page.goto('/chat');
  await page.getByRole('switch', { name: 'Revisar SQL antes de executar' }).click();
  await page.getByLabel('Pergunta').fill('Quais regiões?');
  await page.getByRole('button', { name: 'Enviar' }).click();

  const review = page.getByRole('region', { name: 'Revisão do SQL' });
  await expect(review.getByLabel('SQL gerado')).toContainText(GENERATED_SQL);
  await review.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('textbox', { name: 'SQL para revisar' }).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('DELETE FROM regions');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await page.getByRole('button', { name: 'Aprovar e executar' }).click();

  await expect(page.getByRole('alert')).toContainText('Apenas consultas SELECT são permitidas.');
  await expect(review).toBeVisible();
  expect(backend.executedSql).toEqual(['DELETE FROM regions']);
  // The refused SQL cannot be sent again as it is.
  await expect(review.getByText('Bloqueado')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar e executar' })).toBeDisabled();

  await page.getByRole('button', { name: 'Desfazer edição' }).click();
  await expect(review.getByLabel('SQL gerado')).toContainText(GENERATED_SQL);
  await expect(page.getByRole('button', { name: 'Aprovar e executar' })).toBeEnabled();
});
