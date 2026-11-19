/**
 * "Seamless and nonstop", proven. Every effect is run headlessly through a recording canvas (src/test/fxRecorder.ts) with a fixed seed, and
 * the light each frame puts down ("ink") is compared frame to frame — through focus changes, typing, Enter, resizes, a 10 minute run and a
 * huge clock. A pop, a jump, a restart or a blank frame shows up as a step in that number; the thresholds below are what each effect
 * is held to, and the only steps allowed are the ones the effect schedules on purpose (a lightning strike, a neon stutter, the Enter burst).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { frameDt, newEnergy, stepEnergy } from '@/features/home/effects/engine';
import { runEffect, type Script, seedRandom } from '@/test/fxRecorder';
import { cometPoints, quadCorners, wrapPhase } from './beam';
import { boxTrack, perimeter, roundRectPath } from './geometry';
import type { EffectName } from './types';

const NAMES: readonly EffectName[] = ['beam', 'fire', 'electric', 'haze', 'neon', 'aurora', 'stardust', 'matrix', 'lava'];
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] as number;
const small = { w: 200, h: 40, r: 8 };

let undo: () => void = () => {};
beforeEach(() => {
  undo = seedRandom(20260101);
});
afterEach(() => undo());

/** Relative step of the 4-frame-smoothed ink between consecutive frames, against the median of the last 90 frames. */
function steps(ink: number[]): number[] {
  const W = 4;
  const sm = ink.map((_, i) => (i < W ? (ink[i] as number) : ink.slice(i - W + 1, i + 1).reduce((a, b) => a + b, 0) / W));
  const out: number[] = [];
  for (let i = 100; i < sm.length; i++) out.push(Math.abs((sm[i] as number) - (sm[i - 1] as number)) / (median(sm.slice(i - 90, i)) + 1));
  return out;
}

function simulate(
  name: EffectName,
  seconds: number,
  script: Script,
  over: Parameters<typeof runEffect>[1] = {},
): { ink: number[]; run: ReturnType<typeof runEffect>; dt: number } {
  const run = runEffect(name, { script, ...over });
  const dt = 1 / run.fx.fps;
  const ink: number[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) ink.push(run.step(dt));
  return { ink, run, dt };
}

// the most each effect's light may change from one frame to the next (smoothed), with and without the person doing things
const CALM: Record<EffectName, number> = {
  beam: 0.03,
  fire: 0.08,
  electric: Number.POSITIVE_INFINITY,
  haze: 0.03,
  neon: 0.3,
  aurora: 0.06,
  stardust: 0.06,
  matrix: 0.2,
  lava: 0.08,
};
const BUSY: Record<EffectName, number> = {
  beam: 0.05,
  fire: 0.25,
  electric: Number.POSITIVE_INFINITY,
  haze: 0.05,
  neon: 0.3,
  aurora: 0.3,
  stardust: 0.06,
  matrix: 0.4,
  lava: 0.15,
};

describe('Beam seam (the loop point)', () => {
  const box = { x: 10.5, y: 10.5, w: 299, h: 55, r: 9.5 };
  const track = boxTrack(box);
  const L = perimeter(box);

  it('the path closes exactly: distance 0 and the full perimeter are the same point', () => {
    const a = track.at(0);
    const b = track.at(L);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(track.length).toBeCloseTo(L, 9);
    // and so are k perimeters further on, either way
    for (const k of [-3, -1, 1, 4]) {
      const p = track.at(37 + k * L);
      expect(p.x).toBeCloseTo(track.at(37).x, 6);
      expect(p.y).toBeCloseTo(track.at(37).y, 6);
    }
  });

  it('the rounded-rect path used for drawing starts and ends at the same point (no gap at the start corner)', () => {
    const ops: Array<{ op: string; a: number[] }> = [];
    const rec = new Proxy(
      {},
      {
        get:
          (_t, op) =>
          (...a: number[]) =>
            void ops.push({ op: String(op), a }),
      },
    );
    const b = { x: 4, y: 6, w: 120, h: 40, r: 10 };
    roundRectPath(rec as unknown as Path2D, b, 0);
    const start = ops[0] as { a: number[] };
    expect(ops[0]?.op).toBe('moveTo');
    const lastArc = [...ops].reverse().find((o) => o.op === 'arc') as { a: number[] };
    const [cx, cy, r, , end] = lastArc.a as [number, number, number, number, number];
    expect(cx + r * Math.cos(end)).toBeCloseTo(start.a[0] as number, 9);
    expect(cy + r * Math.sin(end)).toBeCloseTo(start.a[1] as number, 9);
  });

  it('the tail drawn across the wrap is the same shape as one drawn mid-edge: equal spacing, all on the path, no long chord', () => {
    const tail = 230;
    const n = 44;
    const onPath = (p: { x: number; y: number }) => {
      // distance to the outline: the point must be (within rounding) on the rounded rectangle
      let best = Number.POSITIVE_INFINITY;
      for (let d = 0; d < L; d += 0.5) {
        const q = track.at(d);
        best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
      }
      return best;
    };
    for (const head of [100, 3, 0, L - 2, L, L + 40, 5 * L + 20]) {
      const pts = cometPoints(track, head, 1, tail, n);
      expect(pts).toHaveLength(n + 1);
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot((pts[i]?.x as number) - (pts[i - 1]?.x as number), (pts[i]?.y as number) - (pts[i - 1]?.y as number));
        expect(d, `head ${head} step ${i}`).toBeLessThanOrEqual(tail / n + 1e-9);
        expect(d, `head ${head} step ${i}`).toBeGreaterThan((tail / n) * 0.97); // a chord on a corner is a hair shorter, never a gap or a jump
      }
      for (const i of [0, 11, 22, 44]) expect(onPath(pts[i] as { x: number; y: number }), `head ${head} point ${i}`).toBeLessThan(0.6);
    }
    // the same tail, shifted by exactly one perimeter, is identical
    const a = cometPoints(track, 7, -1, tail * 0.6, n);
    const b = cometPoints(track, 7 + L, -1, tail * 0.6, n);
    a.forEach((p, i) => {
      expect(p.x).toBeCloseTo((b[i] as { x: number }).x, 6);
      expect(p.y).toBeCloseTo((b[i] as { y: number }).y, 6);
    });
  });

  it('wrapPhase keeps a distance in [0, length) whichever way it moved, and is continuous across the wrap', () => {
    expect(wrapPhase(L + 3, L)).toBeCloseTo(3, 9);
    expect(wrapPhase(-3, L)).toBeCloseTo(L - 3, 9);
    expect(wrapPhase(0, L)).toBe(0);
    for (const d of [-1e6, -L, -0.1, 0, 0.1, L, 1e6 + 0.3]) {
      const w = wrapPhase(d, L);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(L);
    }
  });

  it('both comets: every frame of 6 laps — through focus changes, typing and Enter — moves each head by about speed·dt, never jumps, and stays on the border', () => {
    const run = runEffect('beam', { script: { focus: (t) => t > 7 && t < 21, type: [10, 10.2, 10.4, 10.6, 15], enter: [13, 24] } });
    const dt = 1 / run.fx.fps;
    const track2 = run.geo.track;
    // the head dots: the first comet's is the bigger one (r ≈ 2.6), the counter-rotating one's the smaller (r ≈ 1.6)
    const heads = (): Array<{ x: number; y: number }> => run.main.arcs.filter((a) => a.r > 1.2 && a.r < 3).sort((p, q) => q.r - p.r);
    let prev: Array<{ x: number; y: number }> | null = null;
    const steps2: number[][] = [[], []];
    let seam = 0;
    const seamPt = track2.at(0);
    for (let i = 0; i < Math.round(45 / dt); i++) {
      run.step(dt);
      const h = heads();
      expect(h.length).toBe(2);
      // the heads sit on the outline: the dots are drawn at track.at(...), so distance to the nearest outline sample is ~0
      for (const p of h) {
        let best = Number.POSITIVE_INFINITY;
        for (let d = 0; d < track2.length; d += 1) {
          const q = track2.at(d);
          best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
        }
        if (i % 40 === 0) expect(best).toBeLessThan(0.75);
      }
      if (prev) {
        h.forEach((p, k) => {
          const before = (prev as Array<{ x: number; y: number }>)[k] as { x: number; y: number };
          const step = Math.hypot(p.x - before.x, p.y - before.y);
          (steps2[k] as number[]).push(step);
          if (k === 0 && Math.hypot(p.x - seamPt.x, p.y - seamPt.y) < 6) seam++;
        });
      }
      prev = h.map((p) => ({ x: p.x, y: p.y }));
    }
    expect(seam).toBeGreaterThan(5); // the first comet really did cross the start of the path, several times
    for (const [k, list] of steps2.entries()) {
      const typical = median(list);
      // never faster than the dash allows and never a hop
      const maxSpeedPerFrame = (track2.length / (5.3 - 1.4)) * (1 + 1.2) * (k === 1 ? 0.61 : 1) * dt * 1.15;
      expect(Math.max(...list), `comet ${k}`).toBeLessThan(maxSpeedPerFrame);
      // and consecutive steps never differ by more than a small factor: the speed itself is continuous
      let worst = 1;
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1] as number;
        const b = list[i] as number;
        if (a > 0.05 && b > 0.05) worst = Math.max(worst, b / a, a / b);
      }
      expect(worst, `comet ${k} speed ratio between frames`).toBeLessThan(1.35);
      expect(typical).toBeGreaterThan(1);
    }
  });
});

describe('Beam tail ribbon (no gaps, steps or twists on corners)', () => {
  for (const r of [6, 10, 16, 28]) {
    it(`radius ${r}px: consecutive slices share their edges, each slice is a proper convex quad, all the way round`, () => {
      const box = { x: 10.5, y: 10.5, w: 299, h: 55, r };
      const track = boxTrack(box);
      const width = (u: number) => 11 * (1 - u * 0.5);
      const n = 44;
      for (let head = 0; head < track.length; head += 3.7) {
        const pts = cometPoints(track, head, 1, 230, n);
        let prev: Array<[number, number]> | null = null;
        for (let i = 0; i < n; i++) {
          const q = quadCorners(pts[i] as never, pts[i + 1] as never, width(i / n), width((i + 1) / n));
          if (prev) {
            // this slice starts exactly where the previous one ended: both outer corners coincide
            expect(q[0]?.[0]).toBeCloseTo((prev[1] as number[])[0] as number, 9);
            expect(q[0]?.[1]).toBeCloseTo((prev[1] as number[])[1] as number, 9);
            expect(q[3]?.[0]).toBeCloseTo((prev[2] as number[])[0] as number, 9);
            expect(q[3]?.[1]).toBeCloseTo((prev[2] as number[])[1] as number, 9);
          }
          // convex, not twisted: every turn has the same sign
          const sign = (a: number[], b: number[], c: number[]) =>
            ((b[0] as number) - (a[0] as number)) * ((c[1] as number) - (b[1] as number)) -
            ((b[1] as number) - (a[1] as number)) * ((c[0] as number) - (b[0] as number));
          const signs = [0, 1, 2, 3].map((k) => Math.sign(sign(q[k] as number[], q[(k + 1) % 4] as number[], q[(k + 2) % 4] as number[])));
          expect(new Set(signs.filter((v) => v !== 0)).size, `head ${head} slice ${i}`).toBeLessThanOrEqual(1);
          prev = q;
        }
      }
    });
  }

  it('square corners (radius 0) stay finite', () => {
    const track = boxTrack({ x: 10.5, y: 10.5, w: 299, h: 55, r: 0 });
    for (let head = 0; head < track.length; head += 5) {
      for (const p of cometPoints(track, head, 1, 230, 44)) expect(Number.isFinite(p.x + p.y + p.nx + p.ny)).toBe(true);
    }
  });
});

describe('Beam when the box is resized', () => {
  it('each comet keeps the same fraction of the way round (it does not hop to a new place)', () => {
    const run = runEffect('beam', { script: { focus: () => true } });
    for (let i = 0; i < 180; i++) run.step(1 / 60);
    const fractionOf = (): number[] => {
      const t = run.geo.track;
      return run.main.arcs
        .filter((a) => a.r > 1.2 && a.r < 3)
        .sort((p, q) => q.r - p.r)
        .map((h) => {
          let best = 0;
          let bestD = Number.POSITIVE_INFINITY;
          for (let d = 0; d < t.length; d += 0.5) {
            const q = t.at(d);
            const dist = Math.hypot(q.x - h.x, q.y - h.y);
            if (dist < bestD) {
              bestD = dist;
              best = d;
            }
          }
          return best / t.length;
        });
    };
    const before = fractionOf();
    const g = run.geo;
    const wider = {
      ...g,
      w: g.w + 60,
      box: { ...g.box, w: g.box.w + 60 },
      track: boxTrack({ x: g.box.x + 0.5, y: g.box.y + 0.5, w: g.box.w + 59, h: g.box.h - 1, r: g.box.r - 0.5 }),
    };
    run.fx.setup(wider);
    run.geo.track = wider.track;
    run.step(1e-6);
    const after = fractionOf();
    before.forEach((f, i) => {
      const d = Math.abs(f - (after[i] as number));
      expect(Math.min(d, 1 - d), `comet ${i}`).toBeLessThan(0.004);
    });
  });
});

describe('continuity of every effect', () => {
  for (const name of NAMES) {
    it(`${name}: focus changes alone never make it pop`, { timeout: 180000 }, () => {
      const { ink } = simulate(name, 36, { focus: (t) => t > 10 && t < 22 });
      expect(ink.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      expect(Math.max(...steps(ink)), name).toBeLessThanOrEqual(CALM[name]);
    });

    it(`${name}: typing and Enter stay within the effect's own bound`, { timeout: 180000 }, () => {
      const { ink } = simulate(name, 40, { focus: (t) => t > 6, type: [12, 12.25, 12.5, 12.75, 31, 31.1, 31.2], enter: [20] });
      expect(Math.max(...steps(ink)), name).toBeLessThanOrEqual(BUSY[name]);
    });

    it(`${name}: never goes blank, and never stops moving`, { timeout: 180000 }, () => {
      const { ink } = simulate(name, 20, {});
      expect(Math.min(...ink.slice(30))).toBeGreaterThan(0);
      // moving: the light keeps changing from frame to frame (not a frozen frame)
      const changes = ink.slice(30).filter((v, i) => i > 0 && v !== ink[30 + i - 1]).length;
      expect(changes).toBeGreaterThan(ink.length * 0.4);
    });

    it(`${name}: a resize in the middle keeps the state (it doesn't restart)`, { timeout: 180000 }, () => {
      const run = runEffect(name, { script: { focus: () => true } });
      const dt = 1 / run.fx.fps;
      const before: number[] = [];
      for (let i = 0; i < Math.round(10 / dt); i++) before.push(run.step(dt));
      const g = run.geo;
      // same box again (what a ResizeObserver repeat looks like), then a wider one
      run.fx.setup({ ...g });
      const same = run.step(dt);
      run.fx.setup({
        ...g,
        w: g.w + 24,
        box: { ...g.box, w: g.box.w + 24 },
        track: boxTrack({ x: g.box.x + 0.5, y: g.box.y + 0.5, w: g.box.w + 23, h: g.box.h - 1, r: Math.max(0, g.box.r - 0.5) }),
      });
      const wider: number[] = [];
      for (let i = 0; i < Math.round(3 / dt); i++) wider.push(run.step(dt));
      const base = median(before.slice(-60)) + 1;
      if (name !== 'electric') {
        expect(same / base, name).toBeGreaterThan(0.45);
        expect(same / base, name).toBeLessThan(2.2);
        expect(median(wider) / base, name).toBeGreaterThan(0.4);
        expect(median(wider) / base, name).toBeLessThan(2.6);
      } else {
        expect(median(wider)).toBeGreaterThan(0);
      }
    });
  }

  it('electric: bolts are events, but the border never goes dark and a strike never exceeds a plausible flash', () => {
    const { ink } = simulate('electric', 40, { focus: (t) => t > 6, type: [12, 20], enter: [25] });
    const typical = median(ink);
    expect(Math.min(...ink)).toBeGreaterThan(typical * 0.05);
    expect(Math.max(...ink)).toBeLessThan(typical * 60);
  });
});

describe('long and strange runs', () => {
  for (const name of NAMES) {
    it(`${name}: ten simulated minutes at the worst-case frame step look like the first ten seconds`, { timeout: 300000 }, () => {
      const run = runEffect(name, {
        box: small,
        script: {
          focus: (t) => Math.floor(t / 7) % 2 === 1,
          type: Array.from({ length: 80 }, (_, i) => 20 + i * 7.3),
          enter: Array.from({ length: 30 }, (_, i) => 33 + i * 19),
        },
      });
      const dt = 0.1; // the engine never hands an effect more than this
      const ink: number[] = [];
      for (let i = 0; i < 6000; i++) ink.push(run.step(dt));
      expect(
        ink.every((v) => Number.isFinite(v) && v >= 0),
        name,
      ).toBe(true);
      const first = median(ink.slice(50, 150)) + 1;
      const last = median(ink.slice(-100)) + 1;
      expect(last / first, `${name} after 10 minutes`).toBeGreaterThan(0.3);
      expect(last / first, `${name} after 10 minutes`).toBeLessThan(3.2);
    });

    it(`${name}: a huge clock (10 hours in) behaves like a fresh one`, { timeout: 180000 }, () => {
      const fresh = simulate(name, 12, {});
      undo();
      undo = seedRandom(20260101);
      const old = simulate(name, 12, {}, { start: 36000 });
      expect(
        old.ink.every((v) => Number.isFinite(v)),
        name,
      ).toBe(true);
      const a = median(fresh.ink.slice(60)) + 1;
      const b = median(old.ink.slice(60)) + 1;
      expect(b / a, name).toBeGreaterThan(0.5);
      expect(b / a, name).toBeLessThan(2);
      if (name !== 'electric') expect(Math.max(...steps(old.ink)), name).toBeLessThanOrEqual(BUSY[name]);
    });

    it(`${name}: the thumbnail size and the ⌘K strip run clean too`, { timeout: 180000 }, () => {
      for (const over of [{ scale: 0.5 }, { mode: 'line' as const, scale: 0.5 }, { dark: false }]) {
        const { ink } = simulate(name, 12, { focus: (t) => t > 4 }, over);
        expect(
          ink.every((v) => Number.isFinite(v) && v >= 0),
          `${name} ${JSON.stringify(over)}`,
        ).toBe(true);
        expect(Math.max(...ink)).toBeGreaterThan(0);
      }
    });
  }
});

describe('the engine around the effects', () => {
  it('energy never jumps: focus, a keystroke and Enter all ramp (no frame changes it by more than a small step)', () => {
    const st = newEnergy();
    let prev = stepEnergy(st, 1 / 60, false);
    let worst = 0;
    let worstBurst = 0;
    for (let i = 1; i < 60 * 12; i++) {
      if (i === 60) st.typed = Math.min(1.2, st.typed + 0.42);
      if (i === 200) st.burstRaw = 1;
      const e = stepEnergy(st, 1 / 60, i > 100 && i < 400);
      worst = Math.max(worst, Math.abs(e.energy - prev.energy));
      worstBurst = Math.max(worstBurst, Math.abs(e.burst - prev.burst));
      prev = e;
    }
    expect(worst).toBeLessThan(0.06);
    expect(worstBurst).toBeLessThan(0.16);
  });

  it('a long gap (hidden tab, throttled frame) resumes as one normal frame instead of hopping', () => {
    expect(frameDt(1000, 0)).toBeCloseTo(1 / 60, 9);
    expect(frameDt(1016, 1000)).toBeCloseTo(0.016, 9);
    expect(frameDt(1080, 1000)).toBeCloseTo(0.08, 9);
    expect(frameDt(1200, 1000)).toBeCloseTo(0.1, 9); // slow frames are capped…
    expect(frameDt(60_000, 1000)).toBeCloseTo(1 / 60, 9); // …and a minute-long gap is not simulated at all
    expect(frameDt(900, 1000)).toBe(0);
  });
});
