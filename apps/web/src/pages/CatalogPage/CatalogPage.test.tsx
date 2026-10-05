import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CEMENT,
  CEMENT_DETAIL,
  PRODUCT_PAGE,
  RECORDED_MOVEMENT,
  stubCatalog,
} from '../../test/catalog-fixtures';
import { FakeApi, jsonResponse } from '../../test/fake-api';
import { CatalogPage } from './CatalogPage';

let api: FakeApi;

beforeEach(() => {
  api = stubCatalog(new FakeApi());
  vi.stubGlobal('fetch', api.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function callsTo(prefix: string) {
  return api.calls.filter((call) => call.key.startsWith(prefix));
}

async function openProducts() {
  const user = userEvent.setup();
  render(<CatalogPage />);
  const section = await screen.findByRole('region', { name: 'Materiais' });
  await within(section).findByRole('table');
  return { user, section };
}

async function openMovements() {
  const user = userEvent.setup();
  render(<CatalogPage />);
  await user.click(await screen.findByRole('tab', { name: 'Movimentações' }));
  const form = await screen.findByRole('form', { name: 'Lançar movimentação' });
  return { user, form };
}

// Picks the product through the search of the picker.
async function pickCement(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Material'), 'cim');
  await user.click(
    await within(await screen.findByRole('list', { name: 'Materiais encontrados' })).findByRole(
      'button',
      { name: /Cimento CP-II-E-32 50 kg/ },
    ),
  );
}

describe('CatalogPage: products', () => {
  it('lists the products with their stock and status', async () => {
    const { section } = await openProducts();

    const rows = within(section).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('RM-0001');
    expect(rows[1]).toHaveTextContent('Cimento CP-II-E-32 50 kg');
    expect(rows[1]).toHaveTextContent('R$ 38,00');
    expect(rows[1]).toHaveTextContent('4.200 sc');
    expect(rows[1]).toHaveTextContent('Ativo');
    expect(rows[2]).toHaveTextContent('Arquivado');
    expect(section).toHaveTextContent('1–20 de 45 materiais');
  });

  it('asks the server for the active products of the first page by default', async () => {
    await openProducts();

    expect(callsTo('GET /api/catalog/products').map((call) => call.key)).toEqual([
      'GET /api/catalog/products?status=active&page=1&pageSize=20',
    ]);
  });

  it('sends the search, the filters and the page to the server', async () => {
    const { user, section } = await openProducts();

    await user.type(within(section).getByLabelText('Buscar'), 'cimento');
    await user.selectOptions(within(section).getByLabelText('Situação'), 'Todos');
    await user.selectOptions(within(section).getByLabelText('Categoria'), 'Aço e metais');

    await waitFor(() => {
      expect(callsTo('GET /api/catalog/products').at(-1)?.key).toBe(
        'GET /api/catalog/products?search=cimento&category=A%C3%A7o+e+metais&status=all&page=1&pageSize=20',
      );
    });

    await user.click(within(section).getByRole('button', { name: 'Próxima' }));
    await waitFor(() => {
      expect(callsTo('GET /api/catalog/products').at(-1)?.key).toContain('page=2');
    });
  });

  it('creates a product with what was typed and reloads the list', async () => {
    api.on('POST /api/catalog/products', () => jsonResponse({ ...CEMENT_DETAIL, id: '9' }, 201));
    const { user } = await openProducts();

    await user.click(screen.getByRole('button', { name: 'Novo material' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo material' });
    await user.type(within(dialog).getByLabelText('SKU'), 'cab-25');
    await user.type(within(dialog).getByLabelText('Nome'), 'Cabo flexível 2,5 mm');
    await user.selectOptions(within(dialog).getByLabelText('Categoria'), 'Aço e metais');
    await user.selectOptions(within(dialog).getByLabelText('Unidade'), 'Rolo (rl)');
    await user.type(within(dialog).getByLabelText('Preço de venda (R$)'), '265,50');
    await user.type(within(dialog).getByLabelText('Custo (R$)'), '180');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // The SKU goes as typed: the server is the one that normalises it.
    expect(callsTo('POST /api/catalog/products')[0]?.body).toEqual({
      sku: 'cab-25',
      name: 'Cabo flexível 2,5 mm',
      category: 'Aço e metais',
      unit: 'rl',
      price: 265.5,
      cost: 180,
    });
    await waitFor(() => {
      expect(callsTo('GET /api/catalog/products?')).toHaveLength(2);
    });
  });

  it('shows what the server refused under the field it is about', async () => {
    api.on('POST /api/catalog/products', () =>
      jsonResponse({ code: 'SKU_IN_USE', message: 'Já existe um material com este SKU.' }, 409),
    );
    const { user } = await openProducts();
    await user.click(screen.getByRole('button', { name: 'Novo material' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo material' });
    await user.type(within(dialog).getByLabelText('SKU'), 'RM-0001');
    await user.type(within(dialog).getByLabelText('Nome'), 'Outro');
    await user.selectOptions(within(dialog).getByLabelText('Categoria'), 'Aço e metais');
    await user.selectOptions(within(dialog).getByLabelText('Unidade'), 'Rolo (rl)');
    await user.type(within(dialog).getByLabelText('Preço de venda (R$)'), '10');
    await user.type(within(dialog).getByLabelText('Custo (R$)'), '5');

    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    const sku = within(dialog).getByLabelText('SKU');
    await waitFor(() => {
      expect(sku).toHaveAccessibleDescription('Já existe um material com este SKU.');
    });
    expect(sku).toBeInvalid();
    expect(screen.getByRole('dialog', { name: 'Novo material' })).toBeInTheDocument();
  });

  it('shows the validation details of the server field by field', async () => {
    api.on('POST /api/catalog/products', () =>
      jsonResponse(
        {
          code: 'VALIDATION_ERROR',
          message: 'Um ou mais campos são inválidos.',
          details: [{ field: 'name', message: 'O nome deve ter entre 3 e 120 caracteres.' }],
        },
        400,
      ),
    );
    const { user } = await openProducts();
    await user.click(screen.getByRole('button', { name: 'Novo material' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo material' });
    await user.selectOptions(within(dialog).getByLabelText('Unidade'), 'Rolo (rl)');
    await user.type(within(dialog).getByLabelText('Preço de venda (R$)'), '10');
    await user.type(within(dialog).getByLabelText('Custo (R$)'), '5');

    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText('Nome')).toHaveAccessibleDescription(
        'O nome deve ter entre 3 e 120 caracteres.',
      );
    });
  });

  it('does not send a form without unit or values', async () => {
    const { user } = await openProducts();
    await user.click(screen.getByRole('button', { name: 'Novo material' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo material' });

    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(within(dialog).getByLabelText('Unidade')).toHaveAccessibleDescription(
      'Escolha a unidade.',
    );
    expect(callsTo('POST ')).toEqual([]);
  });

  it('edits a product starting from its current data', async () => {
    api.on('PUT /api/catalog/products/1', () => jsonResponse(CEMENT_DETAIL));
    const { user } = await openProducts();

    await user.click(screen.getByRole('button', { name: `Editar ${CEMENT.name}` }));
    const dialog = screen.getByRole('dialog', { name: 'Editar material' });
    expect(within(dialog).getByLabelText('SKU')).toHaveValue('RM-0001');
    expect(within(dialog).getByLabelText('Custo (R$)')).toHaveValue('25.5');
    await user.clear(within(dialog).getByLabelText('Preço de venda (R$)'));
    await user.type(within(dialog).getByLabelText('Preço de venda (R$)'), '39,9');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(callsTo('PUT /api/catalog/products/1')[0]?.body).toMatchObject({
        sku: 'RM-0001',
        price: 39.9,
        cost: 25.5,
      });
    });
  });

  it('archives only after confirmation', async () => {
    api.on('DELETE /api/catalog/products/1', () =>
      jsonResponse({ ...CEMENT_DETAIL, active: false }),
    );
    const { user } = await openProducts();

    await user.click(screen.getByRole('button', { name: `Arquivar ${CEMENT.name}` }));
    const dialog = screen.getByRole('dialog', { name: 'Arquivar material' });
    expect(dialog).toHaveTextContent('O histórico de pedidos e de estoque continua');
    expect(callsTo('DELETE ')).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(callsTo('DELETE ')).toEqual([]);

    await user.click(screen.getByRole('button', { name: `Arquivar ${CEMENT.name}` }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Arquivar material' })).getByRole('button', {
        name: 'Arquivar',
      }),
    );

    await waitFor(() => {
      expect(callsTo('DELETE /api/catalog/products/1')).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('restores an archived product', async () => {
    api.on('POST /api/catalog/products/2/restore', () => jsonResponse(CEMENT_DETAIL));
    const { user } = await openProducts();

    await user.click(screen.getByRole('button', { name: 'Restaurar Vergalhão antigo' }));

    await waitFor(() => {
      expect(callsTo('POST /api/catalog/products/2/restore')).toHaveLength(1);
    });
  });

  it('shows the stock per center and saves only the minimums that changed', async () => {
    api.on('PUT /api/catalog/products/1/stock-levels/2', () =>
      jsonResponse({ ...CEMENT_DETAIL.stockLevels[1], minimumQuantity: 300 }),
    );
    const { user } = await openProducts();

    await user.click(screen.getByRole('button', { name: `Estoque de ${CEMENT.name}` }));
    const dialog = await screen.findByRole('dialog', { name: `Estoque · ${CEMENT.name}` });
    const curitiba = await within(dialog).findByLabelText('Estoque mínimo em CD Curitiba');
    expect(within(dialog).getByLabelText('Estoque mínimo em CD Campinas')).toHaveValue('800');
    expect(dialog).toHaveTextContent('3.000');
    expect(within(dialog).getByRole('button', { name: 'Salvar mínimos' })).toBeDisabled();

    await user.clear(curitiba);
    await user.type(curitiba, '300');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar mínimos' }));

    await waitFor(() => {
      expect(callsTo('PUT ').map((call) => [call.key, call.body])).toEqual([
        ['PUT /api/catalog/products/1/stock-levels/2', { minimumQuantity: 300 }],
      ]);
    });
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Salvar mínimos' })).toBeDisabled();
    });
    expect(curitiba).toHaveValue('300');
  });

  it('closes a dialog with Escape', async () => {
    const { user } = await openProducts();
    await user.click(screen.getByRole('button', { name: 'Novo material' }));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says so when no product matches', async () => {
    api.on('GET /api/catalog/products', () =>
      jsonResponse({ ...PRODUCT_PAGE, items: [], total: 0 }),
    );

    const { section } = await openProducts();

    expect(section).toHaveTextContent('Nenhum material para os filtros escolhidos.');
    expect(section).toHaveTextContent('0–0 de 0 materiais');
  });
});

describe('CatalogPage: movements', () => {
  it('lists the latest movements', async () => {
    await openMovements();

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(table).toHaveTextContent('CD Campinas → CD Curitiba');
  });

  it('records a movement and shows the balance the server answered', async () => {
    api.on('POST /api/catalog/stock-movements', () => jsonResponse(RECORDED_MOVEMENT, 201));
    const { user, form } = await openMovements();

    await user.selectOptions(within(form).getByLabelText('Tipo'), 'Saída');
    await pickCement(user);
    await user.selectOptions(within(form).getByLabelText('Centro de distribuição'), 'CD Campinas');
    await user.type(within(form).getByLabelText('Quantidade (sc)'), '50');
    await user.type(within(form).getByLabelText('Documento ou motivo'), 'Pedido 77');
    await user.click(within(form).getByRole('button', { name: 'Lançar movimentação' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Movimentação registrada');
    expect(alert).toHaveTextContent('Saldo em CD Campinas: 2.950 sc.');
    // Only what the user chose is sent: no date, no responsible, no balance.
    expect(callsTo('POST /api/catalog/stock-movements')[0]?.body).toEqual({
      type: 'outbound',
      productId: '1',
      distributionCenterId: '1',
      quantity: 50,
      document: 'Pedido 77',
    });
    expect(within(form).getByLabelText('Quantidade (sc)')).toHaveValue('');
    await waitFor(() => {
      expect(callsTo('GET /api/catalog/stock-movements')).toHaveLength(2);
    });
  });

  it('asks for the destination only in a transfer, and sends it', async () => {
    api.on('POST /api/catalog/stock-movements', () => jsonResponse(RECORDED_MOVEMENT, 201));
    const { user, form } = await openMovements();
    expect(within(form).queryByLabelText('Centro de destino')).not.toBeInTheDocument();

    await user.selectOptions(within(form).getByLabelText('Tipo'), 'Transferência');
    await pickCement(user);
    await user.selectOptions(within(form).getByLabelText('Centro de origem'), 'CD Campinas');
    await user.selectOptions(within(form).getByLabelText('Centro de destino'), 'CD Curitiba');
    await user.type(within(form).getByLabelText('Quantidade (sc)'), '20');
    await user.type(within(form).getByLabelText('Documento ou motivo'), 'TRF 1');
    await user.click(within(form).getByRole('button', { name: 'Lançar movimentação' }));

    await waitFor(() => {
      expect(callsTo('POST /api/catalog/stock-movements')[0]?.body).toEqual({
        type: 'transfer',
        productId: '1',
        distributionCenterId: '1',
        destinationCenterId: '2',
        quantity: 20,
        document: 'TRF 1',
      });
    });
  });

  it('sends a negative adjustment as typed', async () => {
    api.on('POST /api/catalog/stock-movements', () => jsonResponse(RECORDED_MOVEMENT, 201));
    const { user, form } = await openMovements();

    await user.selectOptions(within(form).getByLabelText('Tipo'), 'Ajuste');
    await pickCement(user);
    await user.selectOptions(within(form).getByLabelText('Centro de distribuição'), 'CD Campinas');
    await user.type(within(form).getByLabelText('Quantidade (sc)'), '-12');
    await user.type(within(form).getByLabelText('Documento ou motivo'), 'Avaria');
    await user.click(within(form).getByRole('button', { name: 'Lançar movimentação' }));

    await waitFor(() => {
      expect(callsTo('POST /api/catalog/stock-movements')[0]?.body).toMatchObject({
        type: 'adjustment',
        quantity: -12,
      });
    });
  });

  it('shows the refusal of the server next to the quantity, keeping what was typed', async () => {
    api.on('POST /api/catalog/stock-movements', () =>
      jsonResponse(
        {
          code: 'INSUFFICIENT_STOCK',
          message: 'O estoque do centro de distribuição é menor que a quantidade informada.',
        },
        409,
      ),
    );
    const { user, form } = await openMovements();
    await user.selectOptions(within(form).getByLabelText('Tipo'), 'Saída');
    await pickCement(user);
    await user.selectOptions(within(form).getByLabelText('Centro de distribuição'), 'CD Campinas');
    await user.type(within(form).getByLabelText('Quantidade (sc)'), '99999');
    await user.type(within(form).getByLabelText('Documento ou motivo'), 'Pedido 1');

    await user.click(within(form).getByRole('button', { name: 'Lançar movimentação' }));

    const quantity = within(form).getByLabelText('Quantidade (sc)');
    await waitFor(() => {
      expect(quantity).toHaveAccessibleDescription(
        'O estoque do centro de distribuição é menor que a quantidade informada.',
      );
    });
    expect(quantity).toHaveValue('99999');
    expect(screen.queryByText('Movimentação registrada')).not.toBeInTheDocument();
  });

  it('does not send a movement without product or quantity', async () => {
    const { user, form } = await openMovements();

    await user.click(within(form).getByRole('button', { name: 'Lançar movimentação' }));

    expect(within(form).getByText('Escolha o material.')).toBeInTheDocument();
    expect(within(form).getByLabelText('Quantidade')).toHaveAccessibleDescription(
      'Informe a quantidade.',
    );
    expect(callsTo('POST ')).toEqual([]);
  });

  it('searches active products for the picker and lets the choice be changed', async () => {
    const { user, form } = await openMovements();

    await pickCement(user);

    expect(callsTo('GET /api/catalog/products?').at(-1)?.key).toBe(
      'GET /api/catalog/products?search=cim&status=active&pageSize=8',
    );
    expect(form).toHaveTextContent('RM-0001');
    await user.click(within(form).getByRole('button', { name: 'Trocar' }));
    expect(within(form).getByLabelText('Material')).toHaveValue('');
  });
});
