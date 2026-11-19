/**
 * Dithered Dusk's colours. Every pixel the scene draws is one of these (or a dither of two *neighbours*), so it reads as hand-placed pixel art
 * rather than a gradient. The sky ramp and surfaces come from the Dusk style's tokens (styles/dusk.css): rose, gold, iris and foam on deep plum
 * (dark = after sunset), and the same hues on cream (light = dawn). If a token there changes, change it here.
 */
export type DuskPalette = {
  /** Sky from the zenith (matches the page background) down to the horizon glow. Dithering only ever mixes neighbours. */
  sky: readonly string[];
  /** Ridgelines, far → near. */
  ridges: readonly string[];
  /** The mist the far ridges dissolve into (a lighter mix of the horizon colours). */
  haze: string;
  /** A one-pixel light on the sun-facing crest of the middle ridges. */
  rim: string;
  /** Sun disc: highlight, body, rim. */
  sun: readonly [string, string, string];
  /** Moon: lit, shaded. */
  moon: readonly [string, string];
  /** Clouds: lit top, body, shaded underside. */
  cloud: readonly [string, string, string];
  star: string;
  starBright: string;
  bird: string;
};

export const DUSK_DARK: DuskPalette = {
  sky: ['#191724', '#241f3d', '#342a55', '#5d3a6b', '#a04c7c', '#eb6f92', '#f6c177'],
  ridges: ['#5a3a67', '#463259', '#352a4d', '#26233a', '#1b1928'],
  haze: '#b0597f',
  rim: '#f1a0a8',
  sun: ['#fbe0a8', '#f6c177', '#eb6f92'],
  moon: ['#e0def4', '#9893c0'],
  cloud: ['#f6a98f', '#a24d7c', '#5d3a6b'],
  star: '#c4a7e7',
  starBright: '#e0def4',
  bird: '#2a2342',
};

export const DUSK_LIGHT: DuskPalette = {
  sky: ['#faf4ed', '#f4ebe4', '#f0dedb', '#ebbcba', '#efa99d', '#f3b585', '#f6c177'],
  ridges: ['#dcc0c6', '#c8aebc', '#ab9aaf', '#8d82a0', '#6f6890'],
  haze: '#efd1c8',
  rim: '#fff3e4',
  sun: ['#fff6e6', '#fbe3b0', '#f6c177'],
  moon: ['#ffffff', '#e3d6e0'],
  cloud: ['#fffaf3', '#f2d3cd', '#d9aeb5'],
  star: '#907aa9',
  starBright: '#797593',
  bird: '#797593',
};
