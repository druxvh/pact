/**
 * Titles for queued videos.
 *
 * YouTube's `/oembed` endpoint stopped answering on www.youtube.com (404), so we read the title from the video's own
 * watch page instead: same-origin (no extra permission, no third party), and we abort the download as soon as the
 * `<title>` has arrived rather than pulling the whole page (about 1.3 MB; the title arrives after roughly 0.8 MB).
 */
/** YouTube puts <title> about 800 KB into the page (after its inline scripts), so the cap has to be generous. */
const MAX_BYTES = 2_000_000;

/** `<title>Big Buck Bunny - YouTube</title>` → `Big Buck Bunny` (decoding the few entities YouTube emits). */
export function parseTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m?.[1]) return null;
  const text = m[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(Number.parseInt(n, 16), 0x10ffff)))
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .replace(/^\(\d+\)\s*/, '')
    .trim();
  return text && text.toLowerCase() !== 'youtube' ? text : null;
}

export async function fetchTitle(videoId: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`/watch?v=${encodeURIComponent(videoId)}`, { signal: controller.signal, credentials: 'omit' });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    while (html.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
    controller.abort(); // stop downloading the rest
    return parseTitle(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
