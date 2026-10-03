import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { FakeApi, jsonResponse, TEST_USER } from './test/fake-api';

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
});

function signedIn() {
  api
    .on('GET /api/auth/me', () => jsonResponse(TEST_USER))
    .on('GET /api/conversations', () => jsonResponse({ items: [] }))
    .on('GET /api/usage', () => jsonResponse(USAGE));
}

describe('App session', () => {
  it('shows the login form when there is no session', async () => {
    api.on('GET /api/auth/me', () => jsonResponse(UNAUTHORIZED, 401));

    render(<App />);

    expect(await screen.findByRole('form', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('goes straight to the chat with a valid session, showing the user and usage', async () => {
    signedIn();

    render(<App />);

    const sidebar = await screen.findByRole('complementary');
    expect(await within(sidebar).findByText('Ana')).toBeInTheDocument();
    expect(
      await within(sidebar).findByText('Uso hoje: 1.500 de 200.000 tokens'),
    ).toBeInTheDocument();
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
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('form', { name: 'Entrar' })).toBeInTheDocument();
    expect(api.calls.some((call) => call.key === 'POST /api/auth/logout')).toBe(true);
  });

  it('goes back to the login form when the session expires', async () => {
    signedIn();
    api.on('POST /api/conversations', () => jsonResponse(UNAUTHORIZED, 401));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Pergunte em português' });

    await user.type(screen.getByLabelText('Pergunta'), 'Quantas regiões?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('form', { name: 'Entrar' })).toBeInTheDocument();
  });
});
