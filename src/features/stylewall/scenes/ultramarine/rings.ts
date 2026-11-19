/**
 * The orrery: concentric etched rings with tick marks, tiny glyph boxes, dotted circles and orbiting bodies, drawn around the roundel.
 * `ringSpecs` is data (radius in R0 units, what is on the ring, how fast it turns); `ringSegments` turns a spec into line segments in the
 * ring's own frame (the scene strokes them as one Path2D and rotates the whole ring). Pure and seeded, so it is testable.
 */
import { mulberry32 } from '../../rng';

const TAU = Math.PI * 2;

export type Glyph = { angle: number; kind: number };

export type RingSpec = {
  /** In units of the roundel radius R0. */
  r: number;
  /** Radians per second (signed). */
  speed: number;
  /** Alpha of the ring's lines. */
  alpha: number;
  /** The ring itself (a thin circle). */
  circle: boolean;
  /** Ticks: how many around, and the short / medium / long lengths in R0 units; `every` = [medium, long] strides. */
  ticks?: { count: number; len: [number, number, number]; every: [number, number]; inward?: boolean };
  /** Glyph boxes: a count of small framed squares with a mark inside, at irregular angles. */
  boxes?: { count: number; size: number };
  /** Dots: one per step, with larger lozenges at the cardinal points. */
  dots?: { count: number; size: number };
};

export const RINGS: readonly RingSpec[] = [
  { r: 1.045, speed: 0, alpha: 0.9, circle: true },
  { r: 1.1, speed: 0.0038, alpha: 0.7, circle: true, ticks: { count: 144, len: [0.01, 0.02, 0.034], every: [6, 12] } },
  { r: 1.24, speed: -0.0026, alpha: 0.75, circle: true, boxes: { count: 14, size: 0.052 } },
  { r: 1.4, speed: 0.0019, alpha: 0.6, circle: false, dots: { count: 180, size: 0.0065 } },
  { r: 1.58, speed: -0.0013, alpha: 0.5, circle: true, ticks: { count: 360, len: [0.008, 0.016, 0.03], every: [5, 15], inward: false } },
  { r: 1.82, speed: 0.0009, alpha: 0.42, circle: true, ticks: { count: 72, len: [0.02, 0.04, 0.07], every: [2, 6] }, boxes: { count: 6, size: 0.04 } },
  { r: 2.2, speed: -0.0006, alpha: 0.3, circle: true, ticks: { count: 36, len: [0.03, 0.05, 0.09], every: [3, 9] } },
];

export type Seg = [number, number, number, number];

/** A glyph mark inside a box of half-size h (centre 0,0), picked by `kind`: bar, cross, dot-and-bar, corner, slash, ring. */
function glyphSegments(kind: number, h: number): Seg[] {
  const q = h * 0.55;
  switch (kind % 6) {
    case 0:
      return [[-q, 0, q, 0]];
    case 1:
      return [
        [-q, 0, q, 0],
        [0, -q, 0, q],
      ];
    case 2:
      return [
        [-q, q * 0.6, q, q * 0.6],
        [0, -q, 0, -q * 0.2],
      ];
    case 3:
      return [
        [-q, -q, q, -q],
        [-q, -q, -q, q],
      ];
    case 4:
      return [[-q, q, q, -q]];
    default:
      return [
        [-q, 0, 0, q],
        [0, q, q, 0],
        [q, 0, 0, -q],
        [0, -q, -q, 0],
      ];
  }
}

/**
 * Line segments of a ring's *ticks, boxes and glyphs* in the ring's frame, as `[x0, y0, x1, y1]` in R0 units centred on the ring's
 * centre (the circle and the dots are drawn by arcs in the scene). Deterministic for (spec, seed).
 */
export function ringSegments(spec: RingSpec, ringIndex: number, seed: number): Seg[] {
  const out: Seg[] = [];
  const rng = mulberry32(seed ^ (ringIndex * 0x9e3779b1));
  if (spec.ticks) {
    const { count, len, every, inward } = spec.ticks;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const l = i % every[1] === 0 ? len[2] : i % every[0] === 0 ? len[1] : len[0];
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r0 = inward ? spec.r - l : spec.r;
      const r1 = inward ? spec.r : spec.r + l;
      out.push([c * r0, s * r0, c * r1, s * r1]);
    }
  }
  if (spec.boxes) {
    const { count, size } = spec.boxes;
    const h = size / 2;
    for (let i = 0; i < count; i++) {
      const a = ((i + (rng() - 0.5) * 0.7) / count) * TAU;
      const cx = Math.cos(a) * spec.r;
      const cy = Math.sin(a) * spec.r;
      // the box is axis-aligned to the ring's tangent: rotate its corners by the angle
      const rot = (x: number, y: number): [number, number] => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
      const corners = [rot(-h, -h), rot(h, -h), rot(h, h), rot(-h, h)] as const;
      for (let k = 0; k < 4; k++) {
        const p = corners[k] as [number, number];
        const q = corners[(k + 1) % 4] as [number, number];
        out.push([p[0], p[1], q[0], q[1]]);
      }
      for (const [x0, y0, x1, y1] of glyphSegments(Math.floor(rng() * 6), h)) {
        const p = rot(x0, y0);
        const q = rot(x1, y1);
        out.push([p[0], p[1], q[0], q[1]]);
      }
      // a little radial stalk joining the box to the ring, as on a diagram
      out.push([Math.cos(a) * (spec.r - h), Math.sin(a) * (spec.r - h), Math.cos(a) * (spec.r - h - 0.03), Math.sin(a) * (spec.r - h - 0.03)]);
    }
  }
  return out;
}

export type Body = { ring: number; angle: number; speed: number; size: number };

/** Planets: small circles that travel round a ring (visible slow motion), `angle` at t = 0, `speed` in rad/s. */
export function makeBodies(seed: number): Body[] {
  const rng = mulberry32(seed ^ 0xb0d1e5);
  return [
    { ring: 2, angle: rng() * TAU, speed: 0.021, size: 0.018 },
    { ring: 3, angle: rng() * TAU, speed: -0.014, size: 0.024 },
    { ring: 4, angle: rng() * TAU, speed: 0.009, size: 0.014 },
    { ring: 5, angle: rng() * TAU, speed: -0.006, size: 0.03 },
    { ring: 6, angle: rng() * TAU, speed: 0.0042, size: 0.02 },
  ];
}
