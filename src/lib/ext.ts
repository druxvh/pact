/**
 * Thin facade over the WebExtension APIs.
 *
 * pact's UI also runs as a plain web page during development (`wxt` dev server),
 * where `chrome.*` doesn't exist. Everything here degrades gracefully instead of
 * throwing, so UI code never has to sprinkle try/catch around extension calls.
 */
import { browser } from 'wxt/browser';

type Api = typeof browser;
const api = browser as Api | undefined;

/** True when running as an installed/loaded extension page (not a dev-server tab). */
export const isExtension: boolean = Boolean(api?.runtime?.id);

export type TopSite = { title: string; url: string };

export async function getTopSites(): Promise<TopSite[]> {
  try {
    if (!api?.topSites?.get) return [];
    const sites = await api.topSites.get();
    return sites.filter((s) => /^https?:/.test(s.url)).map((s) => ({ title: s.title ?? '', url: s.url }));
  } catch {
    return [];
  }
}

/**
 * Chromium's built-in favicon cache (needs the `favicon` permission). Private and
 * instant — unlike a third-party favicon service it never leaks the sites you visit.
 * Returns '' outside the extension so callers can show a letter tile instead.
 */
export function faviconUrl(pageUrl: string, size = 32): string {
  if (!isExtension || !api?.runtime?.getURL) return '';
  try {
    // WXT types only known public paths, but `/_favicon/` is a Chromium built-in endpoint.
    const getUrl = api.runtime.getURL.bind(api.runtime) as (path: string) => string;
    const u = new URL(getUrl('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', String(size));
    return u.toString();
  } catch {
    return '';
  }
}

/** Navigate this tab (or open a new one). chrome:// URLs must go through the tabs API. */
export function openUrl(url: string, opts: { newTab?: boolean } = {}): void {
  const isInternal = /^(chrome|edge|brave|about|chrome-extension|moz-extension):/.test(url);
  if (api?.tabs && (isInternal || opts.newTab)) {
    const p = opts.newTab ? api.tabs.create({ url }) : api.tabs.update({ url });
    void Promise.resolve(p).catch(() => {});
    return;
  }
  if (opts.newTab) window.open(url, '_blank', 'noopener,noreferrer');
  else window.location.assign(url);
}

/**
 * Search with the user's *default* search engine (needs the `search` permission),
 * rather than hard-coding Google. Falls back to Google in a plain page.
 */
export async function webSearch(text: string, opts: { newTab?: boolean } = {}): Promise<void> {
  const disposition = opts.newTab ? 'NEW_TAB' : 'CURRENT_TAB';
  try {
    // Chromium
    const chromeSearch = (api as unknown as { search?: { query?: (o: object) => Promise<void> } })?.search;
    if (chromeSearch?.query) {
      await chromeSearch.query({ text, disposition });
      return;
    }
    // Firefox
    const ffSearch = (api as unknown as { search?: { search?: (o: object) => Promise<void> } })?.search;
    if (ffSearch?.search) {
      await ffSearch.search({ query: text, disposition });
      return;
    }
  } catch {
    // fall through to the URL fallback
  }
  openUrl(`https://www.google.com/search?q=${encodeURIComponent(text)}`, opts);
}

/** Schedule a one-shot alarm (used by the timer so it still fires if this tab is closed). */
export async function scheduleAlarm(name: string, whenMs: number): Promise<void> {
  try {
    await api?.alarms?.create(name, { when: whenMs });
  } catch {
    /* alarms unavailable */
  }
}

export async function clearAlarm(name: string): Promise<void> {
  try {
    await api?.alarms?.clear(name);
  } catch {
    /* alarms unavailable */
  }
}

/** Show a system notification when running as an extension; otherwise a no-op. */
export async function systemNotify(id: string, title: string, message: string): Promise<void> {
  try {
    await api?.notifications?.create(id, {
      type: 'basic',
      iconUrl: api.runtime.getURL('/icon/128.png'),
      title,
      message,
    });
  } catch {
    /* notifications unavailable */
  }
}

/**
 * Message the extension's background script. Resolves `null` when there is no extension runtime (the dev
 * server, a plain web page) or the background doesn't answer — callers decide how to explain that.
 */
export async function sendToBackground<T>(message: unknown): Promise<T | null> {
  if (!isExtension || !api?.runtime?.sendMessage) return null;
  try {
    return ((await api.runtime.sendMessage(message)) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Write to `chrome.storage.local` (shared with content scripts, unlike this page's localStorage). Best effort. */
export async function storeLocal(items: Record<string, unknown>): Promise<void> {
  try {
    await api?.storage?.local?.set(items);
  } catch {
    /* storage unavailable */
  }
}

/** Open the extension's new tab page, optionally at a hash route (e.g. "#/timer"). */
export function pactUrl(hash = ''): string {
  if (api?.runtime?.getURL) return api.runtime.getURL('/newtab.html') + hash;
  return window.location.pathname + hash;
}
