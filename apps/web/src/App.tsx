import type { AuthUser } from '@interview-lab/shared';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { onUnauthorized } from './api/modules/api';
import { AuthService } from './api/modules/auth.service';
import { FloatingChat } from './components/layout/FloatingChat';
import { TopBar } from './components/layout/TopBar';
import { Spinner } from './components/ui/Spinner';
import { FloatingChatProvider, useFloatingChat } from './hooks/useFloatingChat';
import { MoneyVisibilityProvider } from './hooks/useMoneyVisibility';
import { useTheme } from './hooks/useTheme';
import { AuthPage } from './pages/AuthPage';
import { CATALOG_PATH, CHAT_PATH, DASHBOARD_PATH, type ChatLocationState } from './routes';

// Each screen is its own bundle: the chat brings the SQL editor and the
// dashboard brings the charts, and neither is needed to show the other.
const ChatPage = lazy(() => import('./pages/ChatPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));

// undefined: still checking the session; null: signed out.
type Session = AuthUser | null | undefined;

function Loading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Spinner label="Carregando…" />
    </div>
  );
}

function ChatRoute() {
  const location = useLocation();
  const state = location.state as ChatLocationState | null;
  // The key makes a question or a conversation arriving from another screen
  // start a clean chat.
  return (
    <ChatPage
      key={`${state?.question ?? ''}|${state?.conversationId ?? ''}`}
      initialQuestion={state?.question}
      initialConversationId={state?.conversationId}
    />
  );
}

// The floating chat exists over the dashboard and the registry (D-63); the
// chat screen has no use for it. Leaving those screens closes the window.
function FloatingChatHost({ user }: { user: AuthUser }) {
  const { pathname } = useLocation();
  const { status, close } = useFloatingChat();
  const hosted =
    pathname === DASHBOARD_PATH || (pathname === CATALOG_PATH && user.canManageCatalog);

  useEffect(() => {
    if (!hosted && status !== 'closed') {
      close();
    }
  }, [hosted, status, close]);

  return hosted ? <FloatingChat /> : null;
}

export function App() {
  const [user, setUser] = useState<Session>(undefined);
  const { theme, toggleTheme } = useTheme();

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
  return (
    <MoneyVisibilityProvider>
      <FloatingChatProvider key={user.id}>
        <div className="flex h-dvh flex-col">
          <TopBar
            user={user}
            theme={theme}
            onToggleTheme={toggleTheme}
            onLogout={() => void logout()}
          />
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path={DASHBOARD_PATH} element={<DashboardPage />} />
              <Route path={CHAT_PATH} element={<ChatRoute />} />
              {/* Offered only to who the server says may use it; the API checks again. */}
              {user.canManageCatalog && <Route path={CATALOG_PATH} element={<CatalogPage />} />}
              <Route path="*" element={<Navigate to={DASHBOARD_PATH} replace />} />
            </Routes>
          </Suspense>
          <FloatingChatHost user={user} />
        </div>
      </FloatingChatProvider>
    </MoneyVisibilityProvider>
  );
}
