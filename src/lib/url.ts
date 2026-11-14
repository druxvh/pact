export type ResolvedInput = { kind: 'url'; url: string } | { kind: 'search'; query: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const INTERNAL = /^(chrome|edge|brave|about|file|view-source|chrome-extension|moz-extension):\S*$/i;
const LOCAL = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])(?::\d{2,5})?(?:[/?#]\S*)?$/i;
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,})(?::\d{2,5})?(?:[/?#]\S*)?$/i;

const COMMON_TLDS = new Set([
  'com',
  'org',
  'net',
  'io',
  'dev',
  'app',
  'ai',
  'co',
  'edu',
  'gov',
  'info',
  'me',
  'tv',
  'xyz',
  'tech',
  'cloud',
  'blog',
  'site',
  'online',
  'store',
  'shop',
  'news',
  'club',
  'live',
  'design',
  'page',
  'new',
  'run',
  'so',
  'gg',
]);
// Two-letter "TLDs" that people far more often mean as file extensions.
const FILE_LIKE = new Set(['js', 'ts', 'md', 'py', 'rb', 'sh', 'cs', 'rs', 'cc', 'pl', 'ps', 'jsx', 'mjs', 'cjs']);

function isRealTld(tld: string): boolean {
  const t = tld.toLowerCase();
  if (COMMON_TLDS.has(t)) return true;
  return t.length === 2 && !FILE_LIKE.has(t);
}

/**
 * Decide whether omnibox-style input is a URL to open or text to search for.
 * `github.com`, `localhost:3000`, `https://x.dev/a?b=1` → url
 * `cat food`, `node.js`, `what is 2+2` → search
 */
export function resolveInput(raw: string): ResolvedInput {
  const text = raw.trim();
  if (!text) return { kind: 'search', query: '' };
  if (/\s/.test(text)) return { kind: 'search', query: text };

  if (SCHEME.test(text)) {
    try {
      new URL(text);
      return { kind: 'url', url: text };
    } catch {
      return { kind: 'search', query: text };
    }
  }
  if (INTERNAL.test(text)) return { kind: 'url', url: text };
  if (LOCAL.test(text)) return { kind: 'url', url: `http://${text}` };

  const m = HOSTNAME.exec(text);
  if (m && isRealTld(m[1] ?? '')) {
    try {
      new URL(`https://${text}`);
      return { kind: 'url', url: `https://${text}` };
    } catch {
      /* not a valid URL after all */
    }
  }
  return { kind: 'search', query: text };
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Normalise user-typed URLs for storage ("github.com" → "https://github.com/"). Returns null if unusable. */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const r = resolveInput(text);
  if (r.kind !== 'url') {
    // allow bare words like "example.com/path" that failed TLD checks only if URL-parsable with https
    try {
      const u = new URL(`https://${text}`);
      return u.hostname.includes('.') ? u.toString() : null;
    } catch {
      return null;
    }
  }
  try {
    return new URL(r.url).toString();
  } catch {
    return null;
  }
}
