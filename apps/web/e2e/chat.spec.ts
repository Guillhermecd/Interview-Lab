import { expect, test } from '@playwright/test';
import { useFakeBackend, type StreamEvent } from './fake-backend';

const REVENUE_BY_REGION: StreamEvent[] = [
  {
    event: 'sql',
    data: {
      sql: 'SELECT r.name AS regiao, sum(i.quantity * i.unit_price) AS faturamento FROM regions r JOIN customers c ON c.region_id = r.id JOIN orders o ON o.customer_id = c.id JOIN order_items i ON i.order_id = o.id GROUP BY r.name',
      attempt: 1,
    },
  },
  {
    event: 'rows',
    data: {
      result: {
        columns: [
          { name: 'regiao', type: 'text' },
          { name: 'faturamento', type: 'numeric' },
        ],
        rows: [
          ['Centro-Oeste', '2498013.89'],
          ['Sudeste', '2364390.62'],
          ['Norte', '2285335.43'],
          ['Nordeste', '2213967.02'],
          ['Sul', '2097461.75'],
        ],
        rowCount: 5,
        truncated: false,
        durationMs: 20,
      },
      visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'faturamento' },
    },
  },
  { event: 'token', data: { text: 'O Centro-Oeste liderou ' } },
  { event: 'token', data: { text: 'o faturamento no trimestre.' } },
  {
    event: 'done',
    data: {
      messageId: '2',
      status: 'answered',
      attempts: 1,
      usage: { inputTokens: 1441, outputTokens: 279, calls: 2 },
    },
  },
];

test('asks a question and sees SQL, chart, table and explanation', async ({ page }) => {
  const backend = await useFakeBackend(page, { answers: [REVENUE_BY_REGION] });
  await page.goto('/chat');
  await expect(page.getByText('Nenhuma conversa ainda.')).toBeVisible();

  await page.getByLabel('Pergunta').fill('Qual foi o faturamento por região no último trimestre?');
  await page.getByRole('button', { name: 'Enviar' }).click();

  const answer = page.getByRole('article', { name: 'Resposta' });
  await expect(
    answer.getByText('O Centro-Oeste liderou o faturamento no trimestre.'),
  ).toBeVisible();
  await expect(answer.getByLabel('SQL gerado')).toContainText('GROUP BY r.name');
  await expect(answer.getByRole('table')).toContainText('2.498.013,89');
  await expect(answer.getByRole('row')).toHaveCount(6);
  await expect(answer.getByText('1.720 tokens')).toBeVisible();

  await answer.getByRole('tab', { name: 'Gráfico' }).click();
  await expect(
    answer.getByRole('figure', { name: 'Gráfico de barras: faturamento por regiao' }),
  ).toBeVisible();
  await expect(answer.locator('.recharts-bar-rectangle')).toHaveCount(5);

  // The user can draw the same columns as a donut.
  await answer.getByRole('button', { name: 'Rosca' }).click();
  await expect(
    answer.getByRole('figure', { name: 'Gráfico de rosca: faturamento por regiao' }),
  ).toBeVisible();

  // The new conversation appears in the list, titled by the first question.
  await expect(
    page
      .getByRole('navigation', { name: 'Conversas' })
      .getByRole('button', { name: 'Qual foi o faturamento por região no último trimestre?' }),
  ).toBeVisible();
  expect(backend.questions).toEqual(['Qual foi o faturamento por região no último trimestre?']);
});

test('starts a question from an example and shows a refusal as an error', async ({ page }) => {
  await useFakeBackend(page, {
    answers: [
      [
        { event: 'sql', data: { sql: 'SELECT * FROM pg_authid', attempt: 1 } },
        { event: 'sql', data: { sql: 'SELECT * FROM pg_roles', attempt: 2 } },
        {
          event: 'error',
          data: {
            code: 'QUERY_REJECTED',
            message: 'A consulta foi recusada pelas regras de segurança.',
            details: [
              { field: 'sql', message: 'A tabela "pg_roles" não está disponível para consulta.' },
            ],
          },
        },
      ],
    ],
  });
  await page.goto('/chat');

  await page.getByRole('button', { name: 'Quais são os 5 produtos mais vendidos?' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('A consulta foi recusada pelas regras de segurança.');
  await expect(alert).toContainText('A tabela "pg_roles" não está disponível para consulta.');
  await expect(
    page.getByText('A primeira consulta foi recusada; abaixo, a segunda tentativa.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible();
});

test('opens a past conversation and continues it', async ({ page }) => {
  const conversationId = '00000000-0000-4000-8000-0000000000aa';
  const backend = await useFakeBackend(page, {
    conversations: [
      {
        id: conversationId,
        title: 'Quantas regiões existem?',
        createdAt: '2026-10-02T10:00:00.000Z',
        updatedAt: '2026-10-02T10:00:00.000Z',
      },
    ],
    history: {
      [conversationId]: [
        {
          id: '1',
          role: 'user',
          content: 'Quantas regiões existem?',
          createdAt: '2026-10-02T10:00:00.000Z',
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Existem 5 regiões.',
          status: 'answered',
          sql: 'SELECT count(*) AS regioes FROM regions',
          visualization: { type: 'table' },
          rowCount: 1,
          createdAt: '2026-10-02T10:00:01.000Z',
        },
      ],
    },
    answers: [
      [
        { event: 'token', data: { text: 'Não há dados de estoque nas tabelas disponíveis.' } },
        {
          event: 'done',
          data: {
            messageId: '4',
            status: 'not_answerable',
            attempts: 0,
            usage: { inputTokens: 900, outputTokens: 20, calls: 1 },
          },
        },
      ],
    ],
  });
  await page.goto('/chat');

  await page.getByRole('button', { name: 'Quantas regiões existem?' }).click();
  await expect(page.getByText('Existem 5 regiões.')).toBeVisible();
  await expect(page.getByText('As linhas não ficam salvas no histórico')).toBeVisible();

  await page.getByLabel('Pergunta').fill('E o estoque?');
  await page.getByLabel('Pergunta').press('Enter');

  await expect(page.getByText('Não há dados de estoque nas tabelas disponíveis.')).toBeVisible();
  expect(backend.questions).toEqual(['E o estoque?']);
});

test('shows the schema beside the conversation and marks the tables an answer read', async ({
  page,
}) => {
  const answer = REVENUE_BY_REGION.map((item) =>
    item.event === 'done'
      ? { ...item, data: { ...item.data, tables: ['regions', 'customers', 'orders'] } }
      : item,
  );
  await useFakeBackend(page, {
    conversations: [
      {
        id: '00000000-0000-4000-8000-0000000000bb',
        title: 'Apague as regiões',
        createdAt: '2026-10-02T10:00:00.000Z',
        updatedAt: '2026-10-02T10:00:00.000Z',
        attention: 'blocked',
      },
    ],
    answers: [answer],
  });
  await page.goto('/chat');

  // What the server flagged about a conversation shows in the list.
  const conversations = page.getByRole('navigation', { name: 'Conversas' });
  await expect(conversations.getByRole('listitem')).toContainText('Bloqueada');

  // Wide screen: the schema starts open.
  const schema = page.getByRole('complementary', { name: 'Schema' });
  await expect(schema.getByText('customers')).toBeVisible();
  await expect(schema.getByRole('img', { name: 'Usada na última consulta' })).toHaveCount(0);

  await schema.getByText('orders').click();
  await expect(schema.getByText('delivered_at')).toBeVisible();
  await expect(schema.getByText('timestamp with time zone')).toBeVisible();

  await page.getByLabel('Pergunta').fill('Qual foi o faturamento por região?');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('O Centro-Oeste liderou o faturamento no trimestre.')).toBeVisible();

  // The three tables of the fixture were all read by the answer.
  await expect(schema.getByRole('img', { name: 'Usada na última consulta' })).toHaveCount(3);

  await page.getByRole('button', { name: 'Schema' }).click();
  await expect(schema).toBeHidden();
});

test('switches between light and dark theme', async ({ page }) => {
  await useFakeBackend(page);
  await page.goto('/chat');
  const html = page.locator('html');
  const toggle = page.getByRole('button', { name: /Usar tema/ });

  const startsDark = await html.evaluate((element) => element.classList.contains('dark'));
  await toggle.click();

  await expect(html).toHaveClass(startsDark ? /^(?!.*dark)/ : /dark/);
});
