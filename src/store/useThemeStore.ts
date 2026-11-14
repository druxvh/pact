import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

type Origin = { x: number; y: number };

type ThemeState = {
  mode: ThemeMode;
  /** The theme actually applied right now (system → resolved against the OS). */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode, origin?: Origin) => void;
  /** Flip between light/dark (resolving `system` first). */
  toggle: (origin?: Origin) => void;
};

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const resolve = (mode: ThemeMode): ResolvedTheme =>
  mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode;

function paint(theme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

/**
 * Apply a theme. When the browser supports View Transitions we reveal the new
 * theme as a circle expanding from the click point; otherwise it's an instant swap.
 */
function applyTheme(theme: ResolvedTheme, origin?: Origin) {
  if (typeof document === 'undefined') return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vt = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } })
    .startViewTransition;
  if (!vt || reduce || document.documentElement.classList.contains('dark') === (theme === 'dark')) {
    paint(theme);
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = vt.call(document, () => paint(theme));
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 560,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    .catch(() => {});
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'dark',
      resolved: 'dark',
      setMode: (mode, origin) => {
        const resolved = resolve(mode);
        applyTheme(resolved, origin);
        set({ mode, resolved });
      },
      toggle: (origin) => {
        const next: ResolvedTheme = get().resolved === 'dark' ? 'light' : 'dark';
        applyTheme(next, origin);
        set({ mode: next, resolved: next });
      },
    }),
    {
      name: 'pact-theme',
      version: 2,
      partialize: (s) => ({ mode: s.mode }),
      // v1 stored `{ theme: 'dark' | 'light' }`
      migrate: (persisted) => {
        const p = (persisted ?? {}) as { mode?: ThemeMode; theme?: ThemeMode };
        return { mode: p.mode ?? p.theme ?? 'dark' } as Partial<ThemeState> as ThemeState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const resolved = resolve(state.mode);
        paint(resolved);
        useThemeStore.setState({ resolved });
      },
    },
  ),
);

// Follow the OS when mode === 'system'.
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { mode } = useThemeStore.getState();
    if (mode !== 'system') return;
    const resolved = resolve('system');
    paint(resolved);
    useThemeStore.setState({ resolved });
  });
  // Sync theme changes made in another open pact tab.
  window.addEventListener('storage', (e) => {
    if (e.key === 'pact-theme') void useThemeStore.persist.rehydrate();
  });
}
