import { create } from 'zustand';

export const SECTION_IDS = ['home', 'notes', 'kanban', 'timer', 'tools', 'discover', 'chat', 'party', 'settings'] as const;
export type Section = (typeof SECTION_IDS)[number];

type Route = { section: Section; sub: string | null };

type NavState = Route & {
  /** Navigate to a section (optionally a sub-route, e.g. tools → "qr"). */
  go: (section: Section, sub?: string | null, opts?: { replace?: boolean }) => void;
};

const isSection = (v: string | undefined): v is Section => !!v && (SECTION_IDS as readonly string[]).includes(v);

/** `#/tools/qr` → { section: 'tools', sub: 'qr' } */
export function parseHash(hash: string): Route {
  const [, s, sub] = hash.replace(/^#/, '').split('/');
  let decoded: string | null = null;
  if (sub) {
    try {
      decoded = decodeURIComponent(sub);
    } catch {
      decoded = sub; // a hand-typed or truncated "%E0%A4%A" must not take the whole app down
    }
  }
  return { section: isSection(s) ? s : 'home', sub: decoded };
}

export function toHash(section: Section, sub?: string | null): string {
  if (section === 'home') return '#/';
  return `#/${section}${sub ? `/${encodeURIComponent(sub)}` : ''}`;
}

const initial = parseHash(typeof location === 'undefined' ? '' : location.hash);

export const useNavStore = create<NavState>((set, get) => ({
  ...initial,
  go: (section, sub = null, opts) => {
    const cur = get();
    if (cur.section === section && cur.sub === sub) return;
    const hash = toHash(section, sub);
    try {
      if (opts?.replace) history.replaceState(null, '', hash);
      else history.pushState(null, '', hash);
    } catch {
      /* history unavailable — state still updates */
    }
    set({ section, sub });
  },
}));

// Back/forward buttons and manual hash edits.
if (typeof window !== 'undefined') {
  const sync = () => {
    const next = parseHash(location.hash);
    const cur = useNavStore.getState();
    if (next.section !== cur.section || next.sub !== cur.sub) useNavStore.setState(next);
  };
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
}
