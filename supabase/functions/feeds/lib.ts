/**
 * Pure helpers for the feeds function (no Deno APIs, so they are unit-tested from the app's test suite).
 *
 * The function fetches feed URLs on behalf of signed-in people and turns RSS 2.0 / Atom / RSS 1.0 (RDF) into one plain
 * JSON shape. Two jobs matter most here:
 *   1. it must never be pointable at the server's own network (SSRF) — the address checks below are the ones
 *      link-preview uses, tightened to https only;
 *   2. the parser reads *hostile* input (a person can add any URL as a custom feed), so every scan is linear-time and
 *      bounded: no regex that can backtrack on attacker-chosen text, no recursion, hard caps on sizes and counts.
 *
 * Feed HTML is passed on mostly raw (script/style/iframe removed): the app sanitises it again with an allow-list before
 * showing it, so this module only has to make the payload smaller and safer, not perfectly clean.
 */

// ── limits ───────────────────────────────────────────────────────────────────

export const MAX_URLS = 12;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
/** Never read more than this from a feed (a bigger one is cut — complete items before the cut are still used). */
export const MAX_BODY_BYTES = 1_500_000;
export const MAX_CONTENT_CHARS = 40_000;
export const MAX_SUMMARY_CHARS = 300;
/** Per feed: the combined size of `contentHtml` kept, so one response can't balloon (later items lose their body, keep their summary). */
export const CONTENT_BUDGET_PER_FEED = 150_000;
const MAX_ITEMS_SCANNED = 300;
const MAX_ITEMS_KEPT = 60;
const MAX_FIELD_PRESCAN = 400_000;

// ── SSRF: which addresses may be fetched ─────────────────────────────────────

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
  // Allow-list, not block-list: only global unicast 2000::/3 can be a public host (see link-preview for the reasoning).
  if ((first & 0xe000) !== 0x2000) return true;
  return (
    first === 0x2002 || // 6to4 (embeds an IPv4 address)
    (first === 0x2001 && second === 0) || // Teredo (also embeds one)
    (first === 0x2001 && second === 0xdb8) // documentation
  );
}

export const isIPv4Literal = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
export const isIPv6Literal = (h: string) => h.includes(':');

/** Hostnames that are never worth fetching, whatever they resolve to. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.lan') ||
    h.endsWith('.home.arpa') ||
    (!h.includes('.') && !isIPv6Literal(h))
  );
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Static checks that need no network: https only, no credentials, standard port, no literal private IPs or internal names. */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https' };
  if (url.username || url.password) return { ok: false, reason: 'credentials in URL' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'unusual port' };
  const host = url.hostname;
  if (isIPv4Literal(host)) return isPrivateIPv4(host) ? { ok: false, reason: 'private address' } : { ok: true, url };
  if (isIPv6Literal(host)) return isPrivateIPv6(host) ? { ok: false, reason: 'private address' } : { ok: true, url };
  if (isBlockedHostname(host)) return { ok: false, reason: 'internal hostname' };
  return { ok: true, url };
}

/** After DNS: every address the name resolves to must be public (one private answer is enough to refuse). */
export const addressesArePublic = (addrs: string[]): boolean =>
  addrs.length > 0 && addrs.every((a) => (isIPv4Literal(a) ? !isPrivateIPv4(a) : !isPrivateIPv6(a)));

/** Only XML-ish answers are read as feeds. */
export function isFeedContentType(contentType: string | null | undefined): boolean {
  const t = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return t.endsWith('xml') || t === 'application/rss' || t === 'application/atom';
}

/** Which text encoding to decode a feed with: the HTTP header wins, then the XML declaration, then UTF-8. */
export function detectCharset(contentType: string | null | undefined, head: string): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]{1,40})/i.exec(contentType ?? '')?.[1];
  const fromXml = /^\s*<\?xml[^>]{0,200}?encoding\s*=\s*["']([\w.:-]{1,40})["']/i.exec(head.slice(0, 300))?.[1];
  return (fromHeader ?? fromXml ?? 'utf-8').toLowerCase();
}

/** Validate the request's URL list: https public hosts only, de-duplicated, capped. */
export function cleanUrls(input: unknown): { urls: string[]; rejected: Array<{ url: string; reason: string }> } {
  const urls: string[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];
  if (!Array.isArray(input)) return { urls, rejected };
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_URLS)) {
    if (typeof raw !== 'string' || raw.length > 2000) {
      rejected.push({ url: typeof raw === 'string' ? raw.slice(0, 80) : '', reason: 'invalid_url' });
      continue;
    }
    const check = checkUrl(raw.trim());
    if (!check.ok) {
      rejected.push({ url: raw.slice(0, 200), reason: 'invalid_url' });
      continue;
    }
    check.url.hash = '';
    const href = check.url.toString();
    if (!seen.has(href)) {
      seen.add(href);
      urls.push(href);
    }
  }
  return { urls, rejected };
}

export function cleanLimit(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

// ── text helpers ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  sbquo: '‚',
  bdquo: '„',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  divide: '÷',
  laquo: '«',
  raquo: '»',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  ccedil: 'ç',
  szlig: 'ß',
  shy: '',
  zwj: '',
  zwnj: '',
};

const safeCodePoint = (n: number) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '');

/** Decode the XML/HTML entities that show up in feeds (numeric ones always, named ones from a table of the common set). */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n: string) => safeCodePoint(Number.parseInt(n, 16)))
    .replace(/&#(\d{1,7});/g, (_, n: string) => safeCodePoint(Number(n)))
    .replace(/&([a-z][a-z0-9]{1,8});/gi, (m, n: string) => ENTITIES[n] ?? ENTITIES[n.toLowerCase()] ?? m);
}

/** The text of an element: CDATA taken literally, everything else entity-decoded once. */
export function xmlText(raw: string): string {
  if (!raw.includes('<![CDATA[')) return decodeEntities(raw);
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const s = raw.indexOf('<![CDATA[', i);
    if (s < 0) {
      out += decodeEntities(raw.slice(i));
      break;
    }
    out += decodeEntities(raw.slice(i, s));
    const e = raw.indexOf(']]>', s + 9);
    if (e < 0) {
      out += raw.slice(s + 9);
      break;
    }
    out += raw.slice(s + 9, e);
    i = e + 3;
  }
  return out;
}

// These patterns are built from character codes on purpose: written as \u escapes in a regex literal, the invisible
// characters (U+2028/U+2029 especially) can get materialised when source passes through a tool, and a literal line
// separator inside a regex literal is a syntax error.
const cp = String.fromCharCode;
/** Zero-width / bidi marks, line and paragraph separators, BOM and soft hyphen. */
const INVISIBLE = new RegExp(`[${cp(0x200b)}-${cp(0x200f)}${cp(0x2028)}${cp(0x2029)}${cp(0xfeff)}${cp(0xad)}]`, 'g');
/** C0 control characters except tab, newline and carriage return, plus DEL. */
const CONTROL = new RegExp(`[${cp(0)}-${cp(8)}${cp(0xb)}${cp(0xc)}${cp(0xe)}-${cp(0x1f)}${cp(0x7f)}]`, 'g');
const NBSP = new RegExp(cp(0xa0), 'g');

const collapse = (s: string) => s.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

// Case-insensitive matching without toLowerCase() (which can change a string's length and so shift every index).
const lowerCode = (c: number) => (c >= 65 && c <= 90 ? c + 32 : c);
function startsWithCI(s: string, needle: string, at: number): boolean {
  if (at < 0 || at + needle.length > s.length) return false;
  for (let k = 0; k < needle.length; k++) if (lowerCode(s.charCodeAt(at + k)) !== needle.charCodeAt(k)) return false;
  return true;
}
function indexOfCI(s: string, needle: string, from: number): number {
  let i = s.indexOf('<', from);
  while (i >= 0) {
    if (startsWithCI(s, needle, i)) return i;
    i = s.indexOf('<', i + 1);
  }
  return -1;
}
const isBoundary = (s: string, i: number) => {
  if (i >= s.length) return true;
  const c = s.charCodeAt(i);
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 47 || c === 62;
};
const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/** The end of a start tag (the `>`), honouring quoted attribute values; -1 if it isn't there within a sane distance. */
function findTagEnd(s: string, from: number): number {
  let quote = 0;
  const stop = Math.min(s.length, from + 4000);
  for (let i = from; i < stop; i++) {
    const c = s.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 62) return i;
  }
  return -1;
}

// ── HTML: removing what must never be forwarded ──────────────────────────────

const DANGEROUS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template']);

function tagNameAt(s: string, at: number): string {
  let j = at;
  while (j < s.length && j - at < 12 && isLetter(s.charCodeAt(j))) j++;
  return s.slice(at, j).toLowerCase();
}

function removeDangerousOnce(html: string): string {
  let out = '';
  let last = 0;
  let i = 0;
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    const name = tagNameAt(html, lt + 1);
    if (name && DANGEROUS.has(name) && isBoundary(html, lt + 1 + name.length)) {
      out += html.slice(last, lt);
      const tagEnd = findTagEnd(html, lt + 1 + name.length);
      const selfClosing = tagEnd > 0 && html.charCodeAt(tagEnd - 1) === 47;
      if (name === 'embed' || selfClosing) {
        // void or self-closed: only the tag itself goes
        last = i = tagEnd < 0 ? html.length : tagEnd + 1;
        continue;
      }
      const closeAt = indexOfCI(html, `</${name}`, lt + 1 + name.length);
      if (closeAt < 0) {
        // like a browser: an unclosed <script>/<style>/<iframe> swallows the rest of the document
        last = html.length;
        i = html.length;
        break;
      }
      const gt = html.indexOf('>', closeAt);
      last = i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    i = lt + 1;
  }
  return out + html.slice(last);
}

/** Remove script/style/iframe/object/embed/applet/template blocks (repeats, so `<scr<script></script>ipt>` can't re-form one). */
export function stripDangerousHtml(html: string): string {
  let cur = html.replace(CONTROL, '');
  for (let pass = 0; pass < 4; pass++) {
    const next = removeDangerousOnce(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

const BLOCK_TAGS = new Set(['p', 'div', 'br', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'td', 'th', 'table', 'figure', 'figcaption', 'hr', 'section', 'article']);

/** Plain text of some HTML, stopping early once `max` characters are in hand. Linear time whatever the input looks like. */
export function htmlToText(html: string, max = Number.POSITIVE_INFINITY): string {
  const s = stripDangerousHtml(html);
  let out = '';
  let i = 0;
  let gt = -1;
  while (i < s.length && out.length < max) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, lt);
    const c = s.charCodeAt(lt + 1);
    if (!(isLetter(c) || c === 47 || c === 33 || c === 63)) {
      out += '<'; // a lone "<" in the text ("a < b")
      i = lt + 1;
      continue;
    }
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end < 0) break; // an unterminated comment swallows the rest
      i = end + 3;
      continue;
    }
    if (gt < lt) gt = s.indexOf('>', lt);
    if (gt < 0) {
      out += s.slice(lt); // no tag can end anywhere after this
      break;
    }
    if (gt - lt > 2000) {
      out += '<';
      i = lt + 1;
      continue;
    }
    const name = tagNameAt(s, c === 47 ? lt + 2 : lt + 1);
    if (BLOCK_TAGS.has(name)) out += ' ';
    i = gt + 1;
  }
  return collapse(decodeEntities(out).replace(NBSP, ' '));
}

export const countWords = (text: string): number => (text ? text.split(' ').length : 0);

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return `${cut.replace(/[\s,;:.\-–—]+$/, '')}…`;
}

/** Cut HTML to `max` characters at a block boundary, never inside a tag or an entity. */
export function clipHtml(html: string, max = MAX_CONTENT_CHARS): string {
  if (html.length <= max) return html;
  let cut = html.slice(0, max);
  let best = -1;
  const re = /<\/(?:p|li|ul|ol|blockquote|pre|figure|h[1-6]|table|div)>/gi;
  for (let m = re.exec(cut); m; m = re.exec(cut)) best = m.index + m[0].length;
  if (best > max * 0.4) return cut.slice(0, best);
  const lt = cut.lastIndexOf('<');
  if (lt > cut.lastIndexOf('>')) cut = cut.slice(0, lt);
  return cut.replace(/&[#a-z0-9]{0,8}$/i, '');
}

// ── a small tolerant XML reader ──────────────────────────────────────────────

export type El = { name: string; attrs: string; inner: string };

const isNameCode = (c: number) => isLetter(c) || (c >= 48 && c <= 57) || c === 58 || c === 95 || c === 45 || c === 46;

/** The matching end tag of `<name>` that starts at `from` (after its start tag), skipping CDATA and comments. */
function findClose(xml: string, name: string, from: number, budget: { left: number }): { start: number; end: number } | null {
  const open = `<${name}`;
  const close = `</${name}`;
  let depth = 1;
  let i = from;
  for (;;) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) return null;
    budget.left -= lt - i + 1;
    if (budget.left < 0) return null;
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      if (e < 0) return null;
      i = e + 3;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      if (e < 0) return null;
      i = e + 3;
      continue;
    }
    if (startsWithCI(xml, close, lt) && isBoundary(xml, lt + close.length)) {
      depth--;
      const gt = xml.indexOf('>', lt + close.length);
      const end = gt < 0 ? xml.length : gt + 1;
      if (depth === 0) return { start: lt, end };
      i = end;
      continue;
    }
    if (startsWithCI(xml, open, lt) && isBoundary(xml, lt + open.length)) {
      const gt = findTagEnd(xml, lt + open.length);
      if (gt >= 0 && xml.charCodeAt(gt - 1) !== 47) depth++;
      i = gt >= 0 ? gt + 1 : lt + 1;
      continue;
    }
    i = lt + 1;
  }
}

/**
 * The direct children of an XML fragment: `{ name (lower-cased, with its prefix), raw attribute text, raw inner text }`.
 * An element whose end tag never comes (a cut-off feed) is skipped but its children are still read.
 */
export function childElements(xml: string, max = 600): El[] {
  const out: El[] = [];
  const n = xml.length;
  const budget = { left: n * 4 + 100_000 };
  let i = 0;
  while (i < n && out.length < max && budget.left > 0) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      i = e < 0 ? n : e + 3;
      continue;
    }
    const next = xml.charCodeAt(lt + 1);
    if (next === 47 || next === 63 || next === 33) {
      const e = xml.indexOf('>', lt + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    let j = lt + 1;
    while (j < n && isNameCode(xml.charCodeAt(j))) j++;
    if (j === lt + 1) {
      i = lt + 1; // a stray "<"
      continue;
    }
    const name = xml.slice(lt + 1, j).toLowerCase();
    const gt = findTagEnd(xml, j);
    if (gt < 0) {
      i = lt + 1;
      continue;
    }
    if (xml.charCodeAt(gt - 1) === 47) {
      out.push({ name, attrs: xml.slice(j, gt - 1), inner: '' });
      i = gt + 1;
      continue;
    }
    const close = findClose(xml, name, gt + 1, budget);
    if (!close) {
      i = gt + 1;
      continue;
    }
    out.push({ name, attrs: xml.slice(j, gt), inner: xml.slice(gt + 1, close.start) });
    i = close.end;
  }
  return out;
}

export function parseAttrs(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const src = attrs.slice(0, 4000);
  const re = /([\w:.-]{1,40})\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const k = (m[1] as string).toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return out;
}

// ── items ────────────────────────────────────────────────────────────────────

export type Item = {
  id: string;
  title: string;
  url: string;
  summary: string;
  /** Raw HTML from the feed (script/style/iframe removed, ≤ 40 KB). The app sanitises it again before showing it. */
  contentHtml: string;
  image: string | null;
  author: string;
  publishedAt: string | null;
  categories: string[];
  /** Word count of the full text when the feed carries one (0 = only a summary), for the "N min read" label. */
  words: number;
};

export type ParsedFeed = { title: string; items: Item[] };

/** 53-bit string hash (cyrb53) — stable across runs and platforms, which is all an id needs. */
export function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const TRACKING_PARAM = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid|igshid|traffic_source|ref|ref_src|cmp|cmpid|ncid|ocid|maca|at_medium|at_campaign|at_custom\d|referrer|share|rss|xtor|ftag)$/i;

/** The article's address without analytics parameters (`?utm_source=rss`, BBC's `at_medium`…) — the same page, minus the tracking. */
export function cleanArticleUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}

/** One article, one key: no fragment, no tracking parameters, lower-case host, no trailing slash. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(cleanArticleUrl(raw));
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return raw;
  }
}

export const itemId = (key: string): string => hash53(canonicalUrl(key)).toString(36);

/** An https URL on a public-looking host, or null. `http:` is upgraded (every browser would block it as mixed content anyway). */
export function httpsUrl(raw: string | undefined | null, base?: string): string | null {
  const s = (raw ?? '').trim();
  if (!s || s.length > 2000 || /^(?:data|javascript|vbscript|blob|file):/i.test(s)) return null;
  try {
    const u = new URL(s.startsWith('//') ? `https:${s}` : s, base);
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:') return null;
    const checked = checkUrl(u.toString());
    return checked.ok ? checked.url.toString() : null;
  } catch {
    return null;
  }
}

const first = (els: El[], ...names: string[]): El | undefined => {
  for (const n of names) {
    const hit = els.find((e) => e.name === n);
    if (hit) return hit;
  }
  return undefined;
};

/** Parse a date in any of the formats feeds use; a date in the future is clamped to now, nonsense becomes null. */
export function parseDate(raw: string | undefined | null, now = Date.now()): string | null {
  const s = (raw ?? '').trim();
  if (!s || s.length > 64) return null;
  let t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  if (t > now + 10 * 60_000) t = now;
  if (t < Date.UTC(1990, 0, 1)) return null;
  return new Date(t).toISOString();
}

const TINY_OR_TRACKING = /(?:\/undefined(?:[?#]|$)|\/null(?:[?#]|$)|\/pixel|\/beacon|\/tracker|tracking|\/track\/|feeds\.feedburner\.com\/~r\/|feedsportal|\/~\/i\/|doubleclick|googleadservices|\/wp-includes\/images\/smilies\/)/i;

/** The first usable picture in some HTML: skips data: URIs, 1×1 pixels and the well-known counters. */
export function firstImage(html: string, base?: string): string | null {
  let at = 0;
  for (let guard = 0; guard < 60; guard++) {
    const i = indexOfCI(html, '<img', at);
    if (i < 0) return null;
    const gt = findTagEnd(html, i + 4);
    if (gt < 0) return null;
    at = gt + 1;
    if (!isBoundary(html, i + 4)) continue;
    const a = parseAttrs(html.slice(i + 4, gt));
    const w = Number.parseInt(a.width ?? '', 10);
    const h = Number.parseInt(a.height ?? '', 10);
    if ((Number.isFinite(w) && w <= 3) || (Number.isFinite(h) && h <= 3)) continue;
    // lazy-loading plugins park a placeholder (often a data: URI) in `src` and the real address in a data-* attribute
    for (const candidate of [a.src, a['data-src'], a['data-lazy-src'], a['data-original']]) {
      const src = httpsUrl(candidate, base);
      if (src && !TINY_OR_TRACKING.test(src)) return src;
    }
  }
  return null;
}

const isImageType = (type: string | undefined, url: string) => (type ? type.toLowerCase().startsWith('image/') : /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(url));

/** The best picture the item's media tags offer: the widest `media:content`, else the widest thumbnail, else an image enclosure. */
function mediaImage(els: El[], base: string): string | null {
  const pool: El[] = [];
  const add = (list: El[]) => {
    for (const e of list) {
      if (e.name === 'media:group') add(childElements(e.inner, 40));
      else pool.push(e);
    }
  };
  add(els);
  const best = (names: string[], accept: (a: Record<string, string>, url: string) => boolean): string | null => {
    let pick: { url: string; width: number } | null = null;
    for (const e of pool) {
      if (!names.includes(e.name)) continue;
      const a = parseAttrs(e.attrs);
      const url = httpsUrl(a.url ?? a.href, base);
      if (!url || !accept(a, url) || TINY_OR_TRACKING.test(url)) continue;
      const width = Number.parseInt(a.width ?? '', 10) || 0;
      if (!pick || width > pick.width) pick = { url, width };
    }
    return pick?.url ?? null;
  };
  return (
    best(['media:content'], (a, url) => a.medium === 'image' || (a.medium !== 'video' && a.medium !== 'audio' && isImageType(a.type, url))) ??
    best(['media:thumbnail'], () => true) ??
    best(['enclosure'], (a, url) => isImageType(a.type, url) && !(a.type ?? '').toLowerCase().startsWith('video')) ??
    best(['itunes:image'], () => true)
  );
}

/** Publishers that ship a postage-stamp thumbnail in the feed but serve bigger versions of the same file from the same path. */
export function upgradeImage(url: string | null): string | null {
  if (!url) return url;
  return (
    url
      // BBC: /ace/standard/240/… → /ace/standard/800/… (the feed only lists the 240 px one)
      .replace(/^(https:\/\/ichef\.bbci\.co\.uk\/(?:ace\/(?:standard|ws)|news)\/)(?:\d{2,3})(\/)/, '$1800$2')
      // NPR's CDN is asked for the original size (3000 px and up) — a card never needs more than 1200
      .replace(/(\/resize\/)(\d{4,5})x(\d{3,5})(!)/, (m, pre: string, w: string, h: string, bang: string) =>
        Number(w) > 1200 ? `${pre}1200x${Math.round((Number(h) * 1200) / Number(w))}${bang}` : m,
      )
  );
}

/** A bare `<image>` on the item (CBS, Healthline): its text is the URL, or it wraps a `<url>`. */
function imageElement(els: El[], base: string): string | null {
  const e = first(els, 'image');
  if (!e) return null;
  const nested = first(childElements(e.inner, 8), 'url');
  return httpsUrl(xmlText((nested ?? e).inner), base);
}

function plainAuthor(raw: string): string {
  let s = htmlToText(xmlText(raw), 200);
  s = s.replace(/^by\s+/i, '');
  // "name@host.tld (Real Name)" is the RSS convention; keep the part a person would read
  const paren = /\(([^)]{2,60})\)/.exec(s)?.[1];
  if (paren && s.includes('@')) s = paren;
  s = s.replace(/\S+@\S+/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 80);
}

function findAuthor(els: El[]): string {
  const names: string[] = [];
  for (const e of els) {
    if (names.length >= 3) break;
    if (e.name === 'dc:creator' || e.name === 'itunes:author') names.push(plainAuthor(e.inner));
    else if (e.name === 'author') {
      const nested = first(childElements(e.inner, 10), 'name');
      names.push(plainAuthor(nested ? nested.inner : e.inner));
    }
  }
  const unique = [...new Set(names.filter(Boolean))];
  return unique.join(', ').slice(0, 80);
}

function findCategories(els: El[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of els) {
    if (e.name !== 'category' && e.name !== 'dc:subject') continue;
    const label = collapse(htmlToText(e.inner ? xmlText(e.inner) : (parseAttrs(e.attrs).term ?? ''), 60)).slice(0, 40);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 5) break;
  }
  return out;
}

/** The HTML of a body element: xhtml bodies are literal markup, everything else is escaped text or CDATA. */
function bodyHtml(e: El | undefined): string {
  if (!e) return '';
  const type = (parseAttrs(e.attrs).type ?? '').toLowerCase();
  const raw = e.inner.slice(0, MAX_FIELD_PRESCAN);
  if (type === 'xhtml') return raw;
  const text = xmlText(raw);
  if (type === 'text') return `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`;
  return text;
}

function itemLink(els: El[], base: string): string | null {
  const orig = first(els, 'feedburner:origlink', 'feedflare:origlink');
  const origUrl = orig ? httpsUrl(xmlText(orig.inner), base) : null;
  if (origUrl) return origUrl;

  for (const e of els) {
    if (e.name !== 'link') continue;
    const a = parseAttrs(e.attrs);
    if (a.href) {
      const rel = (a.rel ?? 'alternate').toLowerCase();
      if (rel === 'alternate' || rel === '') {
        const u = httpsUrl(a.href, base);
        if (u) return u;
      }
    } else {
      const u = httpsUrl(xmlText(e.inner), base);
      if (u) return u;
    }
  }
  // Atom without rel=alternate: any link that is not obviously something else
  for (const e of els) {
    if (e.name !== 'link') continue;
    const a = parseAttrs(e.attrs);
    if (a.href && !/^(?:self|enclosure|replies|edit|related|via)$/i.test(a.rel ?? '')) {
      const u = httpsUrl(a.href, base);
      if (u) return u;
    }
  }
  const guid = first(els, 'guid', 'id');
  if (guid && parseAttrs(guid.attrs).ispermalink !== 'false') return httpsUrl(xmlText(guid.inner), base);
  return null;
}

const BOILERPLATE_TAIL = /\s*(?:Continue reading|Read more|Read the full (?:story|article|post)|Click here to read more|View full post)\b[^.!?]{0,80}$/i;
const POST_APPEARED = /\s*The (?:post|article|entry) .{1,200}? appeared first on .{1,100}$/i;

/** One or two plain sentences: no markup, no "Read more" / "appeared first on" boilerplate, never longer than 300 characters. */
function makeSummary(sources: string[], title: string): string {
  let text = '';
  for (const html of sources) {
    text = htmlToText(html, 900);
    if (text.length >= 20) break;
  }
  text = text.replace(POST_APPEARED, '').replace(/\s*\[(?:…|\.\.\.|&hellip;)\]\s*$/, '…').replace(BOILERPLATE_TAIL, '').trim();
  const t = title.toLowerCase();
  const lower = text.toLowerCase();
  if (lower === t) text = '';
  else if (lower.startsWith(t) && text.length > t.length + 20) text = text.slice(title.length).replace(/^[\s:–—.-]+/, '');
  return clipText(text, MAX_SUMMARY_CHARS);
}

/** hnrss.org's description is link boilerplate ("Article URL: … Points: 11 # Comments: 4") — show the numbers instead. */
function hackerNewsSummary(descHtml: string): string | null {
  if (!/Article URL:|Comments URL:/.test(descHtml)) return null;
  const text = htmlToText(descHtml, 1200);
  const points = /Points:\s*(\d+)/.exec(text)?.[1];
  const comments = /# Comments:\s*(\d+)/.exec(text)?.[1];
  if (points === undefined && comments === undefined) return '';
  return [points !== undefined ? `${points} points` : '', comments !== undefined ? `${comments} comments` : ''].filter(Boolean).join(' · ');
}

export function parseItem(els: El[], base: string, now: number): Item | null {
  const link = itemLink(els, base);
  const url = link ? cleanArticleUrl(link) : null;
  const titleEl = first(els, 'title');
  const title = collapse(htmlToText(titleEl ? xmlText(titleEl.inner.slice(0, 4000)) : '', 400)).slice(0, 300);
  if (!url || !title) return null;

  const contentEl = first(els, 'content:encoded', 'content');
  const descEl = first(els, 'description', 'summary');
  const contentRaw = bodyHtml(contentEl);
  const descRaw = bodyHtml(descEl);

  let content = contentRaw ? stripDangerousHtml(contentRaw) : '';
  // Some feeds put the whole article in <description>: when it is long, it is the body.
  if (!content && descRaw.length > 600) {
    const candidate = stripDangerousHtml(descRaw);
    if (countWords(htmlToText(candidate)) >= 100) content = candidate;
  }
  let words = content ? countWords(htmlToText(content)) : 0;
  if (words < 40) {
    // a teaser, not an article: "summary + Read the full article" is the honest presentation
    content = '';
    words = 0;
  }

  const hn = hackerNewsSummary(descRaw);
  const summary = hn ?? makeSummary([descRaw, content], title);

  // (look in the raw body too: a teaser-length body is dropped above, but its picture is still the item's picture)
  const image = upgradeImage(mediaImage(els, base) ?? firstImage(contentRaw || descRaw, url) ?? imageElement(els, base));

  return {
    id: itemId(url),
    title,
    url,
    summary,
    contentHtml: clipHtml(content),
    image,
    author: findAuthor(els),
    publishedAt: parseDate(
      xmlText((first(els, 'pubdate', 'dc:date', 'published', 'updated', 'dcterms:issued', 'dcterms:created', 'a10:updated', 'date')?.inner ?? '').slice(0, 100)),
      now,
    ),
    categories: findCategories(els),
    words,
  };
}

/** Which kind of document is this? The first real element decides; an HTML page or anything else is `null`. */
export function detectKind(xml: string): 'rss' | 'atom' | 'rdf' | null {
  let i = 0;
  for (let guard = 0; guard < 40; guard++) {
    const lt = xml.indexOf('<', i);
    if (lt < 0 || lt > 20_000) return null;
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      if (e < 0) return null;
      i = e + 3;
      continue;
    }
    const c = xml.charCodeAt(lt + 1);
    if (c === 63 || c === 33) {
      // <?xml …?> or <!DOCTYPE …> (whose internal subset may contain '>' — find the end of the declaration by quotes/brackets only loosely)
      const e = xml.indexOf('>', lt + 2);
      i = e < 0 ? xml.length : e + 1;
      continue;
    }
    const name = tagNameAt(xml, lt + 1);
    const full = xml.slice(lt + 1, lt + 12).toLowerCase();
    if (full.startsWith('rdf:rdf')) return 'rdf';
    if (name === 'rss') return 'rss';
    if (name === 'feed') return 'atom';
    return null;
  }
  return null;
}

function itemBlocks(xml: string, tag: 'item' | 'entry'): string[] {
  const out: string[] = [];
  const open = `<${tag}`;
  const close = `</${tag}`;
  let i = 0;
  while (out.length < MAX_ITEMS_SCANNED) {
    let s = xml.indexOf(open, i);
    // find a real start tag (the next char ends the name), not <items> or <entry-point>
    while (s >= 0 && !isBoundary(xml, s + open.length)) s = xml.indexOf(open, s + 1);
    if (s < 0) break;
    const gt = findTagEnd(xml, s + open.length);
    if (gt < 0) break;
    if (xml.charCodeAt(gt - 1) === 47) {
      i = gt + 1;
      continue;
    }
    const e = indexOfCI(xml, close, gt + 1);
    if (e < 0) break; // cut off mid-item (a truncated download): that one and anything after it is dropped
    out.push(xml.slice(gt + 1, e));
    const end = xml.indexOf('>', e);
    i = end < 0 ? xml.length : end + 1;
  }
  return out;
}

/** Newest first; items without a date keep their feed order and sort last. */
export function sortNewestFirst(items: Item[]): Item[] {
  return items
    .map((it, i) => ({ it, i, t: it.publishedAt ? Date.parse(it.publishedAt) : Number.NEGATIVE_INFINITY }))
    .sort((a, b) => (b.t === a.t ? a.i - b.i : b.t > a.t ? 1 : -1))
    .map((x) => x.it);
}

/** Give the newest items their bodies until `budget` characters are used up; the rest keep summary and image but not the body. */
export function applyContentBudget(items: Item[], budget = CONTENT_BUDGET_PER_FEED): Item[] {
  let left = budget;
  return items.map((it) => {
    if (!it.contentHtml) return it;
    if (it.contentHtml.length <= left) {
      left -= it.contentHtml.length;
      return it;
    }
    return { ...it, contentHtml: '' };
  });
}

/**
 * Read a feed document. Returns `null` when it isn't a feed at all (an HTML page, JSON, garbage). A feed that has been cut
 * off, or has broken items, still yields every complete valid item before the damage.
 */
export function parseFeed(xmlIn: string, feedUrl: string, now = Date.now()): ParsedFeed | null {
  const xml = xmlIn.charCodeAt(0) === 0xfeff ? xmlIn.slice(1) : xmlIn;
  const kind = detectKind(xml);
  if (!kind) return null;
  const tag = kind === 'atom' ? 'entry' : 'item';
  const blocks = itemBlocks(xml, tag);

  const firstItem = xml.indexOf(`<${tag}`);
  const head = firstItem < 0 ? xml.slice(0, 20_000) : xml.slice(Math.max(0, firstItem - 20_000), firstItem);
  const top = childElements(head, 80);
  // RSS 1.0 closes <channel> before the items, so its title is one level down
  const titleEl =
    first(
      top.filter((e) => !['image', 'textinput'].includes(e.name)),
      'title',
    ) ?? first(childElements(first(top, 'channel')?.inner ?? '', 80), 'title');
  const title = collapse(htmlToText(titleEl ? xmlText(titleEl.inner) : '', 200)).slice(0, 100);

  const base = httpsUrl(feedUrl) ?? feedUrl;
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const block of blocks) {
    const item = parseItem(childElements(block, 120), base, now);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  if (!items.length && !title) return null;
  return { title, items: applyContentBudget(sortNewestFirst(items).slice(0, MAX_ITEMS_KEPT)) };
}
