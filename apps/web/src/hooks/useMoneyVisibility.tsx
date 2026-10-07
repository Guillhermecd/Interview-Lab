import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { HIDDEN_MONEY, VISIBLE_MONEY, type MoneyFormat } from '../utils/format';

const STORAGE_KEY = 'interview-lab:hide-money';

interface MoneyVisibility {
  money: MoneyFormat;
  toggleMoney: () => void;
}

// Outside the provider (a screen rendered alone) amounts are simply shown.
const MoneyVisibilityContext = createContext<MoneyVisibility>({
  money: VISIBLE_MONEY,
  toggleMoney: () => undefined,
});

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return false;
  }
}

// "Hide the amounts in reais" (D-62): shown by default, remembered in the
// browser, the same for every screen.
export function MoneyVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(readStored);

  const toggleMoney = useCallback(() => {
    setHidden((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // The preference simply is not remembered.
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ money: hidden ? HIDDEN_MONEY : VISIBLE_MONEY, toggleMoney }),
    [hidden, toggleMoney],
  );

  return <MoneyVisibilityContext value={value}>{children}</MoneyVisibilityContext>;
}

export function useMoneyVisibility(): MoneyVisibility {
  return useContext(MoneyVisibilityContext);
}

// How a screen writes amounts in reais right now.
export function useMoney(): MoneyFormat {
  return useContext(MoneyVisibilityContext).money;
}
