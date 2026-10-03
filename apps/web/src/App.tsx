import type { AuthUser } from '@interview-lab/shared';
import { useCallback, useEffect, useState } from 'react';
import { onUnauthorized } from './api/modules/api';
import { AuthService } from './api/modules/auth.service';
import { Spinner } from './components/ui/Spinner';
import { AuthPage } from './pages/AuthPage';
import { ChatPage } from './pages/ChatPage';

// undefined: still checking the session; null: signed out.
type Session = AuthUser | null | undefined;

export function App() {
  const [user, setUser] = useState<Session>(undefined);

  useEffect(() => {
    let active = true;
    AuthService.me()
      .then((current) => {
        if (active) {
          setUser(current);
        }
      })
      .catch(() => {
        if (active) {
          setUser(null);
        }
      });
    // Any 401 later on (expired session) brings the login screen back.
    onUnauthorized(() => {
      setUser(null);
    });
    return () => {
      active = false;
      onUnauthorized(undefined);
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await AuthService.logout();
    } finally {
      setUser(null);
    }
  }, []);

  if (user === undefined) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner label="Carregando…" />
      </main>
    );
  }
  if (user === null) {
    return <AuthPage onSignedIn={setUser} />;
  }
  // The key resets every screen state when another account signs in.
  return <ChatPage key={user.id} user={user} onLogout={() => void logout()} />;
}
