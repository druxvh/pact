/**
 * The tab icon follows the accent: the same "p." mark as the sidebar logo, drawn with the accent's colours.
 * The stock orange keeps the packaged PNG (nothing to compute, nothing to cache).
 */
import { type AccentChoice, DEFAULT_ACCENT_ID, logoColors } from './accent';

export const STOCK_ICON = '/icon/32.png';

/** The mark as a standalone SVG (geometry matches public/icon.svg and components/Logo.tsx). */
export function logoSvg(choice: AccentChoice, theme: 'light' | 'dark' = 'light'): string {
  const { from, to, ink } = logoColors(choice, theme);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">' +
    `<defs><linearGradient id="a" x1="22" y1="4" x2="106" y2="124" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>` +
    '<linearGradient id="g" x1="64" y1="0" x2="64" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>' +
    '<rect width="128" height="128" rx="30" fill="url(#a)"/><rect width="128" height="128" rx="30" fill="url(#g)"/>' +
    `<g transform="translate(-6 -3)" stroke="${ink}" stroke-linecap="round"><path d="M48 97V41" stroke-width="15"/><circle cx="68" cy="59" r="20" stroke-width="15"/></g>` +
    `<circle cx="92" cy="92" r="8" fill="${ink}"/></svg>`
  );
}

/** `href` for <link rel="icon">: the packaged PNG for the stock accent, otherwise a data-URL SVG in the accent's colours. */
export function faviconHref(choice: AccentChoice, theme: 'light' | 'dark' = 'light'): string {
  if (choice.kind === 'preset' && choice.id === DEFAULT_ACCENT_ID) return STOCK_ICON;
  return `data:image/svg+xml,${encodeURIComponent(logoSvg(choice, theme))}`;
}

const prefersDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/** Computed for the browser's own light/dark (the tab strip follows it, not the app's theme toggle). */
export const currentFaviconHref = (choice: AccentChoice): string => faviconHref(choice, prefersDark() ? 'dark' : 'light');

export function setFavicon(href: string): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = href.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/png';
  link.setAttribute('href', href);
}
