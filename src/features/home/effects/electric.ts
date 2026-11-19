/**
 * Electric: real lightning. Bolts are generated procedurally (random midpoint displacement with branches — see lightning.ts), arc along
 * or strike away from the border, are re-rolled every ~80–400 ms at irregular intervals, and live only ~70–180 ms with a flickering
 * brightness. Each is drawn in three strokes — a wide blue glow, a cyan body, a thin white core — with sparks flying off the ends.
 * Now and then a flash lights the box and the page around it; between bolts a faint corona crackles along the border. A keystroke
 * strikes a bolt, Enter strikes several and flashes.
 */
import { rgba } from './colors';
import { arcAlong, type Bolt, jagged, strikeOut } from './lightning';
import { capped, lifeFraction, type Particle, stepAll } from './particles';
import { between, mulberry32, type Rng } from './rng';
import type { Fx, FxEnv, FxInput, Geo } from './types';

type Live = { path: Path2D; branches: Path2D; age: number; life: number; power: number; bolt: Bolt };

const pathOf = (pts: ReadonlyArray<{ x: number; y: number }>, into = new Path2D()): Path2D => {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as { x: number; y: number };
    if (i === 0) into.moveTo(p.x, p.y);
    else into.lineTo(p.x, p.y);
  }
  return into;
};

export function createElectric(env: FxEnv): Fx {
  const s = env.scale;
  const rng: Rng = mulberry32(0xe1ec);
  const live: Live[] = [];
  const sparks: Particle[] = [];
  const line = env.mode === 'line';
  let geo: Geo;
  let untilBolt = 0.2;
  let untilFlash = between(rng, 1.6, 4);
  let flash = 0;
  let corona: Path2D | null = null;
  let untilCorona = 0;
  let pending = 0;

  const addBolt = (b: Bolt, power: number) => {
    const branches = new Path2D();
    for (const br of b.branches) pathOf(br, branches);
    live.push({ path: pathOf(b.main), branches, age: 0, life: between(rng, 0.07, 0.18) * (0.8 + 0.5 * power), power, bolt: b });
    capped(live, 6);
    // sparks fly off the far end and where it starts
    const ends = [b.main[0], b.main[b.main.length - 1]];
    for (const e of ends) {
      if (!e) continue;
      const n = Math.round(between(rng, 2, 6) * (0.6 + power * 0.6));
      for (let i = 0; i < n; i++) {
        sparks.push({
          kind: 'spark',
          x: e.x,
          y: e.y,
          vx: between(rng, -150, 150) * s,
          vy: between(rng, -190, 30) * s,
          age: 0,
          life: between(rng, 0.2, 0.55),
          size: between(rng, 0.8, 1.7) * s,
          seed: rng(),
        });
      }
    }
    capped(sparks, 70);
  };

  const strike = (power: number) => {
    const L = geo.track.length;
    const from = rng() * L;
    if (rng() < 0.62) {
      const length = Math.min(L * (line ? 0.5 : 0.4), between(rng, 80, 280) * s * (0.8 + power * 0.5));
      addBolt(
        arcAlong(rng, geo.track, {
          length,
          from,
          standoff: between(rng, 3, 9) * s,
          jitter: between(rng, 0.2, 0.34),
          branchChance: 0.22 + power * 0.1,
          scale: s,
        }),
        power,
      );
    } else {
      const reach = between(rng, 18, line ? 24 : 36) * s * (0.8 + power * 0.4);
      addBolt(strikeOut(rng, geo.track, from, reach, between(rng, -90, 90) * s, 0.3, 0.3, s), power);
    }
  };

  const coronaPath = (): Path2D => {
    const n = Math.max(6, Math.round(geo.track.length / (9 * s)));
    const pts = Array.from({ length: n + 1 }, (_, i) => geo.track.at((geo.track.length * i) / n, 1.2 * s + between(rng, -1, 1) * 1.6 * s));
    return pathOf(jagged(rng, pts, 0.1, 1));
  };

  const drawBolt = (ctx: CanvasRenderingContext2D, l: Live, k: number) => {
    const dark = env.dark;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [path, w] of [
      [l.path, 1],
      [l.branches, 0.62],
    ] as const) {
      ctx.strokeStyle = dark ? rgba([54, 112, 255], 0.2 * k) : rgba([70, 110, 255], 0.2 * k);
      ctx.lineWidth = 9 * s * w;
      ctx.stroke(path);
      ctx.strokeStyle = dark ? rgba([112, 204, 255], 0.78 * k) : rgba([40, 84, 255], 0.9 * k);
      ctx.lineWidth = 3.1 * s * w;
      ctx.stroke(path);
      ctx.strokeStyle = dark ? rgba([238, 249, 255], k) : rgba([255, 255, 255], k);
      ctx.lineWidth = 1.25 * s * w;
      ctx.stroke(path);
    }
  };

  return {
    margin: (line ? 8 : 42) * s,
    fps: 45,
    setup(g) {
      geo = g;
      corona = coronaPath();
    },
    frame(ctx, dt, inp: FxInput) {
      const calm = 0.75 + 0.6 * inp.energy;
      untilBolt -= dt * calm;
      while (untilBolt <= 0) {
        strike(0.35 + 0.4 * inp.energy);
        untilBolt += between(rng, 0.08, 0.42);
      }
      while (pending > 0) {
        pending--;
        strike(1);
      }
      untilFlash -= dt;
      if (untilFlash <= 0) {
        flash = 1;
        strike(1);
        untilFlash = between(rng, 2.2, 6.5);
      }
      flash *= Math.exp(-dt / 0.12);
      untilCorona -= dt;
      if (untilCorona <= 0) {
        corona = coronaPath();
        untilCorona = between(rng, 0.04, 0.09);
      }
      stepAll(sparks, dt, inp.time, s, 1);

      ctx.globalCompositeOperation = env.dark ? 'lighter' : 'source-over';
      const { box } = geo;
      // the flash: the surroundings light up
      if (flash > 0.02) {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const rx = box.w * 0.5 + 38 * s;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, (box.h * 0.5 + 38 * s) / rx);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, env.dark ? `rgba(150,190,255,${0.34 * flash})` : `rgba(80,120,255,${0.22 * flash})`);
        g.addColorStop(1, 'rgba(60,110,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // corona: a faint crackle on the border between the bolts
      if (corona) {
        ctx.lineWidth = 4 * s;
        ctx.strokeStyle = env.dark ? 'rgba(70,130,255,0.09)' : 'rgba(70,110,255,0.1)';
        ctx.stroke(corona);
        ctx.lineWidth = 1 * s;
        ctx.strokeStyle = env.dark ? `rgba(170,220,255,${0.2 + 0.18 * Math.random()})` : `rgba(50,90,255,${0.28 + 0.2 * Math.random()})`;
        ctx.stroke(corona);
      }
      // bolts: quick rise, jittery brightness, gone
      for (let i = live.length - 1; i >= 0; i--) {
        const l = live[i] as Live;
        l.age += dt;
        if (l.age >= l.life) {
          live.splice(i, 1);
          continue;
        }
        const u = l.age / l.life;
        const env01 = u < 0.1 ? u / 0.1 : (1 - (u - 0.1) / 0.9) ** 1.1;
        const k = Math.min(1, env01 * (0.55 + 0.45 * Math.random()) * (0.75 + 0.35 * l.power));
        drawBolt(ctx, l, k);
      }
      // sparks: short bright streaks that fall away
      for (const p of sparks) {
        const u = lifeFraction(p);
        ctx.strokeStyle = env.dark ? `rgba(220,240,255,${1 - u})` : `rgba(40,80,255,${1 - u})`;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      }
      // the border itself flashes
      if (flash > 0.05) {
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * flash})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let i = 0; i <= 80; i++) {
          const p = geo.track.at((geo.track.length * i) / 80);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    },
    rim(ctx) {
      if (flash < 0.03) return;
      ctx.strokeStyle = env.dark ? `rgba(160,200,255,${0.16 * flash})` : `rgba(70,110,255,${0.12 * flash})`;
      ctx.lineWidth = 12 * s;
      ctx.beginPath();
      const { box } = geo;
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.stroke();
    },
    poke(kind) {
      if (kind === 'enter') {
        flash = 1;
        pending += 3;
      } else pending += 1;
    },
  };
}
