import { describe, expect, it } from 'vitest';
import { defaultDim, GRADIENTS, legibility, MESHES, SOLIDS, shrinkPlan, suggestDim, wallpaperBackground, wallpaperLuminance } from './wallpaper';

describe('wallpaperBackground', () => {
  it('builds CSS for each colour-type wallpaper and nothing for none/image', () => {
    expect(wallpaperBackground({ kind: 'solid', color: '#123456' })).toBe('#123456');
    expect(wallpaperBackground({ kind: 'gradient', from: '#111111', to: '#eeeeee', angle: 135.4 })).toBe('linear-gradient(135deg,#111111,#eeeeee)');
    const mesh = wallpaperBackground({ kind: 'mesh', id: 'nebula' });
    expect(mesh).toMatch(/^radial-gradient\(at \d+% \d+%, #[0-9a-f]{6} 0px, transparent 55%\)/);
    expect(mesh).toContain('#0d0b1e'); // base colour last
    expect(wallpaperBackground({ kind: 'none' })).toBeNull();
    expect(wallpaperBackground({ kind: 'image', id: 'x', name: 'x' })).toBeNull();
    expect(wallpaperBackground({ kind: 'mesh', id: 'does-not-exist' })).toBeNull();
  });

  it('every built-in preset is well-formed', () => {
    for (const s of SOLIDS) expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    for (const g of GRADIENTS) {
      expect(g.from).toMatch(/^#[0-9a-f]{6}$/i);
      expect(g.to).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const m of MESHES) expect(wallpaperBackground({ kind: 'mesh', id: m.id })).toContain(m.base);
    expect(new Set([...SOLIDS, ...GRADIENTS, ...MESHES].map((p) => p.id)).size).toBe(SOLIDS.length + GRADIENTS.length + MESHES.length);
  });
});

describe('legibility', () => {
  it('white-ish text on a dark wallpaper in dark theme is fine; on a bright one it is not', () => {
    expect(legibility(0.02, 0, 'dark').level).toBe('good');
    expect(legibility(0.9, 0, 'dark').level).toBe('poor');
  });
  it('dimming rescues a bright wallpaper in dark theme (the dim layer is the dark page colour)', () => {
    expect(legibility(0.12, 0, 'dark').ratio).toBeLessThan(legibility(0.12, 60, 'dark').ratio);
    expect(legibility(0.12, 0, 'dark').level).not.toBe('good');
    expect(legibility(0.12, 70, 'dark').level).toBe('good');
    // …but a near-white wallpaper can't be rescued by dim alone (light text over mid-grey is the worst case), so it caps at 70.
    expect(suggestDim(0.95, 'dark')).toBe(70);
  });
  it('and a dark wallpaper in light theme needs the (light) dim layer', () => {
    expect(legibility(0.02, 0, 'light').level).toBe('poor');
    expect(legibility(0.02, 70, 'light').level).not.toBe('poor');
  });
});

describe('suggestDim', () => {
  it('returns the smallest dim that reaches 4.5:1, in 5 % steps', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const lum of [0, 0.05, 0.2, 0.5, 0.8, 1]) {
        const d = suggestDim(lum, theme);
        expect(d % 5).toBe(0);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(70);
        if (d > 0 && d < 70) expect(legibility(lum, d - 5, theme).ratio).toBeLessThan(4.5); // not larger than needed
        if (d < 70) expect(legibility(lum, d, theme).ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('is 0 when the wallpaper already suits the theme', () => {
    expect(suggestDim(0, 'dark')).toBe(0);
    expect(suggestDim(1, 'light')).toBe(0);
  });
});

describe('wallpaperLuminance', () => {
  it('orders dark < light and averages gradients', () => {
    const dark = wallpaperLuminance({ kind: 'solid', color: '#101010' }, null) as number;
    const light = wallpaperLuminance({ kind: 'solid', color: '#f0f0f0' }, null) as number;
    expect(dark).toBeLessThan(0.05);
    expect(light).toBeGreaterThan(0.8);
    const mid = wallpaperLuminance({ kind: 'gradient', from: '#000000', to: '#ffffff', angle: 90 }, null) as number;
    expect(mid).toBeCloseTo(0.5, 1);
  });
  it('uses the measured value for images and null for none', () => {
    expect(wallpaperLuminance({ kind: 'image', id: 'x', name: 'x' }, 0.42)).toBe(0.42);
    expect(wallpaperLuminance({ kind: 'none' }, null)).toBeNull();
  });
  it('has sensible default dims', () => {
    expect(defaultDim('none')).toBe(0);
    expect(defaultDim('image')).toBeGreaterThan(defaultDim('solid'));
  });
});

describe('shrinkPlan — keeping a wallpaper picture backup-sized', () => {
  it('scales by √(target/size) with a margin, and gets stricter on each attempt', () => {
    const first = shrinkPlan(8_000_000, 4000, 3000, 2_000_000, 0);
    expect(first).not.toBeNull();
    expect(first?.scale).toBeCloseTo(Math.sqrt(2 / 8) * 0.9, 5);
    const second = shrinkPlan(8_000_000, 4000, 3000, 2_000_000, 1);
    expect(second?.scale).toBeLessThan(first?.scale ?? 0);
    expect(second?.quality).toBeLessThan(first?.quality ?? 0);
  });

  it('never upscales, and gives up rather than make a thumbnail', () => {
    expect(shrinkPlan(2_100_000, 4000, 3000, 2_000_000, 0)?.scale).toBeLessThanOrEqual(1);
    expect(shrinkPlan(900_000_000, 800, 600, 2_000_000, 0)).toBeNull(); // would shrink below 320 px
    expect(shrinkPlan(8_000_000, 4000, 3000, 2_000_000, 4)).toBeNull(); // out of attempts
    expect(shrinkPlan(0, 100, 100, 1, 0)).toBeNull();
  });
});
