const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const TRAILING = /[.,!?;:]+$/;

/** Distinct http(s) URLs in a message, in order, without trailing punctuation. */
export function extractUrls(text: string, max = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING, '');
    if (!seen.has(url) && URL.canParse(url)) {
      seen.add(url);
      out.push(url);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Turn a pasted full invite link or a bare code into just the code. */
export function parseInviteCode(input: string): string {
  const t = input.trim();
  const fromLink = /(?:join(?:%3A|:)|[?&]invite=)([a-z0-9]{8,32})/i.exec(t)?.[1];
  return (fromLink ?? t.replace(/[^a-z0-9]/gi, '')).toLowerCase();
}

export const isPlausibleInviteCode = (code: string) => /^[a-f0-9]{16}$/.test(code);

const GIF_HOST = /^(?:media\d*|i)\.giphy\.com$/i;

/**
 * If a message is nothing but a link to a GIF on the GIF provider's own hosts, that link — so it can be shown as a
 * picture instead of a bare URL. Anything else (other hosts, http, extra text) is just a normal message.
 */
export function gifUrl(body: string): string | null {
  const t = body.trim();
  if (!t || t.length > 600 || /\s/.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' || u.username || u.password || !GIF_HOST.test(u.hostname) || !/\.(gif|webp)$/i.test(u.pathname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A short text stand-in for a message body (used in reply bars): a GIF-only message reads as "GIF", not as a long URL. */
export const snippet = (body: string): string => (gifUrl(body) ? 'GIF' : body);
