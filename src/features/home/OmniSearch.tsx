import { ArrowUpRight, Clock3, Globe, Link2, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Kbd } from '@/components/ui';
import { SiteIcon } from '@/features/home/SiteIcon';
import { useHomeStore } from '@/features/home/store';
import { cn } from '@/lib/cn';
import { openUrl, webSearch } from '@/lib/ext';
import { bestScore } from '@/lib/fuzzy';
import { useHotkeys } from '@/lib/hotkeys';
import { spring } from '@/lib/motion';
import { hostnameOf, resolveInput } from '@/lib/url';

export type SearchableLink = { id: string; title: string; url: string };

type Suggestion = {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  /** Recent-search rows can be removed individually. */
  removable?: string;
  run: () => void;
};

const PLACEHOLDERS = ['Search the web or type a URL', 'Try “github.com”', 'Try “weather in Berlin”', 'Jump anywhere with ⌘K', 'Try “pomodoro 25 minutes”'];

/**
 * Typewriter placeholder. Lives in its own component so the per-character state
 * updates never re-render the rest of the page (the old version re-rendered the
 * whole Home view ~18×/second).
 */
function TypingPlaceholder() {
  const [text, setText] = useState(PLACEHOLDERS[0] ?? '');
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let phrase = 0;
    let i = 0;
    let deleting = false;
    let timer: number;
    const step = () => {
      const full = PLACEHOLDERS[phrase] ?? '';
      if (!deleting) {
        i++;
        setText(full.slice(0, i));
        if (i >= full.length) {
          deleting = true;
          timer = window.setTimeout(step, 1800);
          return;
        }
        timer = window.setTimeout(step, 45 + Math.random() * 40);
      } else {
        i--;
        setText(full.slice(0, i));
        if (i <= 0) {
          deleting = false;
          phrase = (phrase + 1) % PLACEHOLDERS.length;
          timer = window.setTimeout(step, 350);
          return;
        }
        timer = window.setTimeout(step, 22);
      }
    };
    i = (PLACEHOLDERS[0] ?? '').length;
    deleting = true;
    timer = window.setTimeout(step, 2600);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <span aria-hidden="true" className="pointer-events-none absolute left-12 right-24 flex items-center truncate text-[15px] text-subtle-foreground">
      <span className="truncate">{text}</span>
      <span className="ml-0.5 inline-block h-[18px] w-px shrink-0 animate-pulse bg-subtle-foreground [animation-duration:1s]" />
    </span>
  );
}

export function OmniSearch({ links }: { links: SearchableLink[] }) {
  const recent = useHomeStore((s) => s.recent);
  const pushRecent = useHomeStore((s) => s.pushRecent);
  const removeRecent = useHomeStore((s) => s.removeRecent);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [index, setIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useHotkeys([{ keys: '/', handler: () => inputRef.current?.focus() }]);

  // Chrome often keeps focus in the omnibox on a new tab; try once, politely.
  useEffect(() => {
    const t = window.setTimeout(() => {
      // Never pull focus out of a modal (e.g. the first-run welcome dialog).
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      inputRef.current?.focus({ preventScroll: true });
    }, 80);
    return () => window.clearTimeout(t);
  }, []);

  const resolved = useMemo(() => resolveInput(query), [query]);

  const submit = useCallback(
    (q: string) => {
      const r = resolveInput(q);
      if (r.kind === 'url') openUrl(r.url);
      else if (r.query) {
        pushRecent(r.query);
        void webSearch(r.query);
      }
    },
    [pushRecent],
  );

  const items = useMemo<Suggestion[]>(() => {
    const q = query.trim();
    if (!q) {
      return recent.map<Suggestion>((r) => ({
        id: `recent-${r}`,
        label: r,
        icon: <Clock3 className="size-4" />,
        removable: r,
        run: () => submit(r),
      }));
    }
    const out: Suggestion[] = [];
    const r = resolveInput(q);
    out.push(
      r.kind === 'url'
        ? {
            id: 'top',
            label: `Open ${r.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`,
            hint: 'Go to address',
            icon: <Link2 className="size-4" />,
            run: () => submit(q),
          }
        : {
            id: 'top',
            label: q,
            hint: 'Search the web',
            icon: <Search className="size-4" />,
            run: () => submit(q),
          },
    );
    links
      .map((l) => ({ l, s: bestScore(q, [l.title, hostnameOf(l.url)]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .forEach(({ l }) => {
        out.push({
          id: `link-${l.id}`,
          label: l.title,
          hint: hostnameOf(l.url),
          icon: <SiteIcon url={l.url} title={l.title} size={20} />,
          run: () => openUrl(l.url),
        });
      });
    recent
      .filter((x) => x.toLowerCase().startsWith(q.toLowerCase()) && x.toLowerCase() !== q.toLowerCase())
      .slice(0, 3)
      .forEach((x) => {
        out.push({ id: `recent-${x}`, label: x, icon: <Clock3 className="size-4" />, run: () => submit(x) });
      });
    return out;
  }, [query, recent, links, submit]);

  // First suggestion is pre-selected while typing so Enter does the obvious thing.
  useEffect(() => setIndex(query.trim() ? 0 : -1), [query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the highlighted suggestion in view when the selection moves
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const open = focused && items.length > 0;
  const isUrl = resolved.kind === 'url' && query.trim().length > 0;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else inputRef.current?.blur();
    }
  };

  return (
    <div className="relative w-full max-w-[680px]">
      {/* biome-ignore lint/a11y/useSemanticElements: <form role=search> works everywhere we support; the <search> element only landed in Chrome 118 (we target 116+) */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const picked = items[index];
          if (picked && query.trim()) picked.run();
          else if (query.trim()) submit(query);
        }}
        className={cn(
          'relative flex h-14 items-center rounded-lg border bg-card/80 shadow-md backdrop-blur-md',
          'transition-[border-color,box-shadow,transform] duration-300 ease-out-expo',
          'focus-within:scale-[1.012] focus-within:border-ring focus-within:shadow-[0_0_0_4px_var(--brand-soft),var(--elev-3)]',
        )}
      >
        <span className="pointer-events-none absolute left-4 grid size-5 place-items-center text-muted-foreground">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isUrl ? 'url' : 'search'}
              initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.6, rotate: 20 }}
              transition={{ duration: 0.14 }}
              className="grid place-items-center"
            >
              {isUrl ? <Globe className="size-[18px] text-brand-text" /> : <Search className="size-[18px]" />}
            </motion.span>
          </AnimatePresence>
        </span>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-label="Search the web or enter a URL"
          aria-expanded={open}
          aria-controls="omni-list"
          aria-activedescendant={index >= 0 && items[index] ? `omni-${items[index].id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent pl-12 pr-24 text-[15px] outline-none"
        />
        {!query && <TypingPlaceholder />}

        <div className="absolute right-2 flex items-center gap-1.5">
          <AnimatePresence initial={false}>
            {query ? (
              <motion.button
                key="clear"
                type="button"
                aria-label="Clear search"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={spring.snappy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </motion.button>
            ) : (
              <motion.span key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hidden sm:block">
                <Kbd>/</Kbd>
              </motion.span>
            )}
          </AnimatePresence>
          <button
            type="submit"
            aria-label="Search"
            disabled={!query.trim()}
            className="grid size-9 place-items-center rounded-lg bg-brand text-brand-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.28)] transition-[transform,filter,opacity] duration-150 hover:brightness-110 active:scale-90 disabled:opacity-40"
          >
            <ArrowUpRight className="size-[18px]" />
          </button>
        </div>
      </form>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={listRef}
            id="omni-list"
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.1 } }}
            transition={spring.soft}
            style={{ transformOrigin: 'top center' }}
            className="absolute inset-x-0 top-full z-20 mt-2 max-h-[min(360px,50vh)] overflow-y-auto rounded-lg border bg-popover p-1.5 shadow-pop"
          >
            {!query.trim() && (
              <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">Recent searches</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => useHomeStore.getState().clearRecent()}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
            )}
            {items.map((item, i) => (
              // biome-ignore lint/a11y/useFocusableInteractive: options are chosen via aria-activedescendant on the search input
              // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the search input (arrows + Enter)
              <div
                key={item.id}
                id={`omni-${item.id}`}
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setIndex(i)}
                onClick={item.run}
                className={cn('group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors', i === index && 'bg-accent')}
              >
                <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                {item.hint && <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
                {item.removable && (
                  <button
                    type="button"
                    aria-label={`Remove “${item.label}”`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecent(item.removable ?? '');
                    }}
                    className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                {i === index && !item.removable && <span className="shrink-0 text-[11px] text-subtle-foreground">↵</span>}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
