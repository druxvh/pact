/**
 * The style wallpaper contract: what a scene (a renderer) is handed, and what it hands back. See README.md in this folder.
 *
 * A *scene* is a plain object with four methods and no knowledge of React, the DOM loop, visibility or reduced motion — the engine
 * (`engine.ts`) owns all of that. A scene only draws: it builds its buffers in `resize`, paints one frame in `frame(t, dt)` and frees
 * them in `dispose`.
 */

/** Light/dark as the engine eases it: 0 = fully light, 1 = fully dark, anything between while the theme flips. */
export type Dark = number;

/**
 * Live options, owned and mutated in place by the engine (one object per mounted wallpaper). A scene reads them *every frame* and
 * never caches the values it reads, which is what makes the smooth light↔dark crossfade, the accent follow and the parallax work.
 */
export type SceneOptions = {
  /** 0 = light … 1 = dark (eased by the engine over ~0.45 s when the theme flips). Lerp palettes by it. */
  dark: Dark;
  /** The user's accent as `#rrggbb`. Scenes may tint with it (Ultramarine's ink) or ignore it. */
  accent: string;
  /** Which variant of the scene to draw (Ultramarine's "plates"). Unknown ids fall back to the scene's default. */
  plate: string;
  /** Reduced motion: the engine draws ONE frame at `t = scene.stillTime` and stops. A scene must not schedule anything of its own. */
  still: boolean;
  /** Pointer parallax, smoothed by the engine: −1 … 1 from the viewport centre. Always 0 when `still`. */
  px: number;
  py: number;
};

/** The canvas resolution a scene wants for a viewport, and how the browser should scale it up. */
export type SceneSize = {
  /** Internal canvas size in canvas pixels. The engine sets `canvas.width/height` to this, then calls `resize`. */
  w: number;
  h: number;
  /** `false` → `image-rendering: pixelated` (dithered pixel-art scenes); `true` → bilinear (line art). */
  smooth: boolean;
};

export type SceneInit = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Live (see {@link SceneOptions}). */
  options: SceneOptions;
  /** Per-mount seed — the same seed draws the same scene, so tests and screenshots are repeatable. */
  seed: number;
};

export type Scene = {
  /** Cap for this scene's frame rate (24–30). The engine never calls `frame` faster than this. */
  fps: number;
  /** The `t` (seconds) at which the still frame for reduced motion is drawn — pick the most composed moment. */
  stillTime: number;
  /** Pure: the internal resolution for a CSS-pixel viewport at this device pixel ratio. Called on every resize. */
  size: (viewportW: number, viewportH: number, dpr: number) => SceneSize;
  /**
   * The canvas now has the size `size()` returned: (re)build every size-dependent buffer. `w`,`h` = canvas pixels, `dpr` = the
   * device pixel ratio the size was chosen for. Called once before the first frame and again after every resize.
   */
  resize: (w: number, h: number, dpr: number) => void;
  /** Paint one complete frame (never a partial one — the canvas is not cleared for you). `t` = seconds of *running* time, `dt` = seconds since the last frame. */
  frame: (t: number, dt: number) => void;
  /**
   * Optional: resolves once asynchronous assets (a plate's PNG) are decoded. The engine redraws the still frame when it does, and
   * `renderStill` waits for it. A scene draws something sensible (never a blank canvas) before then.
   */
  ready?: Promise<void>;
  /** Free buffers and listeners. After this the scene is never called again. */
  dispose: () => void;
};

export type SceneFactory = (init: SceneInit) => Scene;

/** A scene module (what the registry lazy-imports). */
export type SceneModule = { create: SceneFactory };

/** What the previews and the Settings thumbnails ask for: one finished still frame, drawn by the real scene. */
export type StillRequest = {
  scene: string;
  w: number;
  h: number;
  dark: boolean;
  plate?: string;
  accent?: string;
  /** Running time of the frame; default = the scene's `stillTime`. */
  t?: number;
  seed?: number;
};
