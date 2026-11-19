/** Small colour helpers shared by the scenes: `#rrggbb` ↔ [r, g, b] and the lerps palettes need for the light↔dark crossfade. */
export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = ([r, g, b]: RGB): string =>
  `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const rgbCss = (c: RGB, alpha = 1): string =>
  alpha >= 1
    ? `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`
    : `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])} / ${alpha.toFixed(3)})`;
