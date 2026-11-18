/**
 * The pure rules behind the user's own commands (quicklinks, snippets, aliases): what an alias may look like, which
 * placeholders a URL or a snippet understands, and how they are filled in. No stores and no UI in here, so every rule
 * is unit-tested and the backup validator can share them.
 */

/** Longest alias. */
export const ALIAS_MAX = 24;
const ALIAS_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** What the person typed, as the alias it means: trimmed, lower-case, without a leading `!`. */
export const normalizeAlias = (raw: string): string => raw.trim().replace(/^!/, '').toLowerCase();

/** Why `alias` (already normalised) can't be an alias at all, ignoring other commands — or `null`. */
export function aliasFormatProblem(alias: string): string | null {
  if (!alias) return 'Type a short keyword.';
  if (alias.length > ALIAS_MAX) return `Keep it to ${ALIAS_MAX} characters or fewer.`;
  if (!ALIAS_RE.test(alias)) return 'Use lowercase letters, digits and dashes, starting and ending with a letter or digit.';
  return null;
}

export const isValidAlias = (alias: string): boolean => aliasFormatProblem(alias) === null;

/* ───────────────────────────── placeholders ───────────────────────────── */

export const URL_PLACEHOLDERS = ['query', 'clipboard'] as const;
export const SNIPPET_PLACEHOLDERS = ['date', 'time', 'datetime', 'clipboard'] as const;

const BRACES = /\{([^{}]*)\}/g;

/** The `{names}` a template uses (lower-case, in order of first use). */
export function placeholdersIn(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(BRACES)) {
    const name = (m[1] ?? '').trim().toLowerCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export const hasPlaceholder = (template: string, name: string): boolean => placeholdersIn(template).includes(name);

/* ───────────────────────────── URL templates ───────────────────────────── */

export const URL_MAX = 2048;
/** The longest clipboard text that goes into a URL. */
const CLIPBOARD_URL_MAX = 1500;

function encode(s: string): string {
  try {
    return encodeURIComponent(s);
  } catch {
    // a lone surrogate (half an emoji) can't be encoded: drop the stray halves
    return encodeURIComponent(s.replace(/[\ud800-\udfff]/g, ''));
  }
}

/** Fill `{query}` / `{clipboard}` (URL-encoded). Everything else is left exactly as written; values are never re-expanded. */
export function expandUrlTemplate(template: string, values: { query?: string; clipboard?: string }): string {
  return template.replace(BRACES, (whole, name: string) => {
    const n = name.trim().toLowerCase();
    if (n === 'query') return encode((values.query ?? '').trim());
    if (n === 'clipboard') return encode((values.clipboard ?? '').trim().slice(0, CLIPBOARD_URL_MAX));
    return whole;
  });
}

const SAMPLE = 'x';

/** `https://x.com/s?q={query}` parsed with sample text in place of the placeholders. */
function sampleUrl(template: string): URL | null {
  try {
    return new URL(expandUrlTemplate(template.trim(), { query: SAMPLE, clipboard: SAMPLE }));
  } catch {
    return null;
  }
}

/** Why `template` can't be a quicklink address, in words for the person — or `null` when it is fine. */
export function urlTemplateProblem(template: string): string | null {
  const t = template.trim();
  if (!t) return 'Enter a web address.';
  if (t.length > URL_MAX) return `That address is too long (up to ${URL_MAX} characters).`;
  // The scheme is checked on the text itself, so no placeholder (or typed query) can ever change it.
  if (!/^https?:\/\//i.test(t)) return 'It has to start with http:// or https:// — other kinds of address aren’t allowed.';
  for (const name of placeholdersIn(t)) {
    if (!(URL_PLACEHOLDERS as readonly string[]).includes(name)) return `Unknown placeholder {${name}}. Use {query} or {clipboard}.`;
  }
  if (/[{}]/.test(t.replace(BRACES, ''))) return 'There is a stray { or } in the address.';
  const u = sampleUrl(t);
  if (!u?.hostname) return 'That doesn’t look like a valid web address.';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http:// and https:// addresses are allowed.';
  if (u.username || u.password) return 'Leave the username and password out of the address.';
  return null;
}

/** A finished address, or `null` unless it really is an http(s) URL. The last line of defence before anything is opened. */
export function safeWebUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u.href : null;
  } catch {
    return null;
  }
}

/** Where "just open the site" goes for a template: its origin (`https://github.com/`). Empty when it has none. */
export function templateHome(template: string): string {
  const u = sampleUrl(template);
  return u ? `${u.origin}/` : '';
}

/** `github.com/search?q={query}` — an address for display (scheme and trailing slash dropped). */
export const shortTemplate = (template: string): string =>
  template
    .trim()
    .replace(/^https?:\/\/(?:www\.)?/i, '')
    .replace(/\/$/, '');

/* ───────────────────────────── snippets ───────────────────────────── */

export const SNIPPET_MAX = 4000;

export type SnippetValues = { now: Date; locale?: string; clipboard?: string };

function fmt(locale: string | undefined, opts: Intl.DateTimeFormatOptions, now: Date): string {
  try {
    return new Intl.DateTimeFormat(locale, opts).format(now);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(now);
  }
}

/** Fill `{date}`, `{time}`, `{datetime}` and `{clipboard}`. Any other braces (code, JSON…) stay as typed. */
export function expandSnippet(text: string, { now, locale, clipboard = '' }: SnippetValues): string {
  return text.replace(BRACES, (whole, name: string) => {
    switch (name.trim().toLowerCase()) {
      case 'date':
        return fmt(locale, { dateStyle: 'medium' }, now);
      case 'time':
        return fmt(locale, { timeStyle: 'short' }, now);
      case 'datetime':
        return fmt(locale, { dateStyle: 'medium', timeStyle: 'short' }, now);
      case 'clipboard':
        return clipboard;
      default:
        return whole;
    }
  });
}

export const usesClipboard = (text: string): boolean => hasPlaceholder(text, 'clipboard');

/** A one-line preview for a row: dates and times filled in, `{clipboard}` left as it is (it can't be read without a click). */
export function snippetPreview(text: string, now: Date, locale?: string, max = 90): string {
  const line = expandSnippet(text, { now, locale, clipboard: '{clipboard}' }).replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Read the clipboard on a click. `null` when the browser refuses (no permission, page not focused). */
export async function readClipboardText(): Promise<string | null> {
  try {
    const text = await navigator.clipboard.readText();
    return text.slice(0, SNIPPET_MAX);
  } catch {
    return null;
  }
}
