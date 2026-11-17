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

export const findBang = (trigger: string): Bang | undefined => BY_TRIGGER.get(trigger.trim().toLowerCase());

/** The URL that searches `bang` for `query` (or just opens the site when there's nothing to search for). */
export function bangUrl(bang: Bang, query: string): string {
  const q = query.trim();
  return q ? bang.url.replace('%s', encodeURIComponent(q)) : bang.home;
}

export type ParsedBang = { bang: Bang; rest: string; style: 'prefix' | 'suffix' };

/** `!yt lofi` → YouTube / "lofi"; `lofi !yt` → the same; `!yt` → YouTube / "". Unknown bangs are left alone (`!important`). */
export function parseBang(input: string): ParsedBang | null {
  const text = input.trim();
  const pre = /^!([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(text);
  if (pre) {
    const bang = findBang(pre[1] ?? '');
    if (bang) return { bang, rest: (pre[2] ?? '').trim(), style: 'prefix' };
  }
  const suf = /^([\s\S]+?)\s+!([a-z0-9]+)$/i.exec(text);
  if (suf) {
    const bang = findBang(suf[2] ?? '');
    if (bang) return { bang, rest: (suf[1] ?? '').trim(), style: 'suffix' };
  }
  return null;
}

/**
 * What Tab should turn into a chip: `!yt lofi` (any bang), or a bare `yt`/`youtube`/`gh`… typed with two or more
 * letters. Returns the bang plus whatever text follows it.
 */
export function chipFor(input: string): { bang: Bang; rest: string } | null {
  const parsed = parseBang(input);
  if (parsed) return { bang: parsed.bang, rest: parsed.rest };
  const bare = input.trim().toLowerCase();
  if (bare.length >= 2 && !/\s/.test(bare)) {
    const bang = findBang(bare);
    if (bang) return { bang, rest: '' };
  }
  return null;
}

/** Bangs whose trigger or name starts with `prefix` — for typing `!y…` or `youtu…`. */
export function bangsMatching(prefix: string): Bang[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  return BANGS.filter((b) => b.triggers.some((t) => t.startsWith(p)) || b.name.toLowerCase().startsWith(p));
}
