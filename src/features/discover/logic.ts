/** Pure helpers for Discover: ranking, search, source selection, validation and the limits on what is kept. All unit-tested. */
import { CATALOG, isTopicId, SOURCE_BY_ID, type Source, sourcesForTopic, TOPIC_FOLLOW_SOURCES, type TopicId } from './catalog';
import type { Article, CustomFeed, Density, Entry, FeedRef, FeedsResponse, SavedArticle, SourceRef, View } from './types';

export const SAVED_CAP = 200;
export const READ_CAP = 600;
export const CUSTOM_FEED_CAP = 20;
export const FOLLOW_CAP = 300;
/** The `feeds` function takes at most this many URLs per request. */
export const URLS_PER_REQUEST = 12;
/** How many items to ask for from every feed. */
export const ITEMS_PER_FEED = 25;
const HOUR = 3_600_000;

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// ── small value helpers ──────────────────────────────────────────────────────

/** 32-bit string hash → a stable hue 0–359 for a source's tile and its picture placeholder. */
export function sourceHue(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0] as string);
  if (words.length === 1) return first.slice(0, 2).join('').toUpperCase();
  return `${first[0] ?? ''}${Array.from(words[1] as string)[0] ?? ''}`.toUpperCase();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** "N min read" — only when the feed carries the full text (otherwise there's nothing honest to estimate from). */
export const readMinutes = (words: number): number | null => (words >= 40 ? Math.max(1, Math.round(words / 230)) : null);

export const isHttpsUrl = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 2000) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
};

const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

// ── the API boundary: trust nothing the network returns ─────────────────────

/** One article, from untrusted JSON; null when it isn't usable. */
export function toArticle(raw: unknown): Article | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[\w-]{3,40}$/.test(r.id) ? r.id : null;
  const title = text(r.title, 300).trim();
  if (!id || !title || !isHttpsUrl(r.url)) return null;
  return {
    id,
    title,
    url: r.url,
    summary: text(r.summary, 400),
    contentHtml: text(r.contentHtml, 60_000),
    image: isHttpsUrl(r.image) ? r.image : null,
    author: text(r.author, 100),
    publishedAt: isoOrNull(r.publishedAt),
    categories: Array.isArray(r.categories)
      ? r.categories
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.slice(0, 40))
          .slice(0, 5)
      : [],
    words: typeof r.words === 'number' && Number.isFinite(r.words) && r.words > 0 ? Math.min(Math.floor(r.words), 1_000_000) : 0,
  };
}

/** A whole `feeds` response, from untrusted JSON; `null` when it isn't the expected shape at all. */
export function toFeedsResponse(raw: unknown): FeedsResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { ok?: unknown; feeds?: unknown; failed?: unknown };
  if (r.ok !== true || !Array.isArray(r.feeds)) return null;
  const feeds: FeedsResponse['feeds'] = [];
  for (const f of r.feeds.slice(0, 40)) {
    if (typeof f !== 'object' || f === null || !isHttpsUrl((f as { url?: unknown }).url)) continue;
    const { url, title, items } = f as { url: string; title?: unknown; items?: unknown };
    feeds.push({
      url,
      title: text(title, 100),
      items: Array.isArray(items)
        ? items
            .slice(0, 60)
            .map(toArticle)
            .filter((a): a is Article => a !== null)
        : [],
    });
  }
  const failed = Array.isArray(r.failed)
    ? r.failed
        .filter((f): f is { url: string; reason: string } => typeof f === 'object' && f !== null && typeof (f as { url?: unknown }).url === 'string')
        .slice(0, 40)
        .map((f) => ({ url: f.url.slice(0, 2000), reason: text(f.reason, 40) || 'unreachable' }))
    : [];
  return { feeds, failed };
}

// ── choosing the feeds behind a view ─────────────────────────────────────────

export type Following = {
  followedSources: readonly string[];
  followedTopics: readonly TopicId[];
  customFeeds: readonly CustomFeed[];
  hiddenSources: readonly string[];
};

export const refOfSource = (s: Source): FeedRef => ({ id: s.id, name: s.name, site: s.site, url: s.feed, language: s.language, custom: false });
export const refOfCustom = (c: CustomFeed): FeedRef => ({ id: c.id, name: c.name, site: originOf(c.url), url: c.url, language: 'en', custom: true });
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

/** Every feed the person could see: the catalog and their own. */
export function allFeedRefs(customFeeds: readonly CustomFeed[]): FeedRef[] {
  return [...CATALOG.map(refOfSource), ...customFeeds.map(refOfCustom)];
}

/**
 * The feeds that make up a view, hidden sources removed.
 *  - "For you": the sources they follow, plus the first few English sources of every topic they follow;
 *  - a topic: that topic's English sources, plus any followed source (say, one in another language) that carries it;
 *  - "saved": none (that list is already on the device).
 */
export function feedsForView(view: View, f: Following): FeedRef[] {
  if (view === 'saved') return [];
  const hidden = new Set(f.hiddenSources);
  const out = new Map<string, FeedRef>();
  const add = (ref: FeedRef | undefined) => {
    if (ref && !hidden.has(ref.id) && !out.has(ref.url)) out.set(ref.url, ref);
  };
  if (view === 'foryou') {
    const custom = new Map(f.customFeeds.map((c) => [c.id, c]));
    for (const id of f.followedSources) {
      const src = SOURCE_BY_ID[id];
      const own = custom.get(id);
      add(src ? refOfSource(src) : own ? refOfCustom(own) : undefined);
    }
    for (const t of f.followedTopics) for (const src of sourcesForTopic(t).slice(0, TOPIC_FOLLOW_SOURCES)) add(refOfSource(src));
  } else {
    for (const src of sourcesForTopic(view)) add(refOfSource(src));
    for (const id of f.followedSources) {
      const src = SOURCE_BY_ID[id];
      if (src?.topics.includes(view)) add(refOfSource(src));
    }
  }
  return [...out.values()];
}

// ── entries, ranking, search ─────────────────────────────────────────────────

export const toEntries = (feed: FeedRef, items: readonly Article[]): Entry[] =>
  items.map((a) => ({ ...a, source: { id: feed.id, name: feed.name, site: feed.site }, feedUrl: feed.url }));

const timeOf = (e: { publishedAt: string | null }, now: number): number => {
  const t = e.publishedAt ? Date.parse(e.publishedAt) : Number.NaN;
  return Number.isNaN(t) ? now - 7 * 24 * HOUR : Math.min(t, now);
};

/** How far each further story from the same source is pushed back, so one prolific feed can't fill the page. */
export const DIVERSITY_MS = 45 * 60_000;

/**
 * One list from many feeds: newest first, with each source's n-th story treated as n × 45 minutes older than it really is
 * (so the page interleaves publishers instead of showing 25 stories from the one that posts most), duplicates removed.
 */
export function rankEntries(entries: readonly Entry[], now = Date.now()): Entry[] {
  const seen = new Set<string>();
  const perSource = new Map<string, Entry[]>();
  for (const e of entries) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const list = perSource.get(e.source.id);
    if (list) list.push(e);
    else perSource.set(e.source.id, [e]);
  }
  const scored: Array<{ e: Entry; score: number }> = [];
  for (const list of perSource.values()) {
    list.sort((a, b) => timeOf(b, now) - timeOf(a, now));
    for (const [i, e] of list.entries()) scored.push({ e, score: timeOf(e, now) - i * DIVERSITY_MS });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title)).map((x) => x.e);
}

/** Every word of the query must appear somewhere in the title, summary, source, author or categories. */
export function searchEntries<T extends Entry | SavedArticle>(entries: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...entries];
  return entries.filter((e) => {
    const hay = `${e.title} ${e.summary} ${e.source.name} ${e.author} ${e.categories.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The "top story": the first of the freshest few that has a picture (a text-only hero when none does). */
export function pickHero(entries: readonly Entry[]): number {
  if (!entries.length) return -1;
  const i = entries.slice(0, 8).findIndex((e) => e.image);
  return i === -1 ? 0 : i;
}

export const toSaved = (e: Entry | SavedArticle, savedAt = new Date().toISOString()): SavedArticle => {
  const { contentHtml: _body, feedUrl: _feed, ...rest } = e as Entry;
  return { ...rest, source: { id: e.source.id, name: e.source.name, site: e.source.site }, savedAt };
};

/** A saved article as a list entry (no body — the reader looks one up from the feeds if it's still there). */
export const savedToEntry = (s: SavedArticle): Entry => ({ ...s, contentHtml: '', feedUrl: '' });

// ── custom feeds ─────────────────────────────────────────────────────────────

export type FeedInput = { ok: true; url: string } | { ok: false; reason: string };

/**
 * What someone typed in "add a feed": a URL, or just a site name like `example.com/feed.xml`. https only, no credentials,
 * no addresses that point at the person's own network. (The `feeds` function checks again, and fetches it.)
 */
export function normalizeFeedInput(raw: string): FeedInput {
  const input = raw.trim();
  if (!input) return { ok: false, reason: 'Paste the address of an RSS or Atom feed.' };
  if (input.length > 2000 || /\s/.test(input)) return { ok: false, reason: 'That doesn’t look like a web address.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'That doesn’t look like a web address.' };
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only https feeds can be added.' };
  if (url.username || url.password) return { ok: false, reason: 'Feeds with a password in the address can’t be added.' };
  const host = url.hostname.toLowerCase();
  if (
    !host.includes('.') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(':') ||
    /\.(local|localhost|internal|lan|home\.arpa)$/.test(host) ||
    host === 'localhost'
  )
    return { ok: false, reason: 'That address is on a private network — only public feeds can be added.' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'Feeds on unusual ports can’t be added.' };
  url.hash = '';
  return { ok: true, url: url.toString() };
}

export function feedIdFor(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = (Math.imul(h, 33) + url.charCodeAt(i)) | 0;
  return `custom-${(h >>> 0).toString(36)}`;
}

/** What went wrong when a feed couldn't be loaded, in words. */
export function describeFeedFailure(reason: string): string {
  switch (reason) {
    case 'not_a_feed':
      return 'That page isn’t an RSS or Atom feed.';
    case 'empty':
      return 'That feed has no articles in it.';
    case 'not_found':
      return 'There’s nothing at that address.';
    case 'refused':
      return 'That site wouldn’t let pact read its feed.';
    case 'blocked':
    case 'invalid_url':
      return 'That address can’t be used.';
    case 'too_many_redirects':
      return 'That address keeps redirecting.';
    default:
      return 'That site didn’t answer. Try again in a moment.';
  }
}

// ── what is kept on the device ───────────────────────────────────────────────

/** Newest first, no duplicates, at most `cap`. */
export function capList<T>(items: readonly T[], keyOf: (t: T) => string, cap: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = keyOf(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= cap) break;
  }
  return out;
}

export const addSaved = (saved: readonly SavedArticle[], item: SavedArticle): SavedArticle[] => capList([item, ...saved], (s) => s.id, SAVED_CAP);
export const removeSaved = (saved: readonly SavedArticle[], id: string): SavedArticle[] => saved.filter((s) => s.id !== id);
export const addRead = (read: readonly string[], id: string): string[] => capList([id, ...read], (s) => s, READ_CAP);

const strings = (v: unknown, cap: number, max = 80): string[] =>
  Array.isArray(v)
    ? capList(
        v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= max),
        (s) => s,
        cap,
      )
    : [];

const toSource = (v: unknown): SourceRef | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = text(r.id, 80);
  const name = text(r.name, 100);
  if (!id || !name) return null;
  return { id, name, site: typeof r.site === 'string' && /^https?:\/\//.test(r.site) ? r.site.slice(0, 300) : '' };
};

export function toSavedArticle(raw: unknown): SavedArticle | null {
  const a = toArticle({ ...(raw as object), contentHtml: '' });
  const r = (raw ?? {}) as Record<string, unknown>;
  const source = toSource(r.source);
  if (!a || !source) return null;
  const { contentHtml: _body, ...rest } = a;
  return { ...rest, source, savedAt: isoOrNull(r.savedAt) ?? new Date(0).toISOString() };
}

export type DiscoverData = {
  followedSources: string[];
  followedTopics: TopicId[];
  customFeeds: CustomFeed[];
  hiddenSources: string[];
  saved: SavedArticle[];
  read: string[];
  density: Density;
  topic: View;
};

/** Persisted data is just JSON in localStorage (or a backup file): coerce every field, drop what doesn't fit, enforce the caps. Fields missing from `raw` are left out. */
export function sanitizeDiscoverData(raw: unknown): Partial<DiscoverData> {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<DiscoverData> = {};
  if (Array.isArray(r.followedSources)) out.followedSources = strings(r.followedSources, FOLLOW_CAP);
  if (Array.isArray(r.followedTopics)) out.followedTopics = capList(r.followedTopics.filter(isTopicId), (t) => t, 12);
  if (Array.isArray(r.hiddenSources)) out.hiddenSources = strings(r.hiddenSources, FOLLOW_CAP);
  if (Array.isArray(r.read)) out.read = strings(r.read, READ_CAP, 40);
  if (Array.isArray(r.customFeeds)) {
    const feeds: CustomFeed[] = [];
    for (const c of r.customFeeds) {
      const o = (c ?? {}) as Record<string, unknown>;
      if (typeof o.id !== 'string' || !/^custom-[a-z0-9]{1,12}$/.test(o.id) || !isHttpsUrl(o.url)) continue;
      feeds.push({
        id: o.id,
        url: o.url,
        name: text(o.name, 60).trim() || originOf(o.url).replace(/^https:\/\/(www\.)?/, ''),
        addedAt: isoOrNull(o.addedAt) ?? new Date(0).toISOString(),
      });
    }
    out.customFeeds = capList(feeds, (c) => c.id, CUSTOM_FEED_CAP);
  }
  if (Array.isArray(r.saved)) {
    const saved = r.saved.map(toSavedArticle).filter((s): s is SavedArticle => s !== null);
    out.saved = capList(
      saved.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)),
      (s) => s.id,
      SAVED_CAP,
    );
  }
  if (r.density === 'grid' || r.density === 'list') out.density = r.density;
  if (r.topic === 'foryou' || r.topic === 'saved' || isTopicId(r.topic)) out.topic = r.topic;
  return out;
}
