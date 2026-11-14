/** Encoding helpers. All Unicode-safe. */
export type Result = { ok: true; value: string } | { ok: false; error: string };

export function urlEncode(s: string, full = false): Result {
  try {
    return { ok: true, value: full ? encodeURI(s) : encodeURIComponent(s) };
  } catch {
    return { ok: false, error: 'Contains an unpaired surrogate and cannot be encoded' };
  }
}
export function urlDecode(s: string): Result {
  try {
    return { ok: true, value: decodeURIComponent(s.replace(/\+/g, ' ')) };
  } catch {
    return { ok: false, error: 'Not valid percent-encoding (a % isn’t followed by two hex digits)' };
  }
}

/** btoa() only handles Latin-1 — go through UTF-8 bytes so emoji and accents survive. */
export function base64Encode(s: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}
export function base64Decode(s: string): Result {
  try {
    const norm = s.trim().replace(/-/g, '+').replace(/_/g, '/');
    const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: 'Not valid Base64 (or it doesn’t decode to UTF-8 text)' };
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  }
  return v;
}

export function formatJson(s: string, indent: number | '\t' = 2, sort = false): Result {
  try {
    const parsed: unknown = JSON.parse(s);
    return { ok: true, value: JSON.stringify(sort ? sortKeys(parsed) : parsed, null, indent) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'Invalid JSON' };
  }
}
export function minifyJson(s: string): Result {
  try {
    return { ok: true, value: JSON.stringify(JSON.parse(s)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'Invalid JSON' };
  }
}
