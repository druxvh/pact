import { describe, expect, it } from 'vitest';
import type { AccentChoice } from './accent';
import { faviconHref, logoSvg, STOCK_ICON } from './favicon';

const orange: AccentChoice = { kind: 'preset', id: 'orange' };
const blue: AccentChoice = { kind: 'preset', id: 'blue' };

describe('favicon', () => {
  it('keeps the packaged icon for the stock accent', () => {
    expect(faviconHref(orange)).toBe(STOCK_ICON);
  });
  it('draws the mark in the accent’s colours otherwise', () => {
    const href = faviconHref(blue);
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(href.slice('data:image/svg+xml,'.length));
    expect(svg).toBe(logoSvg(blue));
    expect(svg).toMatch(/stop-color="#[0-9a-f]{6}"/);
  });
  it('gives different accents different icons, and graphite flips with the browser theme', () => {
    expect(logoSvg(blue)).not.toBe(logoSvg({ kind: 'preset', id: 'red' }));
    const graphite: AccentChoice = { kind: 'preset', id: 'graphite' };
    expect(logoSvg(graphite, 'light')).not.toBe(logoSvg(graphite, 'dark'));
  });
  it('uses legible ink on every preset', () => {
    for (const id of ['yellow', 'lime', 'indigo', 'graphite']) {
      const svg = logoSvg({ kind: 'preset', id });
      expect(svg).toMatch(/stroke="#[0-9a-f]{6}"/);
    }
  });
});
