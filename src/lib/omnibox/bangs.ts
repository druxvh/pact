import { expandUrlTemplate, hasPlaceholder, usesClipboard } from '@/lib/omnibox/templates';

/** Search-in-a-site shortcuts: `!yt lofi`, `lofi !yt`, or Tab after `yt` to scope the whole box to YouTube. */
export type Bang = {
  id: string;
  name: string;
  /** What you can type, shortest first. A single letter only counts with the `!` (so `w` alone never turns into Wikipedia). */
  triggers: string[];
  /** Search URL; `%s` is replaced by the URL-encoded query. */
  url: string;
  /** Where "just open it" goes. Also what the brand icon is looked up from. */
  home: string;
  /**
   * A quicklink the user made (see `features/commands`): `url` is then a template with `{query}` / `{clipboard}` instead
   * of `%s`, and `icon` is the icon they picked (`emoji:🍵` / `icon:rocket`) — empty for the site's favicon.
   */
  custom?: boolean;
  icon?: string;
};

export const BANGS: readonly Bang[] = [
  { id: 'google', name: 'Google', triggers: ['g', 'google'], url: 'https://www.google.com/search?q=%s', home: 'https://www.google.com/' },
  { id: 'youtube', name: 'YouTube', triggers: ['yt', 'youtube'], url: 'https://www.youtube.com/results?search_query=%s', home: 'https://www.youtube.com/' },
  { id: 'github', name: 'GitHub', triggers: ['gh', 'github'], url: 'https://github.com/search?q=%s', home: 'https://github.com/' },
  { id: 'maps', name: 'Google Maps', triggers: ['maps', 'map', 'gm'], url: 'https://www.google.com/maps/search/%s', home: 'https://maps.google.com/' },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    triggers: ['w', 'wiki', 'wikipedia'],
    url: 'https://en.wikipedia.org/w/index.php?search=%s',
    home: 'https://en.wikipedia.org/',
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    triggers: ['so', 'stackoverflow'],
    url: 'https://stackoverflow.com/search?q=%s',
    home: 'https://stackoverflow.com/',
  },
  { id: 'mdn', name: 'MDN Web Docs', triggers: ['mdn'], url: 'https://developer.mozilla.org/en-US/search?q=%s', home: 'https://developer.mozilla.org/' },
  { id: 'npm', name: 'npm', triggers: ['npm'], url: 'https://www.npmjs.com/search?q=%s', home: 'https://www.npmjs.com/' },
  { id: 'amazon', name: 'Amazon', triggers: ['amz', 'amazon'], url: 'https://www.amazon.com/s?k=%s', home: 'https://www.amazon.com/' },
  { id: 'duckduckgo', name: 'DuckDuckGo', triggers: ['ddg', 'duck'], url: 'https://duckduckgo.com/?q=%s', home: 'https://duckduckgo.com/' },
  { id: 'reddit', name: 'Reddit', triggers: ['r', 'reddit'], url: 'https://www.reddit.com/search/?q=%s', home: 'https://www.reddit.com/' },
  { id: 'x', name: 'X', triggers: ['x', 'tw', 'twitter'], url: 'https://x.com/search?q=%s', home: 'https://x.com/' },
  { id: 'imdb', name: 'IMDb', triggers: ['imdb'], url: 'https://www.imdb.com/find/?q=%s', home: 'https://www.imdb.com/' },
  { id: 'spotify', name: 'Spotify', triggers: ['sp', 'spotify'], url: 'https://open.spotify.com/search/%s', home: 'https://open.spotify.com/' },
  {
    id: 'translate',
    name: 'Google Translate',
    triggers: ['tr', 'translate'],
    url: 'https://translate.google.com/?sl=auto&tl=en&text=%s&op=translate',
    home: 'https://translate.google.com/',
  },
  { id: 'images', name: 'Google Images', triggers: ['img', 'images'], url: 'https://www.google.com/search?tbm=isch&q=%s', home: 'https://images.google.com/' },
  { id: 'news', name: 'Google News', triggers: ['news'], url: 'https://news.google.com/search?q=%s', home: 'https://news.google.com/' },
  { id: 'wolfram', name: 'Wolfram Alpha', triggers: ['wa', 'wolfram'], url: 'https://www.wolframalpha.com/input?i=%s', home: 'https://www.wolframalpha.com/' },
  { id: 'hackernews', name: 'Hacker News', triggers: ['hn'], url: 'https://hn.algolia.com/?q=%s', home: 'https://news.ycombinator.com/' },
  {
    id: 'webstore',
    name: 'Chrome Web Store',
    triggers: ['cws', 'webstore'],
    url: 'https://chromewebstore.google.com/search/%s',
    home: 'https://chromewebstore.google.com/',
  },
  { id: 'gmail', name: 'Gmail', triggers: ['gmail', 'mail'], url: 'https://mail.google.com/mail/u/0/#search/%s', home: 'https://mail.google.com/' },
  { id: 'drive', name: 'Google Drive', triggers: ['drive'], url: 'https://drive.google.com/drive/search?q=%s', home: 'https://drive.google.com/' },
  { id: 'ebay', name: 'eBay', triggers: ['ebay'], url: 'https://www.ebay.com/sch/i.html?_nkw=%s', home: 'https://www.ebay.com/' },
  { id: 'pypi', name: 'PyPI', triggers: ['pypi'], url: 'https://pypi.org/search/?q=%s', home: 'https://pypi.org/' },
  { id: 'crates', name: 'crates.io', triggers: ['crates'], url: 'https://crates.io/search?q=%s', home: 'https://crates.io/' },
  { id: 'caniuse', name: 'Can I use', triggers: ['caniuse'], url: 'https://caniuse.com/?search=%s', home: 'https://caniuse.com/' },
  {
    id: 'dictionary',
    name: 'Dictionary',
    triggers: ['dict', 'define'],
    url: 'https://www.merriam-webster.com/dictionary/%s',
    home: 'https://www.merriam-webster.com/',
  },
];

const BY_TRIGGER = new Map<string, Bang>();
for (const b of BANGS) for (const t of b.triggers) if (!BY_TRIGGER.has(t)) BY_TRIGGER.set(t, b);

export const BANG_BY_ID = Object.fromEntries(BANGS.map((b) => [b.id, b])) as Record<string, Bang>;

/**
 * The user's own searchable quicklinks, merged into every lookup below (chips, `!alias`, completion). The built-in table
 * always wins: a custom alias equal to a built-in trigger is simply never found (creating one is refused up front).
 */
let customBangs: readonly Bang[] = [];
let customByTrigger = new Map<string, Bang>();
let customById = new Map<string, Bang>();

/** Replace the user's quicklink bangs (the commands store calls this whenever its quicklinks change). */
export function setCustomBangs(list: readonly Bang[]): void {
  customBangs = list;
  customByTrigger = new Map();
  customById = new Map();
  for (const b of list) {
    customById.set(b.id, b);
    for (const t of b.triggers) if (!customByTrigger.has(t)) customByTrigger.set(t, b);
  }
}

export const getCustomBangs = (): readonly Bang[] => customBangs;

export const bangById = (id: string): Bang | undefined => BANG_BY_ID[id] ?? customById.get(id);

export const findBang = (trigger: string): Bang | undefined => {
  const t = trigger.trim().toLowerCase();
  return BY_TRIGGER.get(t) ?? customByTrigger.get(t);
};

/** Does opening this bang need the clipboard's text (a custom `{clipboard}` address)? */
export const bangNeedsClipboard = (bang: Bang): boolean => Boolean(bang.custom) && usesClipboard(bang.url);

/**
 * The URL that searches `bang` for `query` (or just opens the site when there's nothing to search for). A custom bang's
 * template is filled in the same way; its `{clipboard}` needs the text that was read from the clipboard.
 */
export function bangUrl(bang: Bang, query: string, clipboard = ''): string {
  const q = query.trim();
  if (bang.custom) {
    if (!q && hasPlaceholder(bang.url, 'query')) return bang.home;
    return expandUrlTemplate(bang.url, { query: q, clipboard });
  }
  return q ? bang.url.replace('%s', encodeURIComponent(q)) : bang.home;
}

export type ParsedBang = { bang: Bang; rest: string; style: 'prefix' | 'suffix' };

/** `!yt lofi` → YouTube / "lofi"; `lofi !yt` → the same; `!yt` → YouTube / "". Unknown bangs are left alone (`!important`). */
export function parseBang(input: string): ParsedBang | null {
  const text = input.trim();
  const pre = /^!([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(text);
  if (pre) {
    const bang = findBang(pre[1] ?? '');
    if (bang) return { bang, rest: (pre[2] ?? '').trim(), style: 'prefix' };
  }
  const suf = /^([\s\S]+?)\s+!([a-z0-9][a-z0-9-]*)$/i.exec(text);
  if (suf) {
    const bang = findBang(suf[2] ?? '');
    if (bang) return { bang, rest: (suf[1] ?? '').trim(), style: 'suffix' };
  }
  return null;
}

/** `gh react` where `gh` is one of the user's own quicklink aliases: the alias, then the text that fills `{query}`. */
export function parseCustomAlias(input: string): { bang: Bang; rest: string } | null {
  const m = /^([a-z0-9][a-z0-9-]*)\s+([\s\S]+)$/i.exec(input.trim());
  const bang = m ? customByTrigger.get((m[1] ?? '').toLowerCase()) : undefined;
  // a built-in trigger of the same name keeps meaning "plain text" (`gh react` is only a chip when `gh` is the user's own)
  if (!m || !bang || BY_TRIGGER.has((m[1] ?? '').toLowerCase())) return null;
  return { bang, rest: (m[2] ?? '').trim() };
}

/**
 * What Tab should turn into a chip: `!yt lofi` (any bang), a bare `yt`/`youtube`/`gh`… typed with two or more
 * letters, or the user's own alias followed by text (`jira PACT-12`). Returns the bang plus whatever text follows it.
 */
export function chipFor(input: string): { bang: Bang; rest: string } | null {
  const parsed = parseBang(input);
  if (parsed) return { bang: parsed.bang, rest: parsed.rest };
  const own = parseCustomAlias(input);
  if (own) return own;
  const bare = input.trim().toLowerCase();
  if (bare.length >= 2 && !/\s/.test(bare)) {
    const bang = findBang(bare);
    if (bang) return { bang, rest: '' };
  }
  return null;
}

/** Built-in bangs whose trigger or name starts with `prefix` — for typing `!y…` or `youtu…`. (The user's own are offered by the commands provider.) */
export function bangsMatching(prefix: string): Bang[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  return BANGS.filter((b) => b.triggers.some((t) => t.startsWith(p)) || b.name.toLowerCase().startsWith(p));
}
