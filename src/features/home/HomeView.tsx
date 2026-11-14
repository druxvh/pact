import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowUpRight, Clock3, Globe, Star, Trash2, Command, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useUserStore } from '@/store/useUserStore';

const PLACEHOLDERS = [
  'Search Google or type a URL',
  'cat food online',
  'best cafes near me',
  'how to learn framer motion',
  'weather in berlin',
  'pact notes',
];

function useTypingPlaceholder(phrases: string[], opts?: { typeMs?: number; deleteMs?: number; pauseMs?: number }) {
  const { typeMs = 55, deleteMs = 28, pauseMs = 1400 } = opts ?? {};
  const [idx, setIdx] = useState(0);
  const [sub, setSub] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    const full = phrases[idx] ?? '';
    let t: number;

    if (!deleting) {
      if (sub < full.length) {
        t = window.setTimeout(() => {
          setSub((s) => s + 1);
          setText(full.slice(0, sub + 1));
        }, typeMs + Math.random() * 18);
      } else {
        t = window.setTimeout(() => setDeleting(true), pauseMs);
      }
    } else {
      if (sub > 0) {
        t = window.setTimeout(() => {
          setSub((s) => s - 1);
          setText(full.slice(0, sub - 1));
        }, deleteMs);
      } else {
        setDeleting(false);
        setIdx((i) => (i + 1) % phrases.length);
      }
    }
    return () => window.clearTimeout(t);
  }, [idx, sub, deleting, phrases, typeMs, deleteMs, pauseMs]);

  return text;
}

// Mock most-used + bookmark-ish — would read chrome.topSites / bookmarks / history if permission
type QuickLink = { id: string; title: string; url: string; visits?: number; isBookmark?: boolean };

const MOCK_LINKS: QuickLink[] = [
  { id: '1', title: 'GitHub', url: 'https://github.com', visits: 342 },
  { id: '2', title: 'Figma', url: 'https://figma.com', visits: 210 },
  { id: '3', title: 'Notion', url: 'https://notion.so', visits: 189 },
  { id: '4', title: 'YouTube', url: 'https://youtube.com', visits: 412 },
  { id: '5', title: 'Gmail', url: 'https://mail.google.com', visits: 298 },
  { id: '6', title: 'Linear', url: 'https://linear.app', visits: 95, isBookmark: true },
  { id: '7', title: 'Vercel', url: 'https://vercel.com', visits: 88, isBookmark: true },
  { id: '8', title: 'X (Twitter)', url: 'https://x.com', visits: 176 },
  { id: '9', title: 'Perplexity', url: 'https://perplexity.ai', visits: 76, isBookmark: true },
  { id: '10', title: 'Calendar', url: 'https://calendar.google.com', visits: 121 },
  { id: '11', title: 'Drive', url: 'https://drive.google.com', visits: 143 },
  { id: '12', title: 'Pact Docs', url: 'https://pact.app', visits: 44, isBookmark: true },
];

function favicon(url: string) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch {
    return '';
  }
}

export function HomeView() {
  const typedPlaceholder = useTypingPlaceholder(PLACEHOLDERS);
  const [query, setQuery] = useState('');
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentUser = useUserStore((s) => s.currentUser);
  const [links, setLinks] = useState<QuickLink[]>(MOCK_LINKS);
  const [recentQuery, setRecentQuery] = useState<string | null>(null);

  // autofocus — Chrome keeps omnibox focused, so we try double-focus + shortcuts (/, Cmd+K) as fallback
  useEffect(() => {
    const el = inputRef.current;
    el?.focus({ preventScroll: true } as any);
    const t1 = window.setTimeout(() => el?.focus({ preventScroll: true } as any), 120);
    const t2 = window.setTimeout(() => el?.focus(), 400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // "/" and Cmd/Ctrl+K to focus — premium, feels instant when omnibox steals focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.key === '/' && !isTyping) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    setShowPlaceholder(query.length === 0);
  }, [query]);

  // try to load chrome.topSites / bookmarks if available — fallback to mock
  useEffect(() => {
    const anyChrome = (globalThis as any).chrome;
    if (!anyChrome?.topSites?.get) return;
    try {
      anyChrome.topSites.get((sites: Array<{ url: string; title: string }>) => {
        if (!sites?.length) return;
        const mapped: QuickLink[] = sites.slice(0, 12).map((s, i) => ({ id: `top-${i}`, title: s.title || new URL(s.url).hostname, url: s.url, visits: 100 - i * 7 }));
        setLinks(mapped);
      });
    } catch {}
  }, []);

  const goSearch = (q: string) => {
    const v = q.trim();
    if (!v) return;
    // if looks like URL, go directly
    const isUrl = /^https?:\/\//.test(v) || /^[\w-]+\.[\w-]+\.[\w./?=&%+-]+$/.test(v) && v.includes('.');
    if (isUrl) {
      const url = v.startsWith('http') ? v : `https://${v}`;
      window.location.href = url;
      return;
    }
    setRecentQuery(v);
    // animate out then redirect — feels premium
    setTimeout(() => {
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(v)}`;
    }, 180);
  };

  const now = useMemo(() => new Date(), []);
  const greeting = useMemo(() => {
    const h = now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, [now]);

  return (
    <div className="flex min-h-[calc(100vh-56px-48px)] flex-col">
      {/* centered search — minimal */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-1 flex-col items-center justify-center px-4 pb-10 pt-10 md:pt-16"
      >
        {/* tiny greeting — minimal, not a card */}
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.24 }}
          className="mb-6 flex items-center gap-1.5 text-xs tracking-widest text-muted-foreground"
        >
          <Sparkles className="h-3 w-3 text-accent" /> {greeting} · {currentUser?.displayName ?? 'you'} · {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </motion.p>

        {/* search bar — premium, minimal rounded-sm */}
        <motion.form
          onSubmit={(e) => {
            e.preventDefault();
            goSearch(query);
          }}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="group relative w-full max-w-[640px]"
        >
          <div className="relative flex h-[52px] items-center overflow-hidden rounded-sm border border-input bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] transition-all duration-200 ease-out group-has-[input:focus]:border-ring group-has-[input:focus]:shadow-[0_0_0_3px_hsl(var(--ring)/0.08),0_8px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_24px_rgba(0,0,0,0.25)]">
            <Search className="pointer-events-none ml-3.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              className="h-full flex-1 bg-transparent px-3 text-[15px] font-normal text-foreground placeholder:text-transparent outline-none"
              aria-label="Search"
            />
            {/* animated placeholder — typed one by one */}
            <AnimatePresence>
              {showPlaceholder && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="pointer-events-none absolute left-11 right-24 flex items-center truncate text-[15px] text-muted-foreground"
                >
                  <span className="truncate">{typedPlaceholder}</span>
                  <motion.span
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                    className="ml-0.5 inline-block h-4 w-px shrink-0 bg-muted-foreground/60"
                  />
                </motion.span>
              )}
            </AnimatePresence>

            <div className="absolute right-1.5 flex items-center gap-1.5">
              {query ? (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                  className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  Clear
                </motion.button>
              ) : (
                <span className="hidden items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-1 text-[11px] font-medium text-muted-foreground md:inline-flex">
                  <Command className="h-3 w-3" />K
                </span>
              )}
              <button
                type="submit"
                aria-label="Search"
                className="flex h-8 w-8 items-center justify-center rounded-sm bg-accent text-accent-foreground transition-colors hover:bg-accent/90 active:scale-[0.98] shadow-sm"
              >
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* helpers — minimal */}
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }} className="mt-2.5 text-center text-xs text-muted-foreground/80">
            Press <span className="rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-[11px]">Enter</span> to search Google · Paste a URL to go directly · <span className="rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-[11px]">/</span> or <span className="rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-[11px]">⌘K</span> to focus · Or type <span className="rounded-sm bg-accent px-1 py-0.5 font-mono text-[11px] text-accent-foreground">pact cat food</span> in address bar
          </motion.p>
          {recentQuery && (
            <motion.p initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} className="mt-1 text-center text-xs text-muted-foreground">
              Searching for “{recentQuery}”…
            </motion.p>
          )}
        </motion.form>

        {/* most used / bookmarks — useful as fuck, minimal */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.28 }}
          className="mt-10 w-full max-w-[720px]"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" /> Most used
            </h3>
            <div className="flex items-center gap-1">
              <span className="hidden text-xs text-muted-foreground md:inline">Bookmarks & frequent</span>
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{links.length}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {links.slice(0, 12).map((link, i) => (
              <motion.a
                key={link.id}
                href={link.url}
                target="_self"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.24 + i * 0.02, duration: 0.22 }}
                whileHover={{ y: -1.5 }}
                whileTap={{ scale: 0.98 }}
                className="group relative flex items-center gap-3 rounded-sm border border-border bg-card p-3 transition-colors hover:border-ring/40 hover:bg-accent/40"
              >
                <img
                  src={favicon(link.url)}
                  alt=""
                  width={20}
                  height={20}
                  className="h-5 w-5 shrink-0 rounded-sm border border-border bg-background object-contain p-0.5"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{link.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{new URL(link.url).hostname.replace('www.', '')}</span>
                </span>
                <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                {link.isBookmark && (
                  <Star className="absolute right-1 top-1 h-3 w-3 fill-amber-400 text-amber-400" />
                )}
              </motion.a>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                // mock add — would open bookmark manager
                const url = prompt('Add bookmark URL');
                if (!url) return;
                try {
                  const u = new URL(url.startsWith('http') ? url : `https://${url}`);
                  setLinks((l) => [{ id: `b-${Date.now()}`, title: u.hostname.replace('www.', ''), url: u.toString(), isBookmark: true }, ...l].slice(0, 12));
                } catch {}
              }}
              className="rounded-sm border border-dashed border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            >
              + Add shortcut
            </motion.button>
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setLinks((l) => l.slice().sort(() => Math.random() - 0.5))}
              className="rounded-sm border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Shuffle
            </motion.button>
            <motion.a href="chrome://bookmarks/" whileHover={{ y: -1 }} className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              <Globe className="h-3 w-3" /> Manage
            </motion.a>
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={() => setLinks(MOCK_LINKS)}
              className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="h-3 w-3" /> Reset
            </motion.button>
          </div>

        </motion.div>
      </motion.div>
    </div>
  );
}
