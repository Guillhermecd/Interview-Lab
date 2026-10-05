import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { stubCatalog } from './test/catalog-fixtures';
import { stubDashboard } from './test/dashboard-fixtures';
import { FakeApi, jsonResponse, TEST_ADMIN, TEST_USER } from './test/fake-api';

const UNAUTHORIZED = { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' };
const USAGE = {
  today: { inputTokens: 1200, outputTokens: 300, calls: 4 },
  dailyTokenQuota: 200_000,
  questionsPerMinute: 10,
  byConversation: [],
};

let api: FakeApi;

beforeEach(() => {
  api = new FakeApi();
  vi.stubGlobal('fetch', api.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

// The screens are loaded on demand; loading them once here keeps that first
// load out of the time each test waits for the screen.
beforeAll(async () => {
  await Promise.all([
    import('./pages/DashboardPage'),
    import('./pages/ChatPage'),
    import('./pages/CatalogPage'),
  ]);
});

function signedIn() {
  stubDashboard(api)
    .on('GET /api/auth/me', () => jsonResponse(TEST_USER))
    .on('GET /api/conversations', () => jsonResponse({ items: [] }))
    .on('GET /api/usage', () => jsonResponse(USAGE));
}

function renderApp(path = '/chat') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App session', () => {
  it('shows the login form when there is no session', async () => {
    api.on('GET /api/auth/me', () => jsonResponse(UNAUTHORIZED, 401));

    renderApp();

    expect(await screen.findByRole('form', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('opens the dashboard with a valid session, showing the user in the top bar', async () => {
    signedIn();

    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Operações e vendas' })).toBeInTheDocument();
    const topBar = screen.getByRole('banner');
    expect(within(topBar).getByText('Ana')).toBeInTheDocument();
    expect(within(topBar).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('sends an unknown address to the dashboard', async () => {
    signedIn();

    renderApp('/nao-existe');

    expect(await screen.findByRole('heading', { name: 'Operações e vendas' })).toBeInTheDocument();
  });

  it('opens the chat by its address, with the usage of the day', async () => {
    signedIn();

    renderApp('/chat');

    const sidebar = await screen.findByRole('complementary');
    expect(
      await within(sidebar).findByText('Uso hoje: 1.500 de 200.000 tokens'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Converse com seus dados' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('goes from the dashboard to the chat and back through the top bar', async () => {
    signedIn();
    const user = userEvent.setup();
    renderApp('/dashboard');
    await screen.findByRole('heading', { name: 'Operações e vendas' });

    await user.click(screen.getByRole('link', { name: 'Converse com seus dados' }));
    expect(
      await screen.findByRole('heading', { name: 'Pergunte em português' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Operações e vendas' })).toBeInTheDocument();
  });

  it('offers the registry only to who the server says may use it', async () => {
    signedIn();

    renderApp('/dashboard');

    const topBar = await screen.findByRole('banner');
    await screen.findByRole('heading', { name: 'Operações e vendas' });
    expect(within(topBar).queryByRole('link', { name: 'Cadastro' })).not.toBeInTheDocument();
  });

  it('sends who may not use the registry back to the dashboard', async () => {
    signedIn();

    renderApp('/cadastro');

    expect(await screen.findByRole('heading', { name: 'Operações e vendas' })).toBeInTheDocument();
    expect(api.calls.some((call) => call.key.includes('/api/catalog'))).toBe(false);
  });

  it('opens the registry for an administrator', async () => {
    signedIn();
    stubCatalog(api).on('GET /api/auth/me', () => jsonResponse(TEST_ADMIN));
    const user = userEvent.setup();
    renderApp('/dashboard');

    await user.click(await screen.findByRole('link', { name: 'Cadastro' }));

    expect(await screen.findByRole('heading', { name: 'Cadastro' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Materiais' })).toBeInTheDocument();
  });

  it('switches the theme from the top bar', async () => {
    signedIn();
    const user = userEvent.setup();
    renderApp('/dashboard');
    const toggle = await screen.findByRole('button', { name: 'Usar tema escuro' });

    await user.click(toggle);

    expect(document.documentElement).toHaveClass('dark');
    expect(screen.getByRole('button', { name: 'Usar tema claro' })).toBeInTheDocument();
  });

  it('signs in and opens the chat', async () => {
    let session = false;
    api
      .on('GET /api/auth/me', () =>
        session ? jsonResponse(TEST_USER) : jsonResponse(UNAUTHORIZED, 401),
      )
      .on('POST /api/auth/login', () => {
        session = true;
        return jsonResponse(TEST_USER);
      })
      .on('GET /api/conversations', () => jsonResponse({ items: [] }))
      .on('GET /api/usage', () => jsonResponse(USAGE));
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('form', { name: 'Entrar' });

    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.type(screen.getByLabelText('Senha'), 'senha-segura-1');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(
      await screen.findByRole('heading', { name: 'Pergunte em português' }),
    ).toBeInTheDocument();
    expect(api.calls.find((call) => call.key === 'POST /api/auth/login')?.body).toEqual({
      email: 'ana@example.com',
      password: 'senha-segura-1',
    });
  });

  it('shows the reason when the credentials are wrong', async () => {
    api
      .on('GET /api/auth/me', () => jsonResponse(UNAUTHORIZED, 401))
      .on('POST /api/auth/login', () =>
        jsonResponse({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos.' }, 401),
      );
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('form', { name: 'Entrar' });

    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.type(screen.getByLabelText('Senha'), 'errada-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');
    expect(screen.getByRole('form', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('creates an account, showing field errors from the server', async () => {
    api
      .on('GET /api/auth/me', () => jsonResponse(UNAUTHORIZED, 401))
      .on('POST /api/auth/register', () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Um ou mais campos são inválidos.',
            details: [{ field: 'password', message: 'A senha deve ter entre 8 e 128 caracteres.' }],
          },
          400,
        ),
      );
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('form', { name: 'Entrar' });

    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    await user.type(screen.getByLabelText('Nome'), 'Ana');
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.type(screen.getByLabelText('Senha'), '12345678');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(
      await screen.findByText('A senha deve ter entre 8 e 128 caracteres.'),
    ).toBeInTheDocument();
    expect(api.calls.find((call) => call.key === 'POST /api/auth/register')?.body).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      password: '12345678',
    });
  });

  it('logs out and goes back to the login form', async () => {
    signedIn();
    api.on('POST /api/auth/logout', () => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('form', { name: 'Entrar' })).toBeInTheDocument();
    expect(api.calls.some((call) => call.key === 'POST /api/auth/logout')).toBe(true);
  });

  it('goes back to the login form when the session expires', async () => {
    signedIn();
    api.on('POST /api/conversations', () => jsonResponse(UNAUTHORIZED, 401));
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: 'Pergunte em português' });

    await user.type(screen.getByLabelText('Pergunta'), 'Quantas regiões?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('form', { name: 'Entrar' })).toBeInTheDocument();
  });
});
