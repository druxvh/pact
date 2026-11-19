/**
 * Engraved Halo's colours: ink-navy and electric ultramarine with lavender line (dark), navy ink on pale lavender paper (light).
 * The ultramarine "ground" of the figure's roundel follows the user's accent (the style's own accent is ultramarine, so by default it
 * is the same blue as the buttons); everything else is fixed. Tokens follow styles/ultramarine.css (background #0d0d24 / #eceaf7).
 */
import { hexToRgb, mixRgb, type RGB } from '../../colors';

export type UltraPalette = {
  /** Page field. */
  field: RGB;
  /** The centre of the field's soft glow. */
  glow: RGB;
  /** Hairlines and rings. */
  ink: RGB;
  /** The brightest strokes (long rays, stars). */
  bright: RGB;
  /** The figure's dots (lit class in dark, shade class in light). */
  figure: RGB;
  /** The roundel's ground (ultramarine in dark; paper-tint in light). */
  ground: RGB;
  /** Ring and tick colour. */
  line: RGB;
  /** Overall strength of the rays (light mode draws ink on paper, so it eases off). */
  rayAlpha: number;
};

/** HSL helpers: push an accent to a deep, saturated ultramarine-style ground whatever hue it has. */
function toHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function fromHsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** The roundel ground for an accent: its hue, saturated, at a fixed depth (the vivid plate blue for the default accent). */
export function groundFor(accent: string): RGB {
  const [h, s] = toHsl(hexToRgb(accent));
  return fromHsl(h, Math.max(0.78, s), 0.45);
}

/** A lavender tinted by the accent's hue, for the line colour (so a green accent gives a mint-white engraving, not a clash). */
export function inkFor(accent: string, dark: boolean): RGB {
  const [h] = toHsl(hexToRgb(accent));
  return dark ? fromHsl(h, 0.55, 0.85) : fromHsl(h, 0.6, 0.14);
}

export function paletteFor(accent: string, dark: boolean): UltraPalette {
  const ink = inkFor(accent, dark);
  if (dark) {
    return {
      field: hexToRgb('#08081f'),
      glow: hexToRgb('#14145a'),
      ink,
      bright: mixRgb(ink, [255, 255, 255], 0.7),
      figure: ink,
      ground: groundFor(accent),
      line: mixRgb(ink, [255, 255, 255], 0.1),
      rayAlpha: 1,
    };
  }
  return {
    field: hexToRgb('#e9e8f7'),
    glow: hexToRgb('#f4f3ff'),
    ink,
    bright: mixRgb(ink, groundFor(accent), 0.35),
    figure: ink,
    ground: hexToRgb('#dad9f4'),
    line: ink,
    rayAlpha: 0.78,
  };
}

/** Lerp two palettes (the light↔dark crossfade). */
export function mixPalette(a: UltraPalette, b: UltraPalette, t: number): UltraPalette {
  return {
    field: mixRgb(a.field, b.field, t),
    glow: mixRgb(a.glow, b.glow, t),
    ink: mixRgb(a.ink, b.ink, t),
    bright: mixRgb(a.bright, b.bright, t),
    figure: mixRgb(a.figure, b.figure, t),
    ground: mixRgb(a.ground, b.ground, t),
    line: mixRgb(a.line, b.line, t),
    rayAlpha: a.rayAlpha + (b.rayAlpha - a.rayAlpha) * t,
  };
}
