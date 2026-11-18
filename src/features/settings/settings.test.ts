import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS } from '@/lib/appearance/accent';
import { RADIUS_IDS } from '@/lib/appearance/radius';
import { GRADIENTS, MESHES, SOLIDS } from '@/lib/appearance/wallpaper';
import { INLINE_ACCENTS } from './AccentPicker';
import { RoundnessIcon } from './RoundnessPicker';
import { describeWallpaper } from './WallpaperPicker';

describe('the accent swatches shown in the row', () => {
  it('are all real presets, without repeats, and leave some for the “More” popover', () => {
    for (const id of INLINE_ACCENTS)
      expect(
        ACCENT_PRESETS.some((p) => p.id === id),
        id,
      ).toBe(true);
    expect(new Set(INLINE_ACCENTS).size).toBe(INLINE_ACCENTS.length);
    expect(INLINE_ACCENTS.length).toBeLessThan(ACCENT_PRESETS.length);
  });
});

describe('RoundnessIcon', () => {
  const path = (radius: (typeof RADIUS_IDS)[number]) => /<path d="([^"]+)"/.exec(renderToStaticMarkup(createElement(RoundnessIcon, { radius })))?.[1] ?? '';
  const arc = (d: string) => Number(/A([\d.]+) /.exec(d)?.[1] ?? 0);

  it('draws “none” with a sharp corner and every other step with a rounder one than the last', () => {
    expect(path('none')).not.toContain('A');
    const radii = RADIUS_IDS.map((id) => arc(path(id)));
    expect(radii[0]).toBe(0);
    for (let i = 1; i < radii.length; i++) expect(radii[i] as number, RADIUS_IDS[i]).toBeGreaterThan(radii[i - 1] as number);
  });

  it('uses the 24-unit box and 2px round stroke of the lucide icons beside it', () => {
    const svg = renderToStaticMarkup(createElement(RoundnessIcon, { radius: 'md' }));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it('keeps every corner inside the box (the arc can’t be bigger than the square it rounds)', () => {
    for (const id of RADIUS_IDS) expect(arc(path(id)), id).toBeLessThanOrEqual(18);
  });
});

describe('describeWallpaper', () => {
  it('names what is behind the page', () => {
    expect(describeWallpaper({ kind: 'none' })).toBe('None');
    expect(describeWallpaper({ kind: 'solid', color: (SOLIDS[0] as (typeof SOLIDS)[number]).color.toUpperCase() })).toBe(
      `Colour · ${(SOLIDS[0] as (typeof SOLIDS)[number]).label}`,
    );
    expect(describeWallpaper({ kind: 'solid', color: '#123456' })).toBe('Colour · #123456');
    const g = GRADIENTS[0] as (typeof GRADIENTS)[number];
    expect(describeWallpaper({ kind: 'gradient', from: g.from, to: g.to, angle: 10 })).toBe(`Gradient · ${g.label}`);
    expect(describeWallpaper({ kind: 'gradient', from: '#000000', to: '#ffffff', angle: 10 })).toBe('Gradient · custom');
    const m = MESHES[0] as (typeof MESHES)[number];
    expect(describeWallpaper({ kind: 'mesh', id: m.id })).toBe(`Mesh · ${m.label}`);
    expect(describeWallpaper({ kind: 'image', id: 'x', name: 'beach.jpg' })).toBe('Picture · beach.jpg');
  });
});
