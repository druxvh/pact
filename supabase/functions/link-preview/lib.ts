/**
 * Pure helpers for the link-preview function (no Deno APIs, so they are unit-tested from the app's test suite).
 * The function fetches arbitrary URLs on behalf of users, so the first job of this module is making sure it can never be
 * pointed at the server's own network (SSRF).
 */

/** True for any IPv4 address that is not a normal public internet address. */
export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // not a clean address → refuse
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, includes the cloud metadata address 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || // IETF protocol assignments / documentation
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for any IPv6 address that is not a normal public one (including IPv4-mapped private addresses). */
export function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (s === '::' || s === '::1') return true;
  const mapped = /^(?:0{0,4}:){0,5}(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s) ?? /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1] as string, 16);
    const lo = Number.parseInt(mappedHex[2] as string, 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const parts = s.split(':');
  const first = Number.parseInt(parts[0] || '0', 16);
  const second = Number.parseInt(parts[1] || '0', 16);
  if (Number.isNaN(first) || Number.isNaN(second)) return true;
  // Allow-list, not block-list: only global unicast 2000::/3 can be a public host. That alone refuses ::/8 (loopback,
  // IPv4-compatible forms like ::7f00:1), fc00::/7, fe80::/10, ff00::/8, NAT64 64:ff9b::/96 and everything unassigned…
  if ((first & 0xe000) !== 0x2000) return true;
  return (
    first === 0x2002 || // …6to4 (embeds an IPv4 address: 2002:7f00:1:: is 127.0.0.1)
    (first === 0x2001 && second === 0) || // Teredo (also embeds one)
    (first === 0x2001 && second === 0xdb8) // documentation
  );
}

export const isIPv4Literal = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
export const isIPv6Literal = (h: string) => h.includes(':');

/** Hostnames that are never worth fetching, whatever they resolve to. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa') || !h.includes('.') && !isIPv6Literal(h);
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Static checks that need no network: scheme, port, credentials, literal IPs and obviously-internal names. */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'only http(s)' };
  if (url.username || url.password) return { ok: false, reason: 'credentials in URL' };
  if (url.port && url.port !== '80' && url.port !== '443') return { ok: false, reason: 'unusual port' };
  const host = url.hostname;
  if (isIPv4Literal(host)) return isPrivateIPv4(host) ? { ok: false, reason: 'private address' } : { ok: true, url };
  if (isIPv6Literal(host)) return isPrivateIPv6(host) ? { ok: false, reason: 'private address' } : { ok: true, url };
  if (isBlockedHostname(host)) return { ok: false, reason: 'internal hostname' };
  return { ok: true, url };
}

/** After DNS: every address the name resolves to must be public (one private answer is enough to refuse). */
export const addressesArePublic = (addrs: string[]): boolean =>
  addrs.length > 0 && addrs.every((a) => (isIPv4Literal(a) ? !isPrivateIPv4(a) : !isPrivateIPv6(a)));

// ── reading the page ─────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => safeCodePoint(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => safeCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}
const safeCodePoint = (n: number) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '');

/** Meta tags as a map of lower-cased `property`/`name` → content (first one wins). */
export function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  // `[^>]{0,2000}` (not `[^>]*`): an unterminated "<meta " repeated thousands of times would otherwise make every
  // start scan to the end of the input — quadratic time, which a hostile page could use to pin the function's CPU.
  for (const tag of html.match(/<meta\b[^>]{0,2000}>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (key && value !== undefined && !out.has(key)) out.set(key, decodeEntities(value).trim());
  }
  return out;
}

const clip = (s: string | undefined | null, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t) : null;
};

export type PageInfo = { title: string | null; description: string | null; site: string | null; image: string | null };

/** Only the <head> carries what a preview needs, and a page can be arbitrarily large and hostile — read a bounded slice of it. */
export const HEAD_LIMIT = 128_000;

export function parsePage(html: string, pageUrl: string): PageInfo {
  const cut = html.slice(0, HEAD_LIMIT);
  const end = cut.search(/<\/head\s*>/i);
  const head = end >= 0 ? cut.slice(0, end) : cut;
  const m = metaTags(head);
  const titleTag = /<title[^>]{0,200}>([\s\S]{0,2000}?)<\/title>/i.exec(head)?.[1];
  let image: string | null = m.get('og:image') ?? m.get('og:image:url') ?? m.get('twitter:image') ?? m.get('twitter:image:src') ?? null;
  if (image) {
    try {
      image = new URL(image, pageUrl).toString();
    } catch {
      image = null;
    }
  }
  return {
    title: clip(m.get('og:title') ?? m.get('twitter:title') ?? (titleTag ? decodeEntities(titleTag) : undefined), 140),
    description: clip(m.get('og:description') ?? m.get('twitter:description') ?? m.get('description'), 240),
    site: clip(m.get('og:site_name'), 60) ?? clip(new URL(pageUrl).hostname.replace(/^www\./, ''), 60),
    image,
  };
}

/** Same page, same key: drops the fragment and lower-cases the host. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}
