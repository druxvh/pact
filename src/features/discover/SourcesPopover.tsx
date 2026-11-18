import { Check, Plus, Rss, SlidersHorizontal, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Badge, Button, IconButton, Input, InputGroup, Popover, PopoverContent, PopoverTrigger, Switch } from '@/components/ui';
import { cn } from '@/lib/cn';
import { pluralize } from '@/lib/format';
import { notify } from '@/lib/toast';
import { describeFeedsError, FeedsError, getDiscoverApi } from './api';
import { CATALOG, TOPIC_BY_ID, TOPICS } from './catalog';
import { useFeedStore } from './feedStore';
import { CUSTOM_FEED_CAP, describeFeedFailure, feedIdFor, hostOf, normalizeFeedInput } from './logic';
import { SourceTile } from './SourceTile';
import { useDiscoverStore } from './store';

const LANGUAGES: Record<string, string> = { es: 'Español', fr: 'Français', de: 'Deutsch' };

/** The header button and the panel behind it: topics, sources, hidden sources and "add a feed". */
export function SourcesPopover({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const followed = useDiscoverStore((s) => s.followedSources.length + s.followedTopics.length);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="secondary" aria-label="Manage sources" />}>
        <SlidersHorizontal />
        <span className="hidden sm:inline">Sources</span>
        {followed > 0 && <Badge tone="neutral">{followed}</Badge>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(420px,calc(100vw-24px))] p-0">
        <SourcesPanel />
      </PopoverContent>
    </Popover>
  );
}

function SourcesPanel() {
  const followedSources = useDiscoverStore((s) => s.followedSources);
  const followedTopics = useDiscoverStore((s) => s.followedTopics);
  const customFeeds = useDiscoverStore((s) => s.customFeeds);
  const hiddenSources = useDiscoverStore((s) => s.hiddenSources);
  const { followSource, unfollowSource, toggleTopic, removeCustomFeed, unhideSource } = useDiscoverStore.getState();
  const [query, setQuery] = useState('');

  const following = useMemo(() => new Set(followedSources), [followedSources]);
  const hidden = useMemo(() => new Set(hiddenSources), [hiddenSources]);
  const q = query.trim().toLowerCase();
  const sources = useMemo(
    () => CATALOG.filter((s) => !q || `${s.name} ${s.topics.map((t) => TOPIC_BY_ID[t].label).join(' ')} ${hostOf(s.site)}`.toLowerCase().includes(q)),
    [q],
  );
  const mine = useMemo(() => customFeeds.filter((c) => !q || `${c.name} ${hostOf(c.url)}`.toLowerCase().includes(q)), [customFeeds, q]);

  return (
    <div className="flex max-h-[min(78vh,640px)] flex-col">
      <div className="space-y-3 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Your sources</h2>
          <p className="text-[13px] text-muted-foreground">“For you” is made of what you follow. Hidden sources never appear anywhere.</p>
        </div>
        <AddFeed />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b p-4">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Topics</h3>
          <div className="flex flex-wrap gap-1.5">
            {TOPICS.map((t) => {
              const on = followedTopics.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTopic(t.id)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60',
                    on ? 'border-transparent bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {on && <Check className="size-3" />}
                  {t.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-subtle-foreground">Following a topic adds its four best-known sources to “For you”.</p>
        </section>

        <section className="p-2">
          <div className="p-2 pb-1">
            <InputGroup leading={<Rss />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a source" aria-label="Find a source" />
          </div>

          {mine.length > 0 && (
            <ul aria-label="Your feeds" className="mb-1">
              {mine.map((c) => (
                <Row key={c.id} source={{ id: c.id, name: c.name }} sub={`${hostOf(c.url)} · added by you`}>
                  <IconButton label={`Remove ${c.name}`} size="icon-sm" variant="danger" onClick={() => removeCustomFeed(c.id)}>
                    <Trash2 />
                  </IconButton>
                  <Switch
                    checked={following.has(c.id)}
                    onCheckedChange={(on) => (on ? followSource(c.id) : unfollowSource(c.id))}
                    aria-label={`Follow ${c.name}`}
                  />
                </Row>
              ))}
            </ul>
          )}

          <ul aria-label="Sources">
            {sources.map((s) => (
              <Row
                key={s.id}
                source={s}
                sub={`${s.topics.map((t) => TOPIC_BY_ID[t].label).join(', ')}${s.language !== 'en' ? ` · ${LANGUAGES[s.language] ?? s.language.toUpperCase()}` : ''}`}
              >
                {hidden.has(s.id) ? (
                  <Button size="xs" variant="ghost" onClick={() => unhideSource(s.id)}>
                    Hidden · Show
                  </Button>
                ) : (
                  <Switch
                    checked={following.has(s.id)}
                    onCheckedChange={(on) => (on ? followSource(s.id) : unfollowSource(s.id))}
                    aria-label={`Follow ${s.name}`}
                  />
                )}
              </Row>
            ))}
          </ul>
          {sources.length === 0 && mine.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing matches “{query}”.</p>}
        </section>
      </div>
    </div>
  );
}

function Row({ source, sub, children }: { source: { id: string; name: string }; sub: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/60">
      <SourceTile source={source} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{source.name}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </li>
  );
}

/** "Add a feed": checked here first, then actually read through the server — a feed is only added once it has articles in it. */
function AddFeed() {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const count = useDiscoverStore((s) => s.customFeeds.length);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const input = normalizeFeedInput(value);
    if (!input.ok) {
      setMessage({ tone: 'error', text: input.reason });
      return;
    }
    const store = useDiscoverStore.getState();
    const known = CATALOG.find((s) => s.feed === input.url);
    if (known) {
      store.followSource(known.id);
      store.unhideSource(known.id);
      setMessage({ tone: 'info', text: `${known.name} is already in the list — you now follow it.` });
      setValue('');
      return;
    }
    if (store.customFeeds.some((c) => c.id === feedIdFor(input.url))) {
      setMessage({ tone: 'info', text: 'You’ve already added that feed.' });
      return;
    }
    if (store.customFeeds.length >= CUSTOM_FEED_CAP) {
      setMessage({ tone: 'error', text: `You can add up to ${CUSTOM_FEED_CAP} feeds. Remove one first.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const api = await getDiscoverApi();
      const res = await api.fetchFeeds([input.url], { limit: 25 });
      const feed = res.feeds[0];
      if (!feed || feed.items.length === 0) {
        setMessage({ tone: 'error', text: describeFeedFailure(res.failed[0]?.reason ?? 'not_a_feed') });
        return;
      }
      const id = useDiscoverStore.getState().addCustomFeed(input.url, feed.title);
      if (!id) {
        setMessage({ tone: 'error', text: `You can add up to ${CUSTOM_FEED_CAP} feeds.` });
        return;
      }
      useFeedStore.getState().seed(res);
      setValue('');
      setMessage({ tone: 'info', text: `Added ${feed.title || hostOf(input.url)} — ${pluralize(feed.items.length, 'article')}.` });
      notify.success('Feed added', feed.title || hostOf(input.url));
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof FeedsError ? describeFeedsError(err.code) : 'Couldn’t check that feed right now.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="discover-add-feed" className="sr-only">
        Add an RSS or Atom feed
      </label>
      <div className="flex gap-2">
        <Input
          id="discover-add-feed"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (message) setMessage(null);
          }}
          placeholder="Add a feed: https://example.com/feed.xml"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={message?.tone === 'error' || undefined}
          aria-describedby="discover-add-feed-status"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" loading={busy} disabled={!value.trim()}>
          <Plus /> Add
        </Button>
      </div>
      <p
        id="discover-add-feed-status"
        role="status"
        className={cn('mt-1.5 min-h-4 text-xs', message?.tone === 'error' ? 'text-destructive-text' : 'text-muted-foreground')}
      >
        {message?.text ?? (count > 0 ? `${count} of ${CUSTOM_FEED_CAP} custom feeds` : 'RSS or Atom, https only. We check it before adding.')}
      </p>
    </form>
  );
}
