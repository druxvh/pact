import { Dialog as D } from '@base-ui/react/dialog';
import { ArrowRight, BellOff, CornerDownLeft, FilePlus2, Globe, Keyboard, ListPlus, type LucideIcon, Moon, Search, SunMoon } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDataItems } from '@/app/paletteSources';
import { SECTIONS } from '@/app/routes';
import { Kbd } from '@/components/ui';
import { useNotesStore } from '@/features/notes/store';
import { openUrl, webSearch } from '@/lib/ext';
import { bestScore } from '@/lib/fuzzy';
import { resolveInput } from '@/lib/url';
import { useNavStore } from '@/store/useNavStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useUiStore } from '@/store/useUiStore';

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  kbd?: string[];
  run: () => void;
};

const GROUP_ORDER = ['Top result', 'Navigate', 'Actions', 'Tools', 'Notes', 'Tasks', 'Chats', 'Shortcuts', 'Web'];

function useStaticItems(): PaletteItem[] {
  const go = useNavStore((s) => s.go);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);

  return useMemo<PaletteItem[]>(
    () => [
      ...SECTIONS.map<PaletteItem>((s) => ({
        id: `nav-${s.id}`,
        group: 'Navigate',
        label: `Go to ${s.label}`,
        hint: s.description,
        icon: s.icon,
        keywords: s.label,
        kbd: ['G', s.hotkey.toUpperCase()],
        run: () => go(s.id),
      })),
      {
        id: 'act-note',
        group: 'Actions',
        label: 'Create a new note',
        icon: FilePlus2,
        keywords: 'write add',
        run: () => {
          useNotesStore.getState().addNote();
          go('notes');
        },
      },
      {
        id: 'act-task',
        group: 'Actions',
        label: 'Create a new task',
        icon: ListPlus,
        keywords: 'todo kanban add',
        run: () => {
          useUiStore.getState().setPendingNewTask(true);
          go('kanban');
        },
      },
      { id: 'act-theme', group: 'Actions', label: 'Toggle light / dark theme', icon: SunMoon, keywords: 'appearance mode', run: () => toggleTheme() },
      {
        id: 'act-dark',
        group: 'Actions',
        label: 'Use system theme',
        icon: Moon,
        keywords: 'appearance auto',
        run: () => useThemeStore.getState().setMode('system'),
      },
      { id: 'act-keys', group: 'Actions', label: 'Show keyboard shortcuts', icon: Keyboard, kbd: ['?'], run: () => setShortcutsOpen(true) },
      { id: 'act-read', group: 'Actions', label: 'Mark all notifications as read', icon: BellOff, run: () => markAllRead() },
    ],
    [go, toggleTheme, markAllRead, setShortcutsOpen],
  );
}

function buildItems(query: string, statics: PaletteItem[]): PaletteItem[] {
  const q = query.trim();
  const scored: Array<{ item: PaletteItem; score: number }> = [];

  for (const item of [...statics, ...buildDataItems(q)]) {
    const score = q ? bestScore(q, [item.label, item.keywords, item.hint]) : 1;
    if (score > 0) scored.push({ item, score });
  }

  const out: PaletteItem[] = [];
  if (q) {
    const r = resolveInput(q);
    if (r.kind === 'url') {
      out.push({
        id: 'top-open',
        group: 'Top result',
        label: `Open ${r.url.replace(/^https?:\/\//, '')}`,
        icon: Globe,
        run: () => openUrl(r.url),
      });
    }
  }

  const grouped = new Map<string, Array<{ item: PaletteItem; score: number }>>();
  for (const s of scored) {
    const arr = grouped.get(s.item.group) ?? [];
    arr.push(s);
    grouped.set(s.item.group, arr);
  }
  const groupNames = [...grouped.keys()].sort((a, b) => ((GROUP_ORDER.indexOf(a) + 100) % 100) - ((GROUP_ORDER.indexOf(b) + 100) % 100));
  for (const g of groupNames) {
    const arr = grouped.get(g) ?? [];
    if (q) arr.sort((a, b) => b.score - a.score);
    // keep lists tight when searching; show everything when browsing
    out.push(...arr.slice(0, q ? 6 : 99).map((s) => s.item));
  }

  if (q) {
    out.push({
      id: 'web-search',
      group: 'Web',
      label: `Search the web for “${q}”`,
      icon: Search,
      run: () => void webSearch(q),
    });
  }
  return out;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const statics = useStaticItems();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => (open ? buildItems(query, statics) : []), [open, query, statics]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart at the first result whenever the query changes
  useEffect(() => {
    setIndex(0);
  }, [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the highlighted row in view as the selection or the results change
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, items]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    setOpen(false);
    window.setTimeout(item.run, 0); // after the dialog restores focus
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[index]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIndex(Math.max(0, items.length - 1));
    }
  };

  // group header boundaries for rendering
  let lastGroup = '';

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[3px] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <D.Viewport className="fixed inset-0 z-[60] grid items-start justify-items-center overflow-y-auto p-4 pt-[12vh]">
          <D.Popup
            aria-label="Command palette"
            className="w-full max-w-[600px] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-pop outline-none transition-[opacity,transform] duration-200 ease-out-expo data-[starting-style]:-translate-y-2 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0"
          >
            <D.Title className="sr-only">Command palette</D.Title>
            <div className="flex items-center gap-3 border-b px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                // biome-ignore lint/a11y/noAutofocus: the palette opens on request and typing must start immediately
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls="cmd-list"
                aria-activedescendant={items[index] ? `cmd-${items[index].id}` : undefined}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search, jump to a page, or run a command…"
                spellCheck={false}
                autoComplete="off"
                className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle-foreground"
              />
              <Kbd>esc</Kbd>
            </div>

            <div ref={listRef} id="cmd-list" role="listbox" className="max-h-[min(420px,55vh)] overflow-y-auto p-2">
              {items.length === 0 && <div className="px-3 py-10 text-center text-sm text-muted-foreground">No results for “{query}”</div>}
              {items.map((item, i) => {
                const showHeader = item.group !== lastGroup;
                lastGroup = item.group;
                const selected = i === index;
                const Icon = item.icon;
                return (
                  <div key={item.id} role="presentation">
                    {showHeader && <div className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">{item.group}</div>}
                    {/* biome-ignore lint/a11y/useFocusableInteractive: options are chosen via aria-activedescendant on the combobox input */}
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the combobox input (arrows + Enter) */}
                    <div
                      id={`cmd-${item.id}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setIndex(i)}
                      onClick={() => run(item)}
                      className="relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
                    >
                      {selected && (
                        <motion.span
                          layoutId="cmd-highlight"
                          transition={{ type: 'spring', stiffness: 700, damping: 45 }}
                          className="absolute inset-0 rounded-lg bg-accent"
                        />
                      )}
                      <span className="relative grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                      <span className="relative min-w-0 flex-1">
                        <span className="block truncate text-sm">{item.label}</span>
                        {item.hint && <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>}
                      </span>
                      <span className="relative flex shrink-0 items-center gap-1">
                        {item.kbd?.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                        {selected && !item.kbd && <ArrowRight className="size-3.5 text-muted-foreground" />}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-subtle-foreground">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>
                  <CornerDownLeft className="size-3" />
                </Kbd>{' '}
                select
              </span>
              <span className="ml-auto hidden sm:block">Type a URL to open it, anything else to search</span>
            </div>
          </D.Popup>
        </D.Viewport>
      </D.Portal>
    </D.Root>
  );
}
