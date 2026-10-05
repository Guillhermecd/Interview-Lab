import type { AuthUser } from '@interview-lab/shared';
import { useState } from 'react';
import { toApiError } from '../../api/modules/api';
import { AuthService } from '../../api/modules/auth.service';
import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';

type Mode = 'login' | 'register';

interface AuthPageProps {
  onSignedIn: (user: AuthUser) => void;
}

interface FormError {
  message: string;
  // Messages per field, from the `details` of the standard error.
  fields: Record<string, string>;
}

const INPUT_CLASS =
  'h-8 w-full rounded-md border border-line-2 bg-surface px-3 text-[13px] focus:border-accent focus:outline-2 focus:outline-offset-[-1px] focus:outline-accent';

export function AuthPage({ onSignedIn }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError>();
  const [sending, setSending] = useState(false);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setSending(true);
    setError(undefined);
    try {
      const user =
        mode === 'login'
          ? await AuthService.login({ email, password })
          : await AuthService.register({ name, email, password });
      onSignedIn(user);
    } catch (caught) {
      const apiError = toApiError(caught);
      setError({
        message: apiError.message,
        fields: Object.fromEntries(
          (apiError.details ?? []).map((detail) => [detail.field, detail.message]),
        ),
      });
    } finally {
      setSending(false);
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(undefined);
  }

  const title = mode === 'login' ? 'Entrar' : 'Criar conta';

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        aria-label={title}
        className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface p-6"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Converse com seus dados</h1>
          <h2 className="text-sm text-text-2">{title}</h2>
        </div>

        {error && Object.keys(error.fields).length === 0 && (
          <ErrorMessage message={error.message} />
        )}

        {mode === 'register' && (
          <label className="block space-y-1 text-sm">
            <span>Nome</span>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              autoComplete="name"
              required
              maxLength={100}
              className={INPUT_CLASS}
            />
            {error?.fields.name && <span className="text-crit">{error.fields.name}</span>}
          </label>
        )}

        <label className="block space-y-1 text-sm">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            autoComplete="email"
            required
            className={INPUT_CLASS}
          />
          {error?.fields.email && <span className="text-crit">{error.fields.email}</span>}
        </label>

        <label className="block space-y-1 text-sm">
          <span>Senha</span>
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : undefined}
            className={INPUT_CLASS}
          />
          {error?.fields.password && <span className="text-crit">{error.fields.password}</span>}
        </label>

        <Button type="submit" disabled={sending} className="w-full">
          {title}
        </Button>

        <p className="text-center text-sm text-text-2">
          {mode === 'login' ? 'Ainda não tem conta?' : 'Já tem conta?'}{' '}
          <button type="button" onClick={switchMode} className="text-accent-text underline">
            {mode === 'login' ? 'Criar conta' : 'Entrar'}
          </button>
        </p>
      </form>
    </main>
  );
}
