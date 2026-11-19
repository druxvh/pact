import type { FxEnv, Surface } from './types';

/** An off-screen canvas of `w`×`h` device pixels (at least 1×1), from the environment's factory when it has one. */
export function surface(env: Pick<FxEnv, 'makeSurface'>, w: number, h: number): Surface | null {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  if (env.makeSurface) return env.makeSurface(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}
