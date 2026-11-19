import type { Box, Track } from './geometry';

export type EffectName = 'beam' | 'fire' | 'electric' | 'haze' | 'neon' | 'aurora' | 'stardust' | 'matrix' | 'lava';
export type Rgb = readonly [number, number, number];

/** What an effect is told about where it lives. `mode: 'line'` is the thin strip under the ⌘K field (flames, bolts and comets then run along a straight line). */
export type FxEnv = {
  name: EffectName;
  /** 1 on Home; the Settings thumbnails draw everything at about half size. */
  scale: number;
  /** Dark page: light is added to it; on a light page it is painted over it instead. */
  dark: boolean;
  /** Reduced motion: draw one still frame and stop. */
  still: boolean;
  mode: 'box' | 'line';
  accent: Rgb;
  /** Where off-screen canvases come from (tests give it a recording fake; the page uses `document.createElement('canvas')`). */
  makeSurface?: (w: number, h: number) => Surface | null;
};

/** An off-screen canvas an effect paints into once (sprites, glyph atlas…) or every frame (low-res fields). */
export type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

/** The canvas and the box inside it (canvas CSS pixels). */
export type Geo = { w: number; h: number; box: Box; track: Track; dpr: number };

/** What the person is doing to the box. `energy` is 0 (asleep) … ~1.6 (typing hard); `burst` is the short kick after Enter. */
export type FxInput = { energy: number; focus: boolean; burst: number; time: number };

export interface Fx {
  /** Pixels of canvas around the box (the glow's room). */
  margin: number;
  /** Frame-rate cap. */
  fps: number;
  setup(g: Geo): void;
  /** Draw one frame onto a cleared canvas. */
  frame(ctx: CanvasRenderingContext2D, dt: number, inp: FxInput): void;
  /** Optional faint light on the inside of the box's border (drawn after the interior is cleared, clipped to a thin band). */
  rim?(ctx: CanvasRenderingContext2D, inp: FxInput): void;
  poke(kind: 'type' | 'enter'): void;
}

export type FxFactory = (env: FxEnv) => Fx;
