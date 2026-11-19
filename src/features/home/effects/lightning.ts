/**
 * Procedural lightning: random midpoint displacement (every segment is split and its middle pushed sideways by a random amount that
 * halves each round), with branches that fork off the main stroke. Pure and seeded, so it is testable; the electric effect
 * draws what this returns.
 */
import type { Pt, Track } from './geometry';
import { between, chance, type Rng } from './rng';

export type V2 = { x: number; y: number };
export type Bolt = { main: V2[]; branches: V2[][] };

/** Split every segment of `pts` `rounds` times, displacing each new midpoint perpendicular to its segment by up to `jitter`·length. */
export function jagged(rng: Rng, pts: readonly V2[], jitter: number, rounds: number): V2[] {
  let cur: V2[] = pts.map((p) => ({ x: p.x, y: p.y }));
  let amp = jitter;
  for (let i = 0; i < rounds; i++) {
    const next: V2[] = [];
    for (let k = 0; k < cur.length - 1; k++) {
      const a = cur[k] as V2;
      const b = cur[k + 1] as V2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = (rng() * 2 - 1) * amp * len;
      next.push(a, { x: (a.x + b.x) / 2 + (-dy / len) * off, y: (a.y + b.y) / 2 + (dx / len) * off });
    }
    next.push(cur[cur.length - 1] as V2);
    cur = next;
    amp *= 0.62;
  }
  return cur;
}

export type BoltOptions = {
  /** Length of the stroke along the track, px. */
  length: number;
  /** Where along the track it starts. */
  from: number;
  /** How far outside the track the stroke wanders, px (a little random each time). */
  standoff: number;
  /** Sideways wobble, as a fraction of segment length (0.2 = lively). */
  jitter: number;
  /** Chance that a vertex sprouts a branch. */
  branchChance: number;
  /** Scale for lengths (thumbnails are drawn smaller). */
  scale?: number;
};

/** A bolt that arcs along `track`, close to its edge, with branches reaching away from it. */
export function arcAlong(rng: Rng, track: Track, o: BoltOptions): Bolt {
  const s = o.scale ?? 1;
  const n = Math.max(4, Math.round(o.length / (14 * s)));
  const base: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const wobble = between(rng, -0.5, 0.5) * o.standoff;
    base.push(track.at(o.from + (o.length * i) / n, o.standoff * 0.6 + wobble));
  }
  const main = jagged(rng, base, o.jitter, 3);
  return { main, branches: branchesOf(rng, main, o.branchChance, s) };
}

/** A bolt that leaves the track at `from` and strikes out to a point `reach` away (outward) and `drift` along it. */
export function strikeOut(rng: Rng, track: Track, from: number, reach: number, drift: number, jitter: number, branchChance: number, scale = 1): Bolt {
  const a = track.at(from, 1);
  const b = track.at(from + drift, reach);
  const main = jagged(rng, [a, b], jitter, 5);
  return { main, branches: branchesOf(rng, main, branchChance, scale) };
}

/** Forks off random vertices: short, jagged, angled 18–50° from the stroke, shorter the further along they start. */
export function branchesOf(rng: Rng, main: readonly V2[], p: number, scale = 1): V2[][] {
  const out: V2[][] = [];
  for (let i = 2; i < main.length - 2; i++) {
    if (!chance(rng, p)) continue;
    const a = main[i] as V2;
    const prev = main[i - 2] as V2;
    const heading = Math.atan2(a.y - prev.y, a.x - prev.x);
    const turn = (rng() < 0.5 ? -1 : 1) * between(rng, 0.3, 0.9);
    const len = between(rng, 16, 52) * scale * (1 - (i / main.length) * 0.5);
    const end = { x: a.x + Math.cos(heading + turn) * len, y: a.y + Math.sin(heading + turn) * len };
    out.push(jagged(rng, [a, end], 0.28, 2));
    if (out.length >= 4) break;
  }
  return out;
}

/** The bounding box of a bolt, for cheap culling and the flash. */
export function boltBounds(b: Bolt): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of [...b.main, ...b.branches.flat()]) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}
