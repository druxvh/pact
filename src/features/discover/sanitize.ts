/**
 * Turning an article body from a feed into something safe to show.
 *
 * Feed HTML is hostile by default (anyone can publish a feed, and a person can add any address as a custom one). So it is
 * never put into the page as markup: it is parsed with `DOMParser` (an inert document — nothing runs, nothing loads),
 * walked, and only what an allow-list names is copied into a small plain tree (`SafeNode`) that React then renders as
 * elements. Nothing is ever re-serialised to a string, so there is no "mutation XSS" to worry about, and there is no
 * `dangerouslySetInnerHTML` anywhere. Attributes are never copied wholesale — each allowed tag gets only the few it needs,
 * every one validated: links must be http(s) without credentials; pictures must be https on a public-looking host.
 */

export type SafeTag =
  | 'p'
  | 'div'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'ul'
  | 'ol'
  | 'li'
  | 'blockquote'
  | 'pre'
  | 'code'
  | 'strong'
  | 'em'
  | 'b'
  | 'i'
  | 'a'
  | 'img'
  | 'figure'
  | 'figcaption'
  | 'br'
  | 'hr'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tfoot'
  | 'tr'
  | 'th'
  | 'td'
  | 'caption'
  | 'sup'
  | 'sub'
  | 'del'
  | 's'
  | 'mark'
  | 'abbr'
  | 'cite'
  | 'kbd'
  | 'small'
  | 'dl'
  | 'dt'
  | 'dd'
  | 'time';

export type SafeElement = { tag: SafeTag; attrs?: Record<string, string | number>; children: SafeNode[] };
export type SafeNode = string | SafeElement;

export const MAX_NODES = 4000;
export const MAX_DEPTH = 40;
export const MAX_TEXT = 300_000;

/** Elements removed together with everything inside them. */
const DROP = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'optgroup',
  'datalist',
  'template',
  'svg',
  'math',
  'video',
  'audio',
  'source',
  'track',
  'canvas',
  'map',
  'area',
  'link',
  'meta',
  'base',
  'title',
  'head',
  'noembed',
  'nav',
  'footer',
  'aside',
  'dialog',
  'slot',
  'portal',
  'fencedframe',
]);

/** Elements kept as themselves. */
const KEEP = new Set<string>([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'strong',
  'em',
  'b',
  'i',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'sup',
  'sub',
  'del',
  's',
  'mark',
  'abbr',
  'cite',
  'kbd',
  'small',
  'dl',
  'dt',
  'dd',
  'time',
]);

/** Elements that become a different one. (Everything not named anywhere is unwrapped: its children are kept, the element is not.) */
const RENAME: Record<string, SafeTag> = { h5: 'h4', h6: 'h4', div: 'div', section: 'div', article: 'div', main: 'div', header: 'div', figure: 'figure' };

/** Whitespace between these is layout noise, not content. */
const STRUCTURAL = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'dl']);
/** An empty one of these is removed (an empty cell is not — a table needs its shape). */
const NEVER_EMPTY = new Set(['td', 'th', 'br', 'hr']);

const TRACKING_URL =
  /(?:\/pixel|\/beacon|\/tracker|tracking|\/track\/|feeds\.feedburner\.com\/~r\/|feedsportal|\/~\/i\/|doubleclick|googleadservices|\/undefined(?:[?#]|$)|\/null(?:[?#]|$))/i;
const HIDDEN_STYLE = /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i;
const TINY_STYLE = /(?:^|;)\s*(?:width|height)\s*:\s*[0-3](?:px)?\s*(?:;|$)/i;

/** A link target: http or https, no credentials. Relative addresses are resolved against `base` (the article's address). */
export function safeHref(raw: string | null | undefined, base?: string): string | null {
  const s = (raw ?? '').trim();
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** A picture address: https (http is upgraded), no credentials, a public-looking host — never an IP address or an internal name. */
export function safeImageSrc(raw: string | null | undefined, base?: string): string | null {
  const s = (raw ?? '').trim();
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s.startsWith('//') ? `https:${s}` : s, base);
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    if (u.port && u.port !== '443') return null;
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /\.(local|localhost|internal|lan|home\.arpa)$/.test(host))
      return null;
    if (TRACKING_URL.test(u.href)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Two addresses for the same picture (size and cache parameters aside). */
export function sameImage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname === ub.hostname && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}

export type SanitizeOptions = {
  /** The article's address, for resolving relative links and pictures. */
  base?: string;
  /** A picture already shown above the text (the hero): its first appearance in the body is left out. */
  skipImage?: string | null;
};

type Ctx = { nodes: number; text: number; base: string | undefined; skipImage: string | null; skipped: boolean };

const hasContent = (children: SafeNode[]): boolean => children.some((c) => (typeof c === 'string' ? c.trim() !== '' : c.tag !== 'br' && c.tag !== 'hr'));

function dimension(v: string | null): number | null {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 && n <= 6000 ? n : null;
}

function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden')) return true;
  const style = el.getAttribute('style');
  return !!style && style.length < 2000 && HIDDEN_STYLE.test(style);
}

function image(el: Element, ctx: Ctx): SafeNode[] {
  const wRaw = el.getAttribute('width');
  const hRaw = el.getAttribute('height');
  const w = Number.parseInt(wRaw ?? '', 10);
  const h = Number.parseInt(hRaw ?? '', 10);
  const style = el.getAttribute('style') ?? '';
  // 1×1 counters and spacer pixels
  if ((Number.isFinite(w) && w <= 3) || (Number.isFinite(h) && h <= 3) || (style.length < 2000 && TINY_STYLE.test(style))) return [];
  // lazy-loading plugins keep a placeholder in `src` and the real address in a data-* attribute
  let src: string | null = null;
  for (const name of ['src', 'data-src', 'data-lazy-src', 'data-original']) {
    src = safeImageSrc(el.getAttribute(name), ctx.base);
    if (src) break;
  }
  if (!src) return [];
  if (!ctx.skipped && ctx.skipImage && sameImage(src, ctx.skipImage)) {
    ctx.skipped = true;
    return [];
  }
  ctx.nodes++;
  const attrs: Record<string, string | number> = {
    src,
    alt: (el.getAttribute('alt') ?? '').slice(0, 300),
    loading: 'lazy',
    decoding: 'async',
    referrerPolicy: 'no-referrer',
  };
  const dw = dimension(wRaw);
  const dh = dimension(hRaw);
  if (dw) attrs.width = dw;
  if (dh) attrs.height = dh;
  return [{ tag: 'img', attrs, children: [] }];
}

function walk(node: Node, depth: number, ctx: Ctx): SafeNode[] {
  const out: SafeNode[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (ctx.nodes > MAX_NODES) break;
    if (child.nodeType === 3) {
      const t = child.nodeValue ?? '';
      if (ctx.text + t.length > MAX_TEXT) break;
      ctx.text += t.length;
      out.push(t);
    } else if (child.nodeType === 1) {
      out.push(...element(child as Element, depth, ctx));
    }
  }
  return out;
}

function element(el: Element, depth: number, ctx: Ctx): SafeNode[] {
  const name = el.localName.toLowerCase();
  if (DROP.has(name) || isHidden(el)) return [];
  if (depth > MAX_DEPTH) return [(el.textContent ?? '').slice(0, 2000)];
  if (name === 'img') return image(el, ctx);
  if (name === 'br' || name === 'hr') {
    ctx.nodes++;
    return [{ tag: name, children: [] }];
  }

  const children = walk(el, depth + 1, ctx);

  if (name === 'a') {
    const href = safeHref(el.getAttribute('href'), ctx.base);
    if (!href) return children; // a link we won't follow: keep what it said
    if (!hasContent(children) && !children.some((c) => typeof c !== 'string')) return [];
    ctx.nodes++;
    return [{ tag: 'a', attrs: { href, rel: 'noopener noreferrer', target: '_blank' }, children }];
  }

  const tag = (KEEP.has(name) ? (name as SafeTag) : RENAME[name]) as SafeTag | undefined;
  if (!tag) return children; // unknown (span, picture, font, noscript, custom elements…): unwrap
  if (!NEVER_EMPTY.has(tag) && !hasContent(children) && !children.some((c) => typeof c !== 'string' && c.tag === 'img')) return [];

  const attrs: Record<string, string | number> = {};
  if (tag === 'td' || tag === 'th') {
    const cs = dimension(el.getAttribute('colspan'));
    const rs = dimension(el.getAttribute('rowspan'));
    if (cs && cs <= 20) attrs.colSpan = cs;
    if (rs && rs <= 20) attrs.rowSpan = rs;
  } else if (tag === 'ol') {
    const start = Number.parseInt(el.getAttribute('start') ?? '', 10);
    if (Number.isFinite(start) && start >= 0 && start < 100_000) attrs.start = start;
  }
  ctx.nodes++;
  return [
    {
      tag,
      ...(Object.keys(attrs).length ? { attrs } : {}),
      children: STRUCTURAL.has(tag) ? children.filter((c) => typeof c !== 'string' || c.trim() !== '') : children,
    },
  ];
}

/** The safe tree for an article body. Never throws; an unparseable or empty body gives `[]`. */
export function sanitizeHtml(html: string, opts: SanitizeOptions = {}): SafeNode[] {
  if (!html) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return [];
  }
  const ctx: Ctx = { nodes: 0, text: 0, base: opts.base, skipImage: opts.skipImage ?? null, skipped: false };
  const tree = walk(doc.body, 0, ctx);
  // trim blank text at both ends
  while (typeof tree[0] === 'string' && tree[0].trim() === '') tree.shift();
  while (typeof tree[tree.length - 1] === 'string' && (tree[tree.length - 1] as string).trim() === '') tree.pop();
  return tree;
}

/** All the text in a tree (for tests and for deciding whether a body has anything worth showing). */
export function textOf(nodes: readonly SafeNode[]): string {
  return nodes
    .map((n) => (typeof n === 'string' ? n : textOf(n.children)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
