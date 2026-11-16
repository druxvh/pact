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
