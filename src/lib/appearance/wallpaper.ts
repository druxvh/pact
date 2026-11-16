/**
 * Wallpapers: solid colours, gradients, mesh gradients and the user's own image.
 *
 * Legibility is the hard part of a wallpaper feature, so it is designed in rather than hoped for:
 *  • a theme-aware "dim" layer (the page background colour at N % opacity) sits over every wallpaper, so dark text
 *    stays readable in light theme and light text in dark theme at any dim level you leave it on;
 *  • cards and panels turn slightly translucent with a blur (see globals.css) instead of floating on the picture;
 *  • `legibility()` estimates the contrast of body text over the dimmed wallpaper so Settings can warn you.
 */
import { luminanceOf, parseHex, rgbToOklch } from '@/lib/oklch';

export type Wallpaper =
  | { kind: 'none' }
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'mesh'; id: string }
  | { kind: 'image'; id: string; name: string };

export type WallpaperKind = Wallpaper['kind'];

export const NO_WALLPAPER: Wallpaper = { kind: 'none' };
export const IMAGE_ASSET_ID = 'wallpaper-image';

export const SOLIDS: ReadonlyArray<{ id: string; label: string; color: string }> = [
  { id: 'ink', label: 'Ink', color: '#0c0c10' },
  { id: 'night', label: 'Night', color: '#171a2b' },
  { id: 'navy', label: 'Navy', color: '#13233f' },
  { id: 'pine', label: 'Pine', color: '#0f2e2b' },
  { id: 'plum', label: 'Plum', color: '#2a1d3a' },
  { id: 'wine', label: 'Wine', color: '#3a1f24' },
  { id: 'linen', label: 'Linen', color: '#ece7dd' },
  { id: 'mist', label: 'Mist', color: '#dde6ef' },
  { id: 'sage', label: 'Sage', color: '#dfeadf' },
  { id: 'blush', label: 'Blush', color: '#f3e0e0' },
  { id: 'butter', label: 'Butter', color: '#fbebc6' },
  { id: 'lilac', label: 'Lilac', color: '#dad5f3' },
];

export const GRADIENTS: ReadonlyArray<{ id: string; label: string; from: string; to: string; angle: number }> = [
  { id: 'dawn', label: 'Dawn', from: '#ff9a8b', to: '#6a5acd', angle: 135 },
  { id: 'ember', label: 'Ember', from: '#f12711', to: '#f5af19', angle: 135 },
  { id: 'ocean', label: 'Ocean', from: '#1cb5e0', to: '#000851', angle: 160 },
  { id: 'forest', label: 'Forest', from: '#134e5e', to: '#71b280', angle: 150 },
  { id: 'lavender', label: 'Lavender', from: '#a18cd1', to: '#fbc2eb', angle: 135 },
  { id: 'peach', label: 'Peach', from: '#ffecd2', to: '#fcb69f', angle: 135 },
  { id: 'midnight', label: 'Midnight', from: '#232526', to: '#414345', angle: 160 },
  { id: 'aurora', label: 'Aurora', from: '#00c9ff', to: '#92fe9d', angle: 135 },
  { id: 'mint', label: 'Mint', from: '#d4fc79', to: '#96e6a1', angle: 135 },
  { id: 'rose', label: 'Rose', from: '#ee9ca7', to: '#ffdde1', angle: 135 },
  { id: 'slate', label: 'Slate', from: '#bdc3c7', to: '#2c3e50', angle: 160 },
  { id: 'citrus', label: 'Citrus', from: '#fdfc47', to: '#24fe41', angle: 135 },
];

type Mesh = { id: string; label: string; base: string; blobs: ReadonlyArray<[number, number, string]> };
export const MESHES: readonly Mesh[] = [
  {
    id: 'nebula',
    label: 'Nebula',
    base: '#0d0b1e',
    blobs: [
      [15, 20, '#5b2a86'],
      [85, 15, '#1f4e8c'],
      [70, 90, '#a1307b'],
      [10, 85, '#13304f'],
    ],
  },
  {
    id: 'lagoon',
    label: 'Lagoon',
    base: '#06202b',
    blobs: [
      [20, 15, '#0b7a75'],
      [90, 30, '#1b4f9c'],
      [60, 95, '#12a594'],
      [5, 80, '#0a3d62'],
    ],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    base: '#2a0e1f',
    blobs: [
      [10, 15, '#ff6b35'],
      [90, 10, '#c2185b'],
      [80, 90, '#6a1b9a'],
      [10, 90, '#e8590c'],
    ],
  },
  {
    id: 'ember-glow',
    label: 'Ember',
    base: '#1a0d08',
    blobs: [
      [30, 10, '#d9480f'],
      [95, 50, '#7a1f0b'],
      [20, 95, '#a8420a'],
    ],
  },
  {
    id: 'meadow',
    label: 'Meadow',
    base: '#eaf3e4',
    blobs: [
      [15, 15, '#b8e0a3'],
      [90, 20, '#f5e6a8'],
      [70, 95, '#9fd8c7'],
      [5, 85, '#d4ecc0'],
    ],
  },
  {
    id: 'blush-mesh',
    label: 'Blush',
    base: '#fbeef0',
    blobs: [
      [10, 20, '#f9c5d1'],
      [90, 10, '#e7d3f7'],
      [80, 90, '#fde2c8'],
      [10, 90, '#f6d6ea'],
    ],
  },
  {
    id: 'sky-mesh',
    label: 'Sky',
    base: '#e8f1fb',
    blobs: [
      [15, 10, '#b9d9f7'],
      [85, 25, '#d9e8ff'],
      [60, 95, '#c7ece9'],
      [5, 80, '#e4dcf8'],
    ],
  },
  {
    id: 'graphite-mesh',
    label: 'Graphite',
    base: '#131417',
    blobs: [
      [20, 15, '#2b2f3a'],
      [90, 80, '#23262e'],
      [10, 90, '#1b1d22'],
    ],
  },
];

export const meshById = (id: string) => MESHES.find((m) => m.id === id);

const meshCss = (m: Mesh) => `${m.blobs.map(([x, y, col]) => `radial-gradient(at ${x}% ${y}%, ${col} 0px, transparent 55%)`).join(',')},${m.base}`;

/** The CSS `background` value for colour-type wallpapers; null for none / image (those have no static CSS). */
export function wallpaperBackground(wp: Wallpaper): string | null {
  switch (wp.kind) {
    case 'solid':
      return wp.color;
    case 'gradient':
      return `linear-gradient(${Math.round(wp.angle)}deg,${wp.from},${wp.to})`;
    case 'mesh': {
      const m = meshById(wp.id);
      return m ? meshCss(m) : null;
    }
    default:
      return null;
  }
}

const hexLuminance = (hex: string): number => {
  const rgb = parseHex(hex);
  return rgb ? luminanceOf(rgbToOklch(rgb)) : 0.5;
};

/** Average relative luminance (0–1) of a wallpaper; `imageLuminance` is measured when an image is added. */
export function wallpaperLuminance(wp: Wallpaper, imageLuminance: number | null): number | null {
  switch (wp.kind) {
    case 'solid':
      return hexLuminance(wp.color);
    case 'gradient':
      return (hexLuminance(wp.from) + hexLuminance(wp.to)) / 2;
    case 'mesh': {
      const m = meshById(wp.id);
      if (!m) return null;
      const cols = [m.base, ...m.blobs.map((b) => b[2])];
      // blobs fade out by ~55 %, so the base weighs heaviest
      return (hexLuminance(m.base) * 2 + cols.slice(1).reduce((a, c) => a + hexLuminance(c), 0) / (cols.length - 1)) / 3;
    }
    case 'image':
      return imageLuminance;
    default:
      return null;
  }
}

/**
 * Page background (= the dim layer) and the *weakest* text that sits directly on the wallpaper — the muted-foreground
 * of headings' subtitles and the side nav, not full-strength body text — as relative luminance (Y = oklch L³ for greys).
 * Holding that to 4.5:1 keeps everything else readable too. Keep in sync with --background / --muted-foreground.
 */
const SURFACE = { light: { bg: 0.955, text: 0.097 }, dark: { bg: 0, text: 0.373 } } as const;

export type Legibility = { ratio: number; level: 'good' | 'fair' | 'poor' };

/** Contrast of body text over the wallpaper after the theme-aware dim layer (`dimPercent` 0–100). */
export function legibility(luminance: number, dimPercent: number, theme: 'light' | 'dark'): Legibility {
  const d = Math.min(1, Math.max(0, dimPercent / 100));
  const s = SURFACE[theme];
  const bg = luminance * (1 - d) + s.bg * d;
  const ratio = (Math.max(bg, s.text) + 0.05) / (Math.min(bg, s.text) + 0.05);
  return { ratio, level: ratio >= 4.5 ? 'good' : ratio >= 3 ? 'fair' : 'poor' };
}

/** The smallest dim (in 5 % steps, max 70) that makes body text readable (≥ 4.5:1) over this wallpaper in this theme. */
export function suggestDim(luminance: number, theme: 'light' | 'dark'): number {
  for (let d = 0; d <= 70; d += 5) if (legibility(luminance, d, theme).ratio >= 4.5) return d;
  return 70;
}

/** Dim is chosen per theme: a dark wallpaper needs none in dark theme but a lot in light theme (and vice-versa). */
export type Dim = { light: number; dark: number };

export const uniformDim = (n: number): Dim => ({ light: n, dark: n });

/** The readable-text dim for both themes at once. */
export const suggestDims = (luminance: number): Dim => ({ light: suggestDim(luminance, 'light'), dark: suggestDim(luminance, 'dark') });

/** Sensible default dim when switching to a kind of wallpaper. */
export function defaultDim(kind: WallpaperKind): number {
  return kind === 'image' ? 35 : kind === 'mesh' ? 20 : 0;
}

// ── image import ─────────────────────────────────────────────────────────────

export const MAX_WALLPAPER_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_SIDE = 2560;

export type ProcessedImage = { blob: Blob; luminance: number; width: number; height: number };

/** Validate, downscale (≤ 2560 px) and re-encode (WebP) a user image so it's light to store and quick to paint. */
export async function processWallpaperImage(file: File): Promise<ProcessedImage> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('Choose a photo or image file (PNG, JPEG, WebP…).');
  if (file.size > MAX_WALLPAPER_INPUT_BYTES) throw new Error('That image is over 30 MB — pick a smaller one.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('That image couldn’t be read.');
  });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser couldn’t process the image.');
    ctx.drawImage(bitmap, 0, 0, width, height);

    // average luminance from a 24×24 thumbnail
    const probe = document.createElement('canvas');
    probe.width = probe.height = 24;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    let luminance = 0.5;
    if (pctx) {
      pctx.drawImage(canvas, 0, 0, 24, 24);
      const px = pctx.getImageData(0, 0, 24, 24).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const lin = (v: number) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        sum += 0.2126 * lin(px[i] as number) + 0.7152 * lin(px[i + 1] as number) + 0.0722 * lin(px[i + 2] as number);
      }
      luminance = sum / (px.length / 4);
    }

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode the image.'))), 'image/webp', 0.86),
    );
    return { blob, luminance, width, height };
  } finally {
    bitmap.close();
  }
}
