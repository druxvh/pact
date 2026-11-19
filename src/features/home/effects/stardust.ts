/**
 * Stardust: a tiny galaxy round the box. Stars of different size and colour twinkle on their own irregular clocks (a few flare
 * with a little four-point glint); a slow dust lane of hundreds of specks orbits along the border; and now and then — rarely, from a random
 * direction — a shooting star streaks across and fades. Typing makes new stars bloom (they grow in, shine, and fade out again); Enter fires
 * a shooting star. Orbits and drift are integrated (`position += speed·dt`), so nothing jumps when you type.
 */
import { lighten, rgba } from './colors';
import { wave } from './noise';
import { between, int, mulberry32, type Rng } from './rng';
import type { Fx, FxEnv, FxInput, Geo, Rgb } from './types';

type Star = { x: number; y: number; r: number; color: Rgb; f: number; p: number; glint: number; born: number; life: number; flare: number; nextFlare: number };
type Dust = { d: number; v: number; o: number; w: number; p: number; a: number; r: number };
type Shooter = { x: number; y: number; vx: number; vy: number; age: number; life: number; len: number };

const COLORS_D: Rgb[] = [
  [255, 255, 255],
  [190, 214, 255],
  [255, 236, 186],
  [255, 200, 226],
  [170, 255, 236],
];
const COLORS_L: Rgb[] = [
  [74, 92, 190],
  [196, 140, 30],
  [150, 70, 180],
  [30, 140, 150],
  [80, 80, 110],
];

export function createStardust(env: FxEnv): Fx {
  const s = env.scale;
  const rng: Rng = mulberry32(0x57a2);
  const dark = env.dark;
  const palette = dark ? COLORS_D : COLORS_L;
  const stars: Star[] = [];
  const dust: Dust[] = [];
  const shooters: Shooter[] = [];
  const clouds = [
    { t: 0, fx: 0.11, fy: 0.17, p: 0.5, r: 110, color: (dark ? [110, 130, 255] : [90, 110, 220]) as Rgb },
    { t: 0, fx: 0.07, fy: 0.13, p: 2.4, r: 96, color: (dark ? [200, 110, 255] : [170, 90, 220]) as Rgb },
    { t: 0, fx: 0.15, fy: 0.09, p: 4.1, r: 84, color: (dark ? [90, 220, 235] : [60, 160, 200]) as Rgb },
  ];
  const dustColor: Rgb = dark ? [200, 214, 255] : [90, 100, 180];
  // quantised alphas: building a colour string per speck per frame is most of the cost, so reuse them
  const dustCache = new Map<number, string>();
  const dustFill = (a: number): string => {
    const k = Math.round(a * 24);
    let c = dustCache.get(k);
    if (!c) {
      c = rgba(dustColor, k / 24);
      dustCache.set(k, c);
    }
    return c;
  };
  let geo: Geo;
  let clock = 0;
  let untilShoot = between(rng, 2.5, 6);
  let pendingShoot = 0;
  let pendingBloom = 0;
  const maxStars = s < 0.7 ? 80 : 190;

  const outsideBox = (x: number, y: number): boolean => {
    const b = geo.box;
    return !(x > b.x - 3 && x < b.x + b.w + 3 && y > b.y - 3 && y < b.y + b.h + 3);
  };

  const place = (): { x: number; y: number } => {
    for (let i = 0; i < 20; i++) {
      const x = rng() * geo.w;
      const y = rng() * geo.h;
      if (outsideBox(x, y)) return { x, y };
    }
    return { x: 2, y: 2 };
  };

  const makeStar = (born: number, life: number): Star => {
    const pos = place();
    const big = rng() < 0.16;
    return {
      ...pos,
      r: (big ? between(rng, 1.7, 2.7) : between(rng, 0.65, 1.45)) * s,
      color: palette[int(rng, 0, palette.length - 1)] as Rgb,
      f: between(rng, 0.5, 2.8),
      p: rng() * 60,
      glint: big || rng() < 0.06 ? 1 : 0,
      born,
      life,
      flare: 0,
      nextFlare: clock + between(rng, 1, 9),
    };
  };

  const shoot = (fast = 1) => {
    // from a random edge of the sky, heading somewhere across it (never straight down at the box)
    const side = int(rng, 0, 3);
    const w = geo.w;
    const h = geo.h;
    const speed = between(rng, 520, 820) * s * fast;
    let x: number;
    let y: number;
    let ang: number;
    if (side === 0) {
      x = rng() * w;
      y = -4;
      ang = between(rng, 0.25, 1.1) * (rng() < 0.5 ? 1 : -1) + Math.PI / 2;
    } else if (side === 1) {
      x = w + 4;
      y = rng() * h * 0.7;
      ang = Math.PI - between(rng, 0.1, 0.7);
    } else if (side === 2) {
      x = -4;
      y = rng() * h * 0.7;
      ang = between(rng, 0.1, 0.7);
    } else {
      x = rng() * w;
      y = h + 4;
      ang = -Math.PI / 2 + between(rng, -0.8, 0.8);
    }
    shooters.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, age: 0, life: between(rng, 0.5, 0.85), len: between(rng, 80, 130) * s });
  };

  return {
    margin: 54 * s,
    fps: 40,
    setup(g) {
      geo = g;
      if (stars.length === 0) {
        const n = Math.round(Math.min(maxStars * 0.7, (g.w * g.h) / 650));
        for (let i = 0; i < n; i++) stars.push(makeStar(-1e9, Number.POSITIVE_INFINITY));
        const m = Math.round(Math.min(380, g.box.w * 0.5) * (s < 0.7 ? 0.6 : 1));
        for (let i = 0; i < m; i++) {
          dust.push({
            d: rng() * g.track.length,
            v: between(rng, 7, 20) * s * (rng() < 0.18 ? -1 : 1),
            o: between(rng, 6, 26) * s,
            w: between(rng, 0.2, 0.9),
            p: rng() * 6.28,
            a: between(rng, 0.14, 0.55),
            r: between(rng, 0.4, 1.0) * s,
          });
        }
      } else {
        // the box changed size: leave the stars where they are, but never inside the box
        for (const st of stars) if (!outsideBox(st.x, st.y)) Object.assign(st, place());
      }
    },
    frame(ctx, dt, inp: FxInput) {
      clock += dt;
      const e = Math.min(1.6, inp.energy);
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      // a very faint cool wash so the sky isn't empty
      const { box } = geo;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const rx = box.w * 0.6;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, (box.h * 0.5 + 40 * s) / rx);
      const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      wash.addColorStop(0, dark ? 'rgba(120,150,255,0.05)' : 'rgba(110,130,230,0.05)');
      wash.addColorStop(1, 'rgba(120,150,255,0)');
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // faint nebula clouds drifting round the box (their positions are integrated, so a change in speed can't make them hop)
      for (const c of clouds) {
        c.t += dt * (0.5 + 0.3 * e);
        const x = cx + Math.sin(c.t * c.fx + c.p) * (box.w * 0.5 + 20 * s);
        const y = cy + Math.sin(c.t * c.fy + c.p * 2) * (box.h * 0.5 + 34 * s);
        const r = (c.r + 8 * Math.sin(c.t * 0.31 + c.p)) * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(c.color, dark ? 0.1 : 0.07));
        g.addColorStop(1, rgba(c.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // dust lane: specks orbiting along the border at their own speeds, wobbling a little in and out
      for (const p of dust) {
        p.d += p.v * dt * (1 + 0.5 * e);
        const t = geo.track.at(p.d, p.o + Math.sin(clock * p.w + p.p) * 4 * s);
        const tw = 0.6 + 0.4 * Math.sin(clock * (0.9 + p.w) + p.p * 2);
        ctx.fillStyle = dustFill(p.a * tw * (0.8 + 0.3 * e));
        ctx.fillRect(t.x - p.r, t.y - p.r, p.r * 2, p.r * 2);
      }

      // stars
      let w = 0;
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i] as Star;
        const age = clock - st.born;
        if (age > st.life) continue; // a bloomed star that has finished
        stars[w++] = st;
        let grow = 1;
        let fade = 1;
        if (st.life !== Number.POSITIVE_INFINITY) {
          grow = Math.min(1, age / 0.45);
          grow = 1 - (1 - grow) ** 3 + 0.18 * Math.sin(grow * Math.PI); // a little overshoot as it blooms
          fade = Math.min(1, (st.life - age) / 1.6);
        }
        if (clock >= st.nextFlare) {
          st.flare = 1;
          st.nextFlare = clock + between(rng, 2, 11);
        }
        st.flare *= Math.exp(-dt / 0.18);
        const tw = 0.22 + 0.78 * wave(clock * st.f, st.p) ** 1.6;
        const a = Math.min(1, (tw + st.flare * 0.9) * fade * (dark ? 0.9 : 0.85));
        const r = st.r * grow * (1 + st.flare * 0.7);
        ctx.fillStyle = rgba(st.color, a);
        ctx.beginPath();
        ctx.arc(st.x, st.y, Math.max(0.3, r), 0, Math.PI * 2);
        ctx.fill();
        if (r > 1.5 * s) {
          const halo = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, r * 4.5);
          halo.addColorStop(0, rgba(st.color, 0.28 * a));
          halo.addColorStop(1, rgba(st.color, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(st.x, st.y, r * 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (st.glint && a > 0.5) {
          const len = r * (5 + 6 * st.flare) * grow;
          ctx.strokeStyle = rgba(st.color, 0.55 * a);
          ctx.lineWidth = Math.max(0.4, r * 0.28);
          ctx.beginPath();
          ctx.moveTo(st.x - len, st.y);
          ctx.lineTo(st.x + len, st.y);
          ctx.moveTo(st.x, st.y - len);
          ctx.lineTo(st.x, st.y + len);
          ctx.stroke();
        }
      }
      stars.length = w;

      // typing blooms new stars; Enter fires a shooting star
      if (pendingBloom > 0 && stars.length < maxStars) {
        const n = Math.min(pendingBloom, 3);
        pendingBloom -= n;
        for (let i = 0; i < n; i++) stars.push(makeStar(clock, between(rng, 5, 9)));
      }
      untilShoot -= dt * (0.7 + 0.5 * e);
      if (untilShoot <= 0) {
        shoot();
        untilShoot = between(rng, 5, 13);
      }
      while (pendingShoot > 0) {
        pendingShoot--;
        shoot(1.1);
      }

      // shooting stars
      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i] as Shooter;
        sh.age += dt;
        if (sh.age >= sh.life) {
          shooters.splice(i, 1);
          continue;
        }
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        const u = sh.age / sh.life;
        const k = u < 0.12 ? u / 0.12 : (1 - (u - 0.12) / 0.88) ** 1.2;
        const sp = Math.hypot(sh.vx, sh.vy);
        const tx = sh.x - (sh.vx / sp) * sh.len;
        const ty = sh.y - (sh.vy / sp) * sh.len;
        const gr = ctx.createLinearGradient(sh.x, sh.y, tx, ty);
        gr.addColorStop(0, dark ? `rgba(255,255,255,${k})` : `rgba(60,80,200,${k})`);
        gr.addColorStop(0.35, dark ? `rgba(180,210,255,${0.4 * k})` : `rgba(60,80,200,${0.35 * k})`);
        gr.addColorStop(1, 'rgba(160,190,255,0)');
        ctx.strokeStyle = gr;
        ctx.lineWidth = 1.7 * s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = rgba(dark ? lighten([200, 220, 255], 0.6) : [60, 80, 200], k);
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, 1.8 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    poke(kind) {
      if (kind === 'enter') {
        pendingShoot += 1;
        pendingBloom += 4;
      } else pendingBloom += 1;
    },
  };
}
