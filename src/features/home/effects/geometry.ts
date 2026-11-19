/**
 * Where things travel. A *track* is a path with a length and a point at every distance along it: the rounded rectangle of the
 * search box (closed — a comet laps it), or the straight line under the ⌘K field (open). Each point carries the outward normal
 * and the tangent, so a flame can leave a border sideways and lightning can hug it, whatever the corner radius is.
 */

export type Pt = { x: number; y: number; nx: number; ny: number; tx: number; ty: number };
export type Box = { x: number; y: number; w: number; h: number; r: number };
export type Track = { length: number; closed: boolean; at: (d: number, offset?: number) => Pt };

const HALF_PI = Math.PI / 2;

/** The radius the box can really have (never more than half its short side). */
export const fitRadius = (b: Box): number => Math.max(0, Math.min(b.r, b.w / 2, b.h / 2));

export function perimeter(b: Box): number {
  const r = fitRadius(b);
  return 2 * (b.w - 2 * r) + 2 * (b.h - 2 * r) + 2 * Math.PI * r;
}

/**
 * The point at distance `d` along the box outline, clockwise from where the top edge starts (after the top-left corner), `offset`
 * pixels out along the normal (negative = inside). `d` wraps around, so a comet can just keep adding to it.
 */
export function pointAt(b: Box, d: number, offset = 0): Pt {
  const r = fitRadius(b);
  const top = b.w - 2 * r;
  const side = b.h - 2 * r;
  const arc = HALF_PI * r;
  const total = 2 * top + 2 * side + 4 * arc;
  let s = ((d % total) + total) % total;
  const make = (x: number, y: number, nx: number, ny: number): Pt => ({ x: x + nx * offset, y: y + ny * offset, nx, ny, tx: -ny, ty: nx });
  // top edge →
  if (s < top) return make(b.x + r + s, b.y, 0, -1);
  s -= top;
  // top-right corner
  if (s < arc) return corner(b.x + b.w - r, b.y + r, r, -HALF_PI, s / arc, offset);
  s -= arc;
  // right edge ↓
  if (s < side) return make(b.x + b.w, b.y + r + s, 1, 0);
  s -= side;
  // bottom-right
  if (s < arc) return corner(b.x + b.w - r, b.y + b.h - r, r, 0, s / arc, offset);
  s -= arc;
  // bottom edge ←
  if (s < top) return make(b.x + b.w - r - s, b.y + b.h, 0, 1);
  s -= top;
  // bottom-left
  if (s < arc) return corner(b.x + r, b.y + b.h - r, r, HALF_PI, s / arc, offset);
  s -= arc;
  // left edge ↑
  if (s < side) return make(b.x, b.y + b.h - r - s, -1, 0);
  s -= side;
  // top-left
  return corner(b.x + r, b.y + r, r, Math.PI, Math.min(1, s / arc), offset);
}

function corner(cx: number, cy: number, r: number, from: number, k: number, offset: number): Pt {
  const a = from + k * HALF_PI;
  const nx = Math.cos(a);
  const ny = Math.sin(a);
  return { x: cx + nx * (r + offset), y: cy + ny * (r + offset), nx, ny, tx: -ny, ty: nx };
}

/** The box outline as a closed track. */
export function boxTrack(b: Box): Track {
  return { length: perimeter(b), closed: true, at: (d, offset = 0) => pointAt(b, d, offset) };
}

/** A straight line left → right at height `y`, with "out" meaning up. */
export function lineTrack(x0: number, x1: number, y: number): Track {
  const length = Math.max(1, x1 - x0);
  return {
    length,
    closed: false,
    at: (d, offset = 0) => {
      const x = x0 + Math.min(length, Math.max(0, d));
      return { x, y: y - offset, nx: 0, ny: -1, tx: 1, ty: 0 };
    },
  };
}

/** `count` points along [d0, d1] (inclusive). */
export function samples(track: Track, d0: number, d1: number, count: number, offset = 0): Pt[] {
  const out: Pt[] = [];
  const n = Math.max(2, count);
  for (let i = 0; i < n; i++) out.push(track.at(d0 + ((d1 - d0) * i) / (n - 1), offset));
  return out;
}

/** Trace the rounded rectangle (inset by `inset`) onto a path; works for a canvas context or a Path2D. */
export function roundRectPath(p: Path2D | CanvasRenderingContext2D, b: Box, inset = 0): void {
  const r = Math.max(0, fitRadius(b) - inset);
  const x = b.x + inset;
  const y = b.y + inset;
  const w = b.w - 2 * inset;
  const h = b.h - 2 * inset;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.arc(x + w - r, y + r, r, -HALF_PI, 0);
  p.lineTo(x + w, y + h - r);
  p.arc(x + w - r, y + h - r, r, 0, HALF_PI);
  p.lineTo(x + r, y + h);
  p.arc(x + r, y + h - r, r, HALF_PI, Math.PI);
  p.lineTo(x, y + r);
  p.arc(x + r, y + r, r, Math.PI, Math.PI + HALF_PI);
  p.closePath();
}
