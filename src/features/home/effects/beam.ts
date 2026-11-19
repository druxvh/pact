/**
 * Beam: the "border beam" — a crisp comet lapping the box's rounded outline, with a tapering tail that fades to nothing, a hot
 * head, and a soft light it casts just outside (and, faintly, inside) the border. A second, dimmer, slower beam runs the other way.
 * It rides the real outline, so it follows whatever corner radius is set. Typing and focus speed it up; Enter makes it dash.
 */
import { lighten, rgba } from './colors';
import type { Pt, Track } from './geometry';
import { wave } from './noise';
import { surface } from './surface';
import type { Fx, FxEnv, FxInput, Geo, Rgb, Surface } from './types';

const GLOW_DIV = 4;

/** A distance along a closed path, kept in [0, length) — however far or in whichever direction it moved. */
export const wrapPhase = (d: number, length: number): number => ((d % length) + length) % length;

/**
 * The points of a comet's tail: `n + 1` of them, equally spaced *along the path* from the head backwards (`dir` is the way it travels).
 * Positions come from `track.at`, which wraps, so a tail reaching back across the start of the path is identical to one in mid-edge.
 */
export function cometPoints(track: Track, head: number, dir: 1 | -1, tail: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(track.at(head - (dir * tail * i) / n));
  return out;
}

/** One slice of a ribbon: the quad between two path points, `w0` wide at `p0` and `w1` at `p1`, offset along each point's own normal. */
export function quadCorners(p0: Pt, p1: Pt, w0: number, w1: number): Array<[number, number]> {
  return [
    [p0.x + (p0.nx * w0) / 2, p0.y + (p0.ny * w0) / 2],
    [p1.x + (p1.nx * w1) / 2, p1.y + (p1.ny * w1) / 2],
    [p1.x - (p1.nx * w1) / 2, p1.y - (p1.ny * w1) / 2],
    [p0.x - (p0.nx * w0) / 2, p0.y - (p0.ny * w0) / 2],
  ];
}

function quad(ctx: CanvasRenderingContext2D, p0: Pt, p1: Pt, w0: number, w1: number): void {
  const c = quadCorners(p0, p1, w0, w1);
  ctx.beginPath();
  ctx.moveTo((c[0] as number[])[0] as number, (c[0] as number[])[1] as number);
  for (let i = 1; i < 4; i++) ctx.lineTo((c[i] as number[])[0] as number, (c[i] as number[])[1] as number);
  ctx.closePath();
  ctx.fill();
}

export function createBeam(env: FxEnv): Fx {
  const s = env.scale;
  const [r, g, b] = env.accent;
  const hot = lighten(env.accent, 0.72);
  let geo: Geo;
  let len = 1;
  // distances travelled along the track
  let a = 0;
  let c = 0;
  let boost = 0;
  let headA: Pt | null = null;
  let headC: Pt | null = null;
  /** the soft glow of both comets, painted at 1/GLOW_DIV size */
  let glow: Surface | null = null;

  /**
   * The tapering streak, drawn as a *ribbon*: consecutive quads share their edge vertices (offset along the path's normal), so it bends round
   * a corner as one piece. Separate butt-capped strokes left wedge gaps and stair-steps on every corner; round caps beaded the tail.
   */
  const comet = (ctx: CanvasRenderingContext2D, head: number, dir: 1 | -1, tail: number, width: number, alpha: number, flick: number) => {
    const N = 44;
    const add = env.dark;
    const pts = cometPoints(geo.track, head, dir, tail, N);
    const pass = (c2: CanvasRenderingContext2D, w: (u: number) => number, color: Rgb, a: (u: number) => number, until = 1) => {
      for (let i = 0; i < N * until; i++) {
        const u = i / N;
        const al = a(u);
        if (al <= 0.003) continue;
        c2.fillStyle = rgba(color, Math.min(1, al));
        quad(c2, pts[i] as Pt, pts[i + 1] as Pt, w(u), w(u + 1 / N));
      }
    };
    const fall = (u: number) => (1 - u) ** 1.7;
    // the glow is painted wide into a low-resolution buffer and scaled up, which is what makes it soft (hard-edged wide bands stack into visible steps)
    if (glow)
      pass(
        glow.ctx,
        (u) => width * (add ? 5.2 : 3.4) * (1 - u * 0.5),
        env.accent,
        (u) => alpha * fall(u) * (add ? 0.55 : 0.28) * flick,
      );
    pass(
      ctx,
      (u) => width * (1 - u * 0.72),
      env.accent,
      (u) => alpha * fall(u) * 1.05 * flick,
    );
    // white-hot core near the head (on a light page the accent itself carries it)
    if (add)
      pass(
        ctx,
        () => width * 0.55,
        hot,
        (u) => alpha * (1 - u / 0.3) * 0.95 * flick,
        0.3,
      );
    // the head itself and the light it throws
    const h = geo.track.at(head);
    const halo = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 30 * s);
    halo.addColorStop(0, rgba(add ? hot : env.accent, (add ? 0.8 : 0.42) * alpha * flick));
    halo.addColorStop(0.3, rgba(env.accent, (add ? 0.34 : 0.14) * alpha * flick));
    halo.addColorStop(1, rgba(env.accent, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 30 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(add ? hot : env.accent, Math.min(1, alpha * flick));
    ctx.beginPath();
    ctx.arc(h.x, h.y, width * 0.95, 0, Math.PI * 2);
    ctx.fill();
    return h;
  };

  return {
    margin: 28 * s,
    fps: 60,
    setup(g) {
      geo = g;
      glow = surface(env, g.w / GLOW_DIV, g.h / GLOW_DIV);
      glow?.ctx.setTransform(1 / GLOW_DIV, 0, 0, 1 / GLOW_DIV, 0, 0);
      const first = len === 1;
      const was = len;
      len = g.track.length;
      if (first) {
        a = len * 0.07;
        c = len * 0.58;
      } else if (was !== len) {
        // the box changed size: keep each comet at the same *fraction* of the way round, so it doesn't hop
        a = (a / was) * len;
        c = (c / was) * len;
      }
    },
    frame(ctx, dt, inp: FxInput) {
      const lap = 5.3 - 1.4 * Math.min(1, inp.energy / 1.2);
      const speed = (len / lap) * (1 + inp.burst * 1.2);
      boost = inp.energy;
      // phases are integrated (distance += speed·dt), never recomputed from elapsed time, so a change in speed can't make them jump
      a = wrapPhase(a + speed * dt, len);
      c = wrapPhase(c - speed * 0.61 * dt, len);
      const flick = 0.9 + 0.1 * wave(inp.time * 7.1, 1);
      glow?.ctx.clearRect(0, 0, geo.w, geo.h);
      ctx.globalCompositeOperation = env.dark ? 'lighter' : 'source-over';
      const tail = Math.min(len * 0.36, 230 * s * (0.9 + 0.35 * Math.min(1, inp.energy)));
      headC = comet(ctx, c, -1, tail * 0.6, 1.7 * s, 0.6, flick);
      headA = comet(ctx, a, 1, tail, 2.7 * s, 1, flick);
      if (glow) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(glow.canvas, 0, 0, geo.w, geo.h);
      }
    },
    rim(ctx, inp) {
      // a faint light cast on the box surface near each head
      for (const [h, k] of [
        [headA, 1],
        [headC, 0.6],
      ] as const) {
        if (!h) continue;
        const gr = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 44 * s);
        gr.addColorStop(0, rgba(env.accent, (env.dark ? 0.2 : 0.16) * k * (0.7 + 0.3 * Math.min(1, boost))));
        gr.addColorStop(1, rgba([r, g, b], 0));
        ctx.fillStyle = gr;
        ctx.fillRect(h.x - 46 * s, h.y - 46 * s, 92 * s, 92 * s);
      }
      void inp;
    },
    poke() {},
  };
}
