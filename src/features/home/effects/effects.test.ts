import { afterEach, describe, expect, it, vi } from 'vitest';
import { newEnergy, stepEnergy } from './engine';
import { boxTrack, fitRadius, lineTrack, perimeter, pointAt, roundRectPath, samples } from './geometry';
import { arcAlong, branchesOf, jagged, strikeOut, type V2 } from './lightning';
import { fbm, noise2, smoothstep, wave } from './noise';
import { capped, FORCES, lifeFraction, type Particle, step, stepAll } from './particles';
import { between, chance, clamp, int, mulberry32 } from './rng';
import { activeCount, subscribe } from './scheduler';

const box = { x: 10, y: 20, w: 200, h: 56, r: 10 };
const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('expected a value');
  return v;
};

describe('mulberry32', () => {
  it('is deterministic per seed, different across seeds, and stays in [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seq = Array.from({ length: 50 }, () => a());
    expect(seq).toEqual(Array.from({ length: 50 }, () => b()));
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });

  it('helpers stay in range', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      expect(between(r, 3, 5)).toBeGreaterThanOrEqual(3);
      expect(between(r, 3, 5)).toBeLessThan(5);
      expect([1, 2, 3]).toContain(int(r, 1, 3));
    }
    expect(chance(() => 0.99, 0.5)).toBe(false);
    expect(chance(() => 0.01, 0.5)).toBe(true);
    expect(clamp(9, 0, 5)).toBe(5);
  });
});

describe('noise', () => {
  it('is deterministic, smooth and bounded', () => {
    expect(noise2(3.3, 1.1)).toBe(noise2(3.3, 1.1));
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.37, i * 0.11, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(noise2(5.001, 2) - noise2(5, 2))).toBeLessThan(0.02);
  });

  it('wave wobbles irregularly inside [0, 1] and never repeats on a short period', () => {
    const vals = Array.from({ length: 400 }, (_, i) => wave(i * 0.05, 2));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.4); // it really moves
    expect(wave(1.234, 1)).not.toBe(wave(1.234, 2)); // seeds decorrelate
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});

describe('box track (the rounded rectangle everything travels on)', () => {
  it('has the perimeter of a rounded rectangle', () => {
    expect(perimeter(box)).toBeCloseTo(2 * (200 - 20) + 2 * (56 - 20) + 2 * Math.PI * 10, 6);
    expect(perimeter({ ...box, r: 0 })).toBe(2 * (200 + 56));
  });

  it('never lets the radius exceed half the short side (a full pill at most)', () => {
    expect(fitRadius({ ...box, r: 500 })).toBe(28);
    expect(fitRadius({ ...box, r: -3 })).toBe(0);
  });

  it('is closed: wraps around, and every point lies on the outline', () => {
    const total = perimeter(box);
    for (let i = 0; i < 60; i++) {
      const d = (total * i) / 60;
      const p = pointAt(box, d);
      expect(pointAt(box, d + total).x).toBeCloseTo(p.x, 6);
      expect(pointAt(box, d + total).y).toBeCloseTo(p.y, 6);
      // inside the bounding box, within rounding
      expect(p.x).toBeGreaterThanOrEqual(box.x - 1e-6);
      expect(p.x).toBeLessThanOrEqual(box.x + box.w + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(box.y - 1e-6);
      expect(p.y).toBeLessThanOrEqual(box.y + box.h + 1e-6);
      // the normal is a unit vector and the tangent is perpendicular to it
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 6);
      expect(p.nx * p.tx + p.ny * p.ty).toBeCloseTo(0, 6);
    }
  });

  it('starts at the top edge heading right, with the normal pointing out (up)', () => {
    const p = pointAt(box, 0);
    expect(p.x).toBeCloseTo(box.x + 10);
    expect(p.y).toBe(box.y);
    expect([p.nx, p.ny]).toEqual([0, -1]);
    expect(pointAt(box, box.w / 2 - 10 + 5).ny).toBe(-1);
  });

  it('visits the four edges in clockwise order: right edge goes down, bottom goes left, left goes up', () => {
    const top = box.w - 20;
    const arc = (Math.PI / 2) * 10;
    const side = box.h - 20;
    const right = pointAt(box, top + arc + side / 2);
    expect(right.x).toBe(box.x + box.w);
    expect(right.nx).toBe(1);
    const bottom = pointAt(box, top + 2 * arc + side + top / 2);
    expect(bottom.y).toBe(box.y + box.h);
    expect(bottom.ny).toBe(1);
    const left = pointAt(box, top + 3 * arc + side + top + side / 2);
    expect(left.x).toBe(box.x);
    expect(left.nx).toBe(-1);
  });

  it('an offset moves the point along the normal (negative = inside)', () => {
    const p = pointAt(box, 30, 5);
    expect(p.y).toBe(box.y - 5);
    const corner = pointAt(box, box.w - 20 + (Math.PI / 4) * 10, 4); // middle of the top-right corner
    const plain = pointAt(box, box.w - 20 + (Math.PI / 4) * 10);
    expect(Math.hypot(corner.x - plain.x, corner.y - plain.y)).toBeCloseTo(4, 6);
  });

  it('works with square corners and with a pill', () => {
    for (const r of [0, 28]) {
      const b = { ...box, r };
      const total = perimeter(b);
      for (let i = 0; i < 20; i++) expect(Number.isFinite(pointAt(b, (total * i) / 20).x)).toBe(true);
    }
  });

  it('track and samples wrap the same functions', () => {
    const t = boxTrack(box);
    expect(t.closed).toBe(true);
    expect(t.length).toBeCloseTo(perimeter(box));
    const pts = samples(t, 0, 100, 5);
    expect(pts).toHaveLength(5);
    expect(pts[0]?.x).toBeCloseTo(pointAt(box, 0).x);
  });

  it('roundRectPath traces the outline onto any path', () => {
    const calls: string[] = [];
    const rec = new Proxy(
      {},
      {
        get:
          (_t, k) =>
          (..._a: unknown[]) =>
            void calls.push(String(k)),
      },
    );
    roundRectPath(rec as unknown as Path2D, box, 1);
    expect(calls.filter((c) => c === 'arc')).toHaveLength(4);
    expect(calls.at(-1)).toBe('closePath');
  });
});

describe('line track (under the ⌘K field)', () => {
  const t = lineTrack(0, 300, 20);

  it('is open: it clamps at both ends, and out means up', () => {
    expect(t.closed).toBe(false);
    expect(t.at(-50).x).toBe(0);
    expect(t.at(9999).x).toBe(300);
    const p = t.at(120, 6);
    expect([p.x, p.y, p.nx, p.ny]).toEqual([120, 14, 0, -1]);
  });
});

describe('lightning generator', () => {
  const track = boxTrack(box);
  const pts: V2[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it('keeps its endpoints and multiplies its vertices (2^rounds segments)', () => {
    const j = jagged(mulberry32(3), pts, 0.3, 4);
    expect(j).toHaveLength(17);
    expect(j[0]).toEqual(pts[0]);
    expect(j.at(-1)).toEqual(pts[1]);
  });

  it('is deterministic for a seed and different for another', () => {
    expect(jagged(mulberry32(3), pts, 0.3, 4)).toEqual(jagged(mulberry32(3), pts, 0.3, 4));
    expect(jagged(mulberry32(3), pts, 0.3, 4)).not.toEqual(jagged(mulberry32(4), pts, 0.3, 4));
  });

  it('wanders sideways by a bounded amount that shrinks each round', () => {
    const j = jagged(mulberry32(9), pts, 0.3, 5);
    const maxOff = Math.max(...j.map((p) => Math.abs(p.y)));
    expect(maxOff).toBeGreaterThan(1); // it is jagged
    expect(maxOff).toBeLessThan(100 * 0.3 * 1.6); // and bounded by the jitter geometric series
    expect(jagged(mulberry32(9), pts, 0, 5).every((p) => p.y === 0)).toBe(true); // no jitter, straight line
  });

  it('an arc follows the border: it starts and ends near it, stays within a few pixels of it, and may sprout branches', () => {
    const bolt = arcAlong(mulberry32(11), track, { length: 150, from: 20, standoff: 6, jitter: 0.25, branchChance: 0.9 });
    expect(bolt.main.length).toBeGreaterThan(8);
    const start = track.at(20, 3.6);
    expect(Math.hypot(must(bolt.main[0]).x - start.x, must(bolt.main[0]).y - start.y)).toBeLessThan(8);
    expect(bolt.branches.length).toBeGreaterThan(0);
    expect(bolt.branches.length).toBeLessThanOrEqual(4);
    // a hug: no vertex strays further than ~35px from the box
    for (const p of bolt.main) expect(Math.abs(p.y - 20 - 28)).toBeLessThan(28 + 40);
  });

  it('a strike leaves the border and reaches out the requested distance', () => {
    const bolt = strikeOut(mulberry32(5), track, 40, 30, 0, 0.2, 0);
    const a = must(bolt.main[0]);
    const b = must(bolt.main.at(-1));
    expect(a.y).toBeCloseTo(box.y - 1, 6);
    expect(b.y).toBeCloseTo(box.y - 30, 6);
    expect(bolt.branches).toHaveLength(0);
  });

  it('branches start on the bolt and are short', () => {
    const main = jagged(mulberry32(2), pts, 0.2, 4);
    const br = branchesOf(mulberry32(2), main, 1);
    expect(br.length).toBeGreaterThan(0);
    for (const b of br) {
      expect(main).toContainEqual(b[0]);
      const end = must(b.at(-1));
      expect(Math.hypot(end.x - must(b[0]).x, end.y - must(b[0]).y)).toBeLessThan(60);
    }
    expect(branchesOf(mulberry32(2), main, 0)).toEqual([]);
  });
});

describe('particles', () => {
  const p = (over: Partial<Particle> = {}): Particle => ({ kind: 'flame', x: 0, y: 0, vx: 0, vy: -100, age: 0, life: 0.5, size: 5, seed: 0.3, ...over });

  it('flames rise (buoyancy pulls them up), embers rise too, sparks fall', () => {
    const f = p();
    const e = p({ kind: 'ember', vy: -10 });
    const s = p({ kind: 'spark', vy: -10 });
    for (let i = 0; i < 6; i++) {
      step(f, 1 / 60, i / 60);
      step(e, 1 / 60, i / 60);
      step(s, 1 / 60, i / 60);
    }
    expect(f.y).toBeLessThan(-5);
    expect(e.y).toBeLessThan(0);
    expect(f.vy).toBeLessThan(-100 * 0.8); // drag slows it, buoyancy keeps it going
    expect(s.vy).toBeGreaterThan(-10); // gravity wins on a spark
    expect(FORCES.spark.ay).toBeGreaterThan(0);
    expect(FORCES.flame.ay).toBeLessThan(0);
  });

  it('dies exactly when its life is up', () => {
    const f = p({ life: 0.1 });
    expect(step(f, 0.05, 0)).toBe(true);
    expect(step(f, 0.06, 0)).toBe(false);
  });

  it('turbulence moves it sideways, deterministically', () => {
    const a = p({ vy: 0 });
    const b = p({ vy: 0 });
    for (let i = 0; i < 30; i++) {
      step(a, 1 / 60, i / 60);
      step(b, 1 / 60, i / 60);
    }
    expect(a.x).not.toBe(0);
    expect(a.x).toBe(b.x);
  });

  it('stepAll drops the dead in place and keeps the living in order', () => {
    const list = [p({ life: 0.01, x: 1 }), p({ life: 5, x: 2 }), p({ life: 0.01, x: 3 }), p({ life: 5, x: 4 })];
    stepAll(list, 0.05, 0);
    expect(list.map((q) => Math.round(q.x))).toEqual([2, 4].map((x) => Math.round(list.find((q) => Math.round(q.x) === x)?.x ?? NaN)));
    expect(list).toHaveLength(2);
  });

  it('lifeFraction runs 0 → 1 and capped keeps the newest', () => {
    expect(lifeFraction(p({ age: 0.25 }))).toBe(0.5);
    expect(lifeFraction(p({ age: 9 }))).toBe(1);
    const l = [1, 2, 3, 4, 5];
    capped(l, 3);
    expect(l).toEqual([3, 4, 5]);
  });
});

describe('energy (how typing and Enter feed an effect)', () => {
  const settle = (st: ReturnType<typeof newEnergy>, focus: boolean, seconds = 3) => {
    let e = { energy: 0, burst: 0 };
    for (let i = 0; i < seconds * 60; i++) e = stepEnergy(st, 1 / 60, focus);
    return e;
  };

  it('a calm, unfocused box settles low; focus settles it higher', () => {
    expect(settle(newEnergy(), true).energy).toBeGreaterThan(settle(newEnergy(), false).energy);
  });

  it('typing raises it and it settles back within a couple of seconds', () => {
    const st = newEnergy();
    settle(st, true);
    const calm = st.energy;
    st.typed = 1;
    let peak = 0;
    for (let i = 0; i < 40; i++) peak = Math.max(peak, stepEnergy(st, 1 / 60, true).energy);
    expect(peak).toBeGreaterThan(calm + 0.3);
    expect(settle(st, true, 4).energy).toBeLessThan(calm + 0.05);
  });

  it('Enter is a short, sharp kick that ramps up (not a single-frame step) and dies away', () => {
    const st = newEnergy();
    st.burstRaw = 1;
    const first = stepEnergy(st, 1 / 60, true).burst;
    expect(first).toBeGreaterThan(0.05);
    expect(first).toBeLessThan(0.5); // the ramp takes several frames
    let peak = first;
    for (let i = 0; i < 30; i++) peak = Math.max(peak, stepEnergy(st, 1 / 60, true).burst);
    expect(peak).toBeGreaterThan(0.5);
    expect(settle(st, true, 2).burst).toBeLessThan(0.1);
  });
});

describe('shared scheduler', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs every subscriber from one loop and stops when the last leaves', () => {
    const cbs: FrameRequestCallback[] = [];
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => cbs.push(cb));
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe(a);
    const offB = subscribe(b);
    expect(activeCount()).toBe(2);
    expect(raf).toHaveBeenCalledTimes(1); // one loop, not one per effect
    cbs.shift()?.(16);
    expect(a).toHaveBeenCalledWith(16);
    expect(b).toHaveBeenCalledWith(16);
    expect(raf).toHaveBeenCalledTimes(2); // it re-arms itself while anyone listens
    offA();
    offB();
    expect(activeCount()).toBe(0);
    cbs.shift()?.(32);
    expect(a).toHaveBeenCalledTimes(1); // nothing runs once everyone has left
    expect(raf).toHaveBeenCalledTimes(2);
  });
});
