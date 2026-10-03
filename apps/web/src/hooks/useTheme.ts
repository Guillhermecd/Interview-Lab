import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

// Own key, so the preference survives anything that clears other stored data.
const STORAGE_KEY = 'interview-lab:theme';

function readStoredTheme(): ThemeMode | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : undefined;
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return undefined;
  }
}

function initialTheme(): ThemeMode {
  return (
    readStoredTheme() ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

export function useTheme(): { theme: ThemeMode; toggleTheme: () => void } {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The preference simply is not remembered.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
