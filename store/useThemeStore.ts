import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

type ThemeState = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggle: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        applyTheme(next);
      },
    }),
    {
      name: 'pact-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  root.style.colorScheme = theme;
}

// hydrate on load (for wxt newtab)
if (typeof window !== 'undefined') {
  const stored = (() => {
    try {
      const raw = localStorage.getItem('pact-theme');
      if (raw) return JSON.parse(raw)?.state?.theme as Theme | undefined;
    } catch {}
    return undefined;
  })();
  applyTheme(stored ?? 'dark');
}
