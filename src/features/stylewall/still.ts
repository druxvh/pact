/**
 * One finished frame of a scene as an image: what the Style picker cards and the plate chooser show. It is the *real* renderer's still
 * frame (not a drawing that could drift from it), made once per (scene, size, theme, plate, accent) and cached as a data URL.
 */
import { DEFAULT_SEED } from './engine';
import { loadScene } from './registry';
import type { SceneOptions, StillRequest } from './types';

const cache = new Map<string, Promise<string | null>>();

const keyOf = (r: StillRequest) => `${r.scene}|${r.w}x${r.h}|${r.dark ? 'd' : 'l'}|${r.plate ?? ''}|${r.accent ?? ''}|${r.t ?? ''}|${r.seed ?? ''}`;

export function renderStill(req: StillRequest): Promise<string | null> {
  const key = keyOf(req);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = draw(req).catch(() => null);
  cache.set(key, p);
  return p;
}

/** Stills are drawn for a viewport at least this wide and then scaled down by the browser: a pixel scene needs room for its pixels, and a thumbnail that is *downscaled* stays crisp. */
const MIN_VIEWPORT = 480;

async function draw(req: StillRequest): Promise<string | null> {
  const factory = await loadScene(req.scene);
  if (!factory) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  const options: SceneOptions = { dark: req.dark ? 1 : 0, accent: req.accent ?? '#3a3aff', plate: req.plate ?? '', still: true, px: 0, py: 0 };
  const scene = factory({ canvas, ctx, options, seed: req.seed ?? DEFAULT_SEED });
  try {
    const k = Math.max(1, MIN_VIEWPORT / Math.max(1, req.w));
    const size = scene.size(Math.round(req.w * k), Math.round(req.h * k), 1);
    canvas.width = Math.max(1, Math.round(size.w));
    canvas.height = Math.max(1, Math.round(size.h));
    scene.resize(canvas.width, canvas.height, 1);
    if (scene.ready) await scene.ready;
    scene.frame(req.t ?? scene.stillTime, 0);
    return canvas.toDataURL('image/webp', 0.9);
  } finally {
    scene.dispose();
  }
}

/** Forget cached stills (tests). */
export const clearStills = (): void => cache.clear();
