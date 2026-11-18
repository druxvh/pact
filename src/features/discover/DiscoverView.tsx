import { Tabs } from '@base-ui/react/tabs';
import { Bookmark, LayoutGrid, List, Newspaper, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, InputGroup, Kbd, PageHeader, Segmented } from '@/components/ui';
import { useTourStore } from '@/features/tour/store';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useHotkeys } from '@/lib/hotkeys';
import { scrollToElement } from '@/lib/scroll';
import { notify } from '@/lib/toast';
import { useNavStore } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';
import { ArticleCard, ArticleRow, type CardProps } from './ArticleCard';
import { openOriginal } from './actions';
import { TOPICS } from './catalog';
import { errorMessage } from './feedStore';
import { Hero } from './Hero';
import { pickHero, searchEntries } from './logic';
import { Reader } from './Reader';
import { SourcesPopover } from './SourcesPopover';
import { EmptyReadingList, FeedSkeleton, LoadFailed, NoMatches, NoSources, NothingYet, Offline } from './states';
import { useDiscoverStore } from './store';
import type { Entry, View } from './types';
import { useArticleById, useDiscoverFeed, useNow } from './useDiscoverFeed';

const PAGE = 24;

/** News and articles from many sources, read inside pact. */
export function DiscoverView() {
  const view = useDiscoverStore((s) => s.topic);
  const density = useDiscoverStore((s) => s.density);
  const savedList = useDiscoverStore((s) => s.saved);
  const read = useDiscoverStore((s) => s.read);
  const setView = useDiscoverStore((s) => s.setView);
  const setDensity = useDiscoverStore((s) => s.setDensity);
  const openId = useNavStore((s) => (s.section === 'discover' ? s.sub : null));
  const go = useNavStore((s) => s.go);
  const overlayOpen = useUiStore((s) => s.paletteOpen || s.shortcutsOpen || s.captureOpen);
  const tourActive = useTourStore((s) => s.active);
  const overlay = overlayOpen || tourActive;

  const feed = useDiscoverFeed(view);
  const now = useNow();
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [cursor, setCursor] = useState(-1);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const savedIds = useMemo(() => new Set(savedList.map((s) => s.id)), [savedList]);
  const readIds = useMemo(() => new Set(read), [read]);

  // ── what is on the page ───────────────────────────────────────────────────
  const filtered = useMemo(() => searchEntries(feed.entries, query), [feed.entries, query]);
  const heroAt = view !== 'saved' && !query.trim() ? pickHero(filtered) : -1;
  const hero = heroAt >= 0 ? (filtered[heroAt] ?? null) : null;
  const rest = useMemo(() => (heroAt >= 0 ? filtered.filter((_, i) => i !== heroAt) : filtered), [filtered, heroAt]);
  const visible = useMemo(() => rest.slice(0, shown), [rest, shown]);
  /** Everything keyboard navigation and the reader move through, in page order. */
  const ordered = useMemo(() => (hero ? [hero, ...rest] : rest), [hero, rest]);
  const onPage = hero ? [hero, ...visible] : visible;

  // A new view or search starts at the top again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers
  useEffect(() => {
    setShown(PAGE);
    setCursor(-1);
  }, [view, query]);

  // Keep the chosen chip in view when the row of chips is scrolled sideways (a narrow window, or a pick made from elsewhere).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` is the trigger
  useEffect(() => {
    const list = tabsRef.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][data-active]');
    if (!list || !tab) return;
    const left = tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft - (list.clientWidth - tab.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [view]);

  // Infinite "load more": reveal the next page when the end of the list scrolls near.
  const more = rest.length > shown;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shown` is a trigger — after a page is revealed, a fresh observer reports whether the end is still in view
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((hits) => hits.some((h) => h.isIntersecting) && setShown((n) => n + PAGE), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown]);

  // ── the reader ────────────────────────────────────────────────────────────
  const openEntry = useArticleById(openId, ordered);
  const openAt = openEntry ? ordered.findIndex((e) => e.id === openEntry.id) : -1;

  const open = useCallback(
    (entry: Entry) => {
      useDiscoverStore.getState().markRead(entry.id);
      go('discover', entry.id, { replace: true });
    },
    [go],
  );
  const close = useCallback(() => go('discover', null, { replace: true }), [go]);

  // A link to an article that is no longer anywhere (stale cache, another account…) just closes.
  useEffect(() => {
    if (openId && !openEntry && !feed.loading) close();
  }, [openId, openEntry, feed.loading, close]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const next = ordered[openAt + dir];
      if (!next) return;
      setCursor(onPage.findIndex((e) => e.id === next.id));
      open(next);
    },
    [ordered, openAt, open, onPage],
  );

  // ── actions ───────────────────────────────────────────────────────────────
  const toggleSave = useCallback((entry: Entry) => {
    const added = useDiscoverStore.getState().toggleSaved(entry);
    if (!added) notify.undo('Removed from reading list', () => useDiscoverStore.getState().toggleSaved(entry));
  }, []);
  const toggleRead = useCallback((entry: Entry) => {
    const s = useDiscoverStore.getState();
    if (s.read.includes(entry.id)) s.markUnread(entry.id);
    else s.markRead(entry.id);
  }, []);
  const hideSource = useCallback((entry: Entry) => {
    const { id, name } = entry.source;
    useDiscoverStore.getState().hideSource(id);
    notify.undo(`Hid ${name}`, () => useDiscoverStore.getState().unhideSource(id), 'You can bring it back in Sources.');
  }, []);

  const cardProps = (entry: Entry, index: number): CardProps => ({
    entry,
    read: readIds.has(entry.id),
    saved: savedIds.has(entry.id),
    selected: cursor === index && !openId,
    now,
    onOpen: (e) => {
      setCursor(index);
      open(e);
    },
    onToggleSave: toggleSave,
    onToggleRead: toggleRead,
    onHideSource: hideSource,
  });

  // ── keyboard ──────────────────────────────────────────────────────────────
  const move = useCallback(
    (dir: 1 | -1) => {
      if (!onPage.length) return;
      const next = Math.min(Math.max(cursor + dir, 0), onPage.length - 1);
      setCursor(next);
      const target = onPage[next];
      if (!target) return;
      // `scrollIntoView` would also scroll the document; this moves only the page's own scroll area
      requestAnimationFrame(() => scrollToElement(document.querySelector<HTMLElement>(`[data-entry="${target.id}"]`), { block: 'nearest', offset: 84 }));
    },
    [cursor, onPage],
  );
  const current = openEntry ?? (cursor >= 0 ? (onPage[cursor] ?? null) : null);
  const active = !overlay && !sourcesOpen;
  useHotkeys([
    { keys: 'j', enabled: active, handler: () => (openEntry ? step(1) : move(1)) },
    { keys: 'k', enabled: active, handler: () => (openEntry ? step(-1) : move(-1)) },
    { keys: 'enter', enabled: active && !openEntry && cursor >= 0, ignoreInteractive: true, handler: () => current && open(current) },
    { keys: 'o', enabled: active && !!current, handler: () => current && openOriginal(current) },
    { keys: 's', enabled: active && !!current, handler: () => current && toggleSave(current) },
    { keys: '/', enabled: active && !openEntry, handler: () => searchRef.current?.focus() },
  ]);

  // ── status ────────────────────────────────────────────────────────────────
  const hasCache = feed.entries.length > 0;
  const failedNames = feed.failed.map((f) => f.name);
  const header = (
    <PageHeader
      icon={Newspaper}
      title="Discover"
      description="News and articles you’ll actually read"
      actions={
        <>
          {view !== 'saved' && (
            <span aria-live="polite" className="hidden text-xs text-subtle-foreground md:inline">
              {feed.loading ? 'Updating…' : feed.updatedAt ? `Updated ${relativeTime(feed.updatedAt, now)}` : ''}
            </span>
          )}
          {view !== 'saved' && (
            <IconButton label="Refresh" aria-busy={feed.loading || undefined} disabled={feed.loading || feed.feeds.length === 0} onClick={feed.refresh}>
              <RefreshCw className={cn(feed.loading && 'animate-spin')} />
            </IconButton>
          )}
          <SourcesPopover open={sourcesOpen} onOpenChange={setSourcesOpen} />
        </>
      }
    />
  );

  const toolbar = (
    <div className="surface-glass z-20 flex flex-wrap md:sticky md:top-3 items-center gap-x-2 gap-y-1.5 rounded-lg border p-1.5 shadow-sm">
      <Tabs.Root value={view} onValueChange={(v) => setView(v as View)} className="min-w-0 flex-1 basis-full md:basis-0">
        <Tabs.List ref={tabsRef} aria-label="Topics" className="no-scrollbar -m-1 flex items-center gap-1 overflow-x-auto p-1">
          <Chip value="foryou" icon={<Sparkles />}>
            For you
          </Chip>
          {TOPICS.map((t) => (
            <Chip key={t.id} value={t.id}>
              {t.label}
            </Chip>
          ))}
          <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
          <Chip value="saved" icon={<Bookmark />}>
            Reading list
            {savedList.length > 0 && <span className="tabular ml-0.5 opacity-70">{savedList.length}</span>}
          </Chip>
        </Tabs.List>
      </Tabs.Root>
      <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
        <InputGroup
          ref={searchRef}
          leading={<Search />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (query) setQuery('');
              else e.currentTarget.blur();
            }
          }}
          placeholder="Search stories"
          aria-label="Search stories"
          className="min-w-0 flex-1 md:w-52 md:flex-none md:focus-within:w-64 md:[transition:width_0.25s_var(--ease-out-expo)]"
          trailing={
            query ? (
              <IconButton label="Clear search" size="icon-xs" tooltip={false} onClick={() => setQuery('')}>
                <X />
              </IconButton>
            ) : (
              <Kbd className="hidden md:inline-flex">/</Kbd>
            )
          }
        />
        <Segmented
          aria-label="Layout"
          size="sm"
          value={density}
          onValueChange={setDensity}
          options={[
            { value: 'grid', label: '', icon: <LayoutGrid />, ariaLabel: 'Grid' },
            { value: 'list', label: '', icon: <List />, ariaLabel: 'List' },
          ]}
        />
      </div>
    </div>
  );

  // ── body ──────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (view === 'saved' && savedList.length === 0) body = <EmptyReadingList onBrowse={() => setView('foryou')} />;
  else if (view !== 'saved' && feed.feeds.length === 0) body = <NoSources onChoose={() => setSourcesOpen(true)} />;
  else if (!hasCache && feed.loading) body = <FeedSkeleton density={density} />;
  else if (!hasCache && feed.error === 'offline') body = <Offline onRetry={feed.refresh} />;
  else if (!hasCache && (feed.error || (feed.failed.length > 0 && feed.failed.length === feed.feeds.length))) {
    body = <LoadFailed message={errorMessage(feed.error) ?? 'None of these sources answered. Check your connection and try again.'} onRetry={feed.refresh} />;
  } else if (!hasCache) body = <NothingYet onRetry={feed.refresh} />;
  else if (filtered.length === 0) body = <NoMatches query={query.trim()} onClear={() => setQuery('')} />;
  else {
    const Card = density === 'grid' ? ArticleCard : ArticleRow;
    const offset = hero ? 1 : 0;
    body = (
      <div className="space-y-4">
        {(feed.error || (failedNames.length > 0 && !feed.loading)) && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-2 text-[13px] text-warning-text"
          >
            <span className="min-w-0 flex-1">
              {feed.error
                ? `${errorMessage(feed.error)} Showing what was saved on this device.`
                : `${failedNames.length === 1 ? `${failedNames[0]} didn’t` : `${failedNames.length} sources didn’t`} answer just now.`}
            </span>
            <Button size="xs" variant="ghost" onClick={feed.refresh} disabled={feed.loading}>
              Try again
            </Button>
          </div>
        )}
        {hero && <Hero {...cardProps(hero, 0)} />}
        <div className={cn(density === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'mx-auto flex max-w-4xl flex-col gap-3')}>
          {visible.map((entry, i) => (
            <div key={entry.id} className="h-full animate-fade-up" style={{ animationDelay: `${Math.min(i % PAGE, 12) * 28}ms` }}>
              <Card {...cardProps(entry, i + offset)} />
            </div>
          ))}
        </div>
        {more && (
          <div ref={sentinel} className="flex justify-center py-6">
            <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
              Load more · {rest.length - shown} left
            </Button>
          </div>
        )}
        {!more && visible.length > 8 && <p className="py-6 text-center text-xs text-subtle-foreground">That’s everything for now.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      {toolbar}
      {body}
      <Reader
        entry={openEntry}
        saved={openEntry ? savedIds.has(openEntry.id) : false}
        hasPrev={openAt > 0}
        hasNext={openAt >= 0 && openAt < ordered.length - 1}
        onClose={close}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToggleSave={toggleSave}
      />
    </div>
  );
}

function Chip({ value, icon, children }: { value: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Tabs.Tab
      value={value}
      className={cn(
        'inline-flex h-8 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium text-muted-foreground outline-none transition-colors duration-150',
        'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-3.5',
        'data-[active]:bg-foreground data-[active]:text-background',
      )}
    >
      {icon}
      {children}
    </Tabs.Tab>
  );
}
