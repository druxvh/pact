/**
 * Lava: a viscous molten glow, not flames. A dozen blobs of magma crawl along the border at their own speeds and merge where they meet
 * (a metaball field, evaluated on a low-resolution grid and scaled up so the edges stay soft and syrupy). The hot body churns from orange
 * through yellow; slow noise lets dark crust form on it and leaves thin bright cracks along the crust's edges. Bubbles swell on the
 * surface and pop in small showers of sparks. Typing heats it and speeds the crawl; Enter erupts. Positions are integrated, never recomputed
 * from time.
 */
import { rgba } from './colors';
import { fbm, noise2, smoothstep, wave } from './noise';
import { capped, lifeFraction, type Particle, stepAll } from './particles';
import { between, mulberry32, type Rng } from './rng';
import { surface } from './surface';
import type { Fx, FxEnv, FxInput, Geo } from './types';

type Blob = { d: number; v: number; off: number; r: number; w: number; p: number; k: number };
type Bubble = { x: number; y: number; r: number; age: number; life: number; popped: number };

export function createLava(env: FxEnv): Fx {
  const s = env.scale;
  const rng: Rng = mulberry32(0x1a5a);
  const dark = env.dark;
  const div = s < 0.7 ? 2 : 3;
  const sparks: Particle[] = [];
  const bubbles: Bubble[] = [];
  let blobs: Blob[] = [];
  let geo: Geo;
  let lo: HTMLCanvasElement | null = null;
  let lctx: CanvasRenderingContext2D | null = null;
  let img: ImageData | null = null;
  let clock = 0;
  let churn = 0; // integrated time of the slow crust/heat noise, so a change in energy never makes it jump
  let untilBubble = 1;
  let eruptions = 0;

  const spawnBubble = (big = 1) => {
    const b = blobs[Math.floor(rng() * blobs.length)];
    if (!b) return;
    const p = geo.track.at(b.d, b.off + b.r * 0.55);
    bubbles.push({ x: p.x + between(rng, -4, 4) * s, y: p.y + between(rng, -4, 4) * s, r: 0.5 * s, age: 0, life: between(rng, 0.9, 1.7), popped: -1 });
    const last = bubbles[bubbles.length - 1] as Bubble;
    last.life *= big;
  };

  return {
    margin: 40 * s,
    fps: 28,
    setup(g) {
      geo = g;
      const sf = surface(env, Math.ceil(g.w / div), Math.ceil(g.h / div));
      lo = sf?.canvas ?? null;
      lctx = sf?.ctx ?? null;
      img = lctx ? lctx.createImageData(Math.ceil(g.w / div), Math.ceil(g.h / div)) : null;
      const len = g.track.length;
      if (blobs.length === 0) {
        const n = s < 0.7 ? 10 : 18;
        blobs = Array.from({ length: n }, (_, i) => ({
          d: (len * i) / n + between(rng, 0, len / n),
          v: between(rng, 7, 26) * s * (rng() < 0.3 ? -1 : 1),
          off: between(rng, -1, 6) * s,
          r: between(rng, 12, 23) * s,
          w: between(rng, 0.25, 0.8),
          p: rng() * 6.28,
          k: between(rng, 0.8, 1.2),
        }));
      }
    },
    frame(ctx, dt, inp: FxInput) {
      if (!lctx || !lo || !img) return;
      const e = Math.min(1.6, inp.energy);
      clock += dt;
      churn += dt * (0.7 + 0.5 * e);
      const { box } = geo;
      const W = img.width;
      const H = img.height;
      for (const b of blobs) b.d += b.v * dt * (1 + 0.9 * e + inp.burst);
      // blob positions this frame
      const px: number[] = [];
      const py: number[] = [];
      const pr: number[] = [];
      for (const b of blobs) {
        const p = geo.track.at(b.d, b.off + 3 * s * Math.sin(clock * b.w + b.p));
        px.push(p.x);
        py.push(p.y);
        pr.push(b.r * b.k * (1 + 0.2 * Math.sin(clock * b.w * 1.7 + b.p * 2) + 0.15 * inp.burst + 0.06 * e));
      }
      const data = img.data;
      const reach = 26 * s;
      const heat0 = 0.1 + 0.07 * e;
      for (let gy = 0; gy < H; gy++) {
        const y = (gy + 0.5) * div;
        const dy = Math.max(box.y - y, 0, y - (box.y + box.h));
        for (let gx = 0; gx < W; gx++) {
          const i = (gy * W + gx) * 4;
          const x = (gx + 0.5) * div;
          const dx = Math.max(box.x - x, 0, x - (box.x + box.w));
          const dist = Math.hypot(dx, dy);
          if (dist <= 0 && x > box.x + 2 && x < box.x + box.w - 2 && y > box.y + 2 && y < box.y + box.h - 2) {
            data[i + 3] = 0; // inside the box: cleared anyway
            continue;
          }
          // the metaball field: every blob adds r²/d², plus a thin molten film hugging the border
          let f = 0.62 * Math.exp(-((dist / (9 * s)) ** 2));
          for (let k = 0; k < px.length; k++) {
            const ddx = x - (px[k] as number);
            const ddy = y - (py[k] as number);
            const d2 = ddx * ddx + ddy * ddy;
            const r = pr[k] as number;
            if (d2 < r * r * 12) f += (r * r) / (d2 + 1.2);
          }
          if (f < 0.32 || dist > reach + 12 * s) {
            data[i + 3] = 0;
            continue;
          }
          const body = smoothstep(0.78, 1.12, f);
          // outer glow of the heat around the edge of the body
          const aura = smoothstep(0.32, 0.9, f) * (1 - body);
          if (body <= 0.001) {
            data[i] = 255;
            data[i + 1] = 84;
            data[i + 2] = 14;
            data[i + 3] = aura * 0.38 * 255;
            continue;
          }
          const hn = fbm(x * 0.026 + churn * 0.05, y * 0.026 - churn * 0.035, 2);
          const heat = Math.min(0.8, Math.max(0, (f - 1) / 2.2) * 0.45 + (hn - 0.5) * 0.8 + heat0 + 0.14 * wave(churn * 0.4, 2));
          let r: number;
          let g: number;
          let b: number;
          if (heat < 0.3) {
            const t = heat / 0.3;
            r = 150 + 90 * t;
            g = 18 + 52 * t;
            b = 8 + 4 * t;
          } else if (heat < 0.65) {
            const t = (heat - 0.3) / 0.35;
            r = 240 + 15 * t;
            g = 70 + 80 * t;
            b = 12 + 14 * t;
          } else {
            const t = Math.min(1, (heat - 0.65) / 0.35);
            r = 255;
            g = 150 + 90 * t;
            b = 26 + 90 * t;
          }
          // crust: cooled dark patches that form slowly on the body, with a thin bright crack along the edge of each
          const cn = noise2(x * 0.05 + 11.3 + churn * 0.012, y * 0.05 - 4.1 - churn * 0.009);
          const crust = smoothstep(0.5, 0.63, cn) * smoothstep(0.95, 1.35, f);
          const crack = Math.exp(-(((cn - 0.56) / 0.02) ** 2)) * smoothstep(0.95, 1.3, f);
          const k1 = crust * 0.92;
          r = r * (1 - k1) + 34 * k1;
          g = g * (1 - k1) + 15 * k1;
          b = b * (1 - k1) + 12 * k1;
          r = r + (255 - r) * crack * 0.75;
          g = g + (170 - g) * crack * 0.75;
          b = b + (50 - b) * crack * 0.75;
          // a hot rim where the body meets the air
          const rim = (1 - body) * 0.55 + Math.exp(-(((f - 1) / 0.08) ** 2)) * 0.25;
          data[i] = Math.min(255, r + 40 * rim);
          data[i + 1] = Math.min(255, g + 70 * rim);
          data[i + 2] = Math.min(255, b + 30 * rim);
          data[i + 3] = Math.max(body, aura * 0.38) * 255;
        }
      }
      lctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(lo, 0, 0, geo.w, geo.h);
      if (dark) {
        // a second, additive pass for the glow
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.12;
        ctx.drawImage(lo, 0, 0, geo.w, geo.h);
        ctx.globalAlpha = 1;
      }

      // bubbles swell on the surface and pop in showers of sparks
      untilBubble -= dt * (0.8 + 0.7 * e);
      if (untilBubble <= 0) {
        spawnBubble();
        untilBubble = between(rng, 0.5, 1.6);
      }
      while (eruptions > 0) {
        eruptions--;
        spawnBubble(0.35);
      }
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const bb = bubbles[i] as Bubble;
        bb.age += dt;
        if (bb.popped < 0 && bb.age >= bb.life) {
          bb.popped = 0;
          const n = Math.round(between(rng, 5, 10));
          for (let k = 0; k < n; k++) {
            const a = rng() * Math.PI * 2;
            const sp = between(rng, 40, 150) * s;
            sparks.push({
              kind: 'spark',
              x: bb.x,
              y: bb.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp - 60 * s,
              age: 0,
              life: between(rng, 0.3, 0.8),
              size: between(rng, 0.7, 1.5) * s,
              seed: rng(),
            });
          }
        }
        if (bb.popped >= 0) {
          bb.popped += dt;
          if (bb.popped > 0.22) {
            bubbles.splice(i, 1);
            continue;
          }
          const u = bb.popped / 0.22;
          ctx.strokeStyle = rgba([255, 200, 110], 0.8 * (1 - u));
          ctx.lineWidth = 1.2 * s;
          ctx.beginPath();
          ctx.arc(bb.x, bb.y, bb.r * (1 + 1.2 * u), 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        const u = bb.age / bb.life;
        bb.r = (2 + 5.5 * u ** 0.8) * s;
        ctx.fillStyle = rgba([255, 120, 30], 0.18 + 0.3 * u);
        ctx.beginPath();
        ctx.arc(bb.x, bb.y, bb.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgba([255, 215, 140], 0.35 + 0.5 * u);
        ctx.lineWidth = 0.9 * s;
        ctx.stroke();
        ctx.fillStyle = rgba([255, 240, 200], 0.4 * u);
        ctx.beginPath();
        ctx.arc(bb.x - bb.r * 0.3, bb.y - bb.r * 0.3, bb.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      capped(sparks, 120);
      stepAll(sparks, dt, clock, s, 0);
      for (const p of sparks) {
        const u = lifeFraction(p);
        ctx.strokeStyle = rgba(u < 0.4 ? [255, 226, 150] : [255, 120, 30], 1 - u);
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      }
    },
    rim(ctx, inp) {
      const { box } = geo;
      const gr = ctx.createLinearGradient(0, box.y + box.h - 14 * s, 0, box.y + box.h);
      gr.addColorStop(0, rgba([255, 100, 20], 0));
      gr.addColorStop(1, rgba([255, 100, 20], 0.14 * (0.7 + 0.4 * Math.min(1, inp.energy))));
      ctx.fillStyle = gr;
      ctx.fillRect(box.x, box.y + box.h - 14 * s, box.w, 14 * s);
    },
    poke(kind) {
      if (kind === 'enter') eruptions += 7;
      else if (rng() < 0.5) eruptions += 1;
    },
  };
}
