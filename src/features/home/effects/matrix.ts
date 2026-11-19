/**
 * Matrix: digital rain. Columns of glyph streaks (katakana and digits, set on a canvas) fall past the sides of the box and down onto its top
 * edge, each with its own speed, a bright white-green head and a trail that fades with the time since the head passed. Glyphs mutate
 * in place now and then; the rain emerges again below the box and thins out before it reaches the text (the box's own area is cleared, and
 * everything fades over the last ~16px next to it). Typing makes it fall faster and wakes more columns; Enter sends a surge. Green by default,
 * lightly tinted by the accent.
 */
import { rgba } from './colors';
import { smoothstep } from './noise';
import { between, int, mulberry32, type Rng } from './rng';
import { surface } from './surface';
import type { Fx, FxEnv, FxInput, Geo, Rgb } from './types';

// katakana (U+30A0–U+30FF, minus the odd marks) and digits — built from code points so the source stays plain ASCII
const GLYPHS: string[] = [...Array.from({ length: 56 }, (_, i) => String.fromCodePoint(0x30a1 + i)), ...'0123456789'.split('')];

type Column = { x: number; head: number; speed: number; trail: number; delay: number; active: boolean; age: Float32Array; glyph: Uint8Array };

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

export function createMatrix(env: FxEnv): Fx {
  const s = env.scale;
  const rng: Rng = mulberry32(0x3a71);
  const dark = env.dark;
  const green: Rgb = dark ? mix([0, 255, 102], env.accent, 0.18) : mix([0, 128, 54], env.accent, 0.2);
  const headCol: Rgb = dark ? [214, 255, 226] : [0, 70, 30];
  const pitch = (s < 0.7 ? 7 : 11.5) * (s < 0.7 ? 1 : s);
  const cell = pitch * 1.12;
  let geo: Geo;
  let cols: Column[] = [];
  let rows = 0;
  let atlas: HTMLCanvasElement | null = null;
  let cw = 1; // atlas cell size in device px
  let ch = 1;
  let wake = 0; // columns to wake (typing / Enter)

  const buildAtlas = () => {
    const dpr = geo.dpr;
    cw = Math.ceil(pitch * dpr);
    ch = Math.ceil(cell * dpr);
    const sf = surface(env, cw * GLYPHS.length, ch * 3);
    atlas = sf?.canvas ?? null;
    const x = sf?.ctx;
    if (!x) return;
    x.clearRect(0, 0, cw * GLYPHS.length, ch * 3);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `${Math.round(pitch * dpr * 0.95)}px "Geist Mono Variable", ui-monospace, "Hiragino Kaku Gothic ProN", "Yu Gothic", "MS Gothic", monospace`;
    const variants: Array<[Rgb, number]> = [
      [headCol, 1],
      [mix(green, [255, 255, 255], dark ? 0.16 : 0), 1],
      [green, 1],
    ];
    variants.forEach(([c, a], row) => {
      x.fillStyle = rgba(c, a);
      for (let i = 0; i < GLYPHS.length; i++) x.fillText(GLYPHS[i] as string, i * cw + cw / 2, row * ch + ch / 2);
    });
  };

  const spawn = (c: Column, fromTop = true) => {
    c.active = true;
    c.head = fromTop ? -between(rng, 0, 4) : between(rng, 0, rows);
    c.speed = between(rng, 5, 16) * (s < 0.7 ? 0.8 : 1);
    c.trail = between(rng, 7, 20);
    c.age.fill(-1);
  };

  return {
    margin: 52 * s,
    fps: 40,
    setup(g) {
      geo = g;
      buildAtlas();
      const n = Math.max(3, Math.floor(g.w / pitch));
      rows = Math.ceil(g.h / cell) + 1;
      const old = cols;
      cols = Array.from({ length: n }, (_, i) => {
        const keep = old[i];
        if (keep && keep.age.length === rows) {
          keep.x = i * pitch + pitch / 2;
          return keep; // a resize keeps the rain that is already falling
        }
        const c: Column = {
          x: i * pitch + pitch / 2,
          head: 0,
          speed: 8,
          trail: 12,
          delay: between(rng, 0, 3),
          active: false,
          age: new Float32Array(rows).fill(-1),
          glyph: new Uint8Array(rows),
        };
        for (let r = 0; r < rows; r++) c.glyph[r] = int(rng, 0, GLYPHS.length - 1);
        if (rng() < 0.55) spawn(c, false);
        return c;
      });
    },
    frame(ctx, dt, inp: FxInput) {
      if (!atlas) return;
      const e = Math.min(1.6, inp.energy);
      const fall = (0.78 + 0.62 * e) * (1 + 0.9 * inp.burst);
      const { box } = geo;
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      // wake extra columns while typing
      while (wake > 0) {
        wake--;
        const idle = cols.filter((c) => !c.active);
        const pick = idle[Math.floor(rng() * idle.length)];
        if (pick) spawn(pick);
      }
      for (const c of cols) {
        if (!c.active) {
          c.delay -= dt;
          if (c.delay <= 0 && rng() < dt * (0.6 + 0.4 * e) * 3) spawn(c);
          continue;
        }
        const before = Math.floor(c.head);
        c.head += c.speed * fall * dt;
        for (let r = before + 1; r <= Math.floor(c.head); r++) {
          if (r >= 0 && r < rows) {
            c.age[r] = 0;
            c.glyph[r] = int(rng, 0, GLYPHS.length - 1);
          }
        }
        const life = c.trail / (c.speed * (0.78 + 0.62 * 0.5));
        let alive = false;
        for (let r = 0; r < rows; r++) {
          const a = c.age[r] as number;
          if (a < 0) continue;
          const na = a + dt;
          c.age[r] = na;
          if (na > life) {
            c.age[r] = -1;
            continue;
          }
          alive = true;
          // a few glyphs flicker into a different character where they stand
          if (rng() < dt * 0.7) c.glyph[r] = int(rng, 0, GLYPHS.length - 1);
          const cy = r * cell + cell / 2;
          const dx = Math.max(box.x - c.x, 0, c.x - (box.x + box.w));
          const dy = Math.max(box.y - cy, 0, cy - (box.y + box.h));
          const dist = Math.hypot(dx, dy);
          const near = smoothstep(0, 16 * s + 2, dist);
          if (near <= 0.01) continue;
          const k = (1 - na / life) ** 1.4;
          const row = na < 0.07 ? 0 : na < life * 0.16 ? 1 : 2;
          ctx.globalAlpha = Math.min(1, k * near * (row === 0 ? 1 : 0.95));
          ctx.drawImage(atlas, (c.glyph[r] as number) * cw, row * ch, cw, ch, c.x - pitch / 2, r * cell, pitch, cell);
        }
        // a head arriving at the top of the box splashes on it
        if (c.x > box.x && c.x < box.x + box.w && c.head * cell > box.y - cell && c.head * cell < box.y + 2) {
          const g = ctx.createRadialGradient(c.x, box.y, 0, c.x, box.y, 12 * s);
          g.addColorStop(0, rgba(green, 0.5));
          g.addColorStop(1, rgba(green, 0));
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.fillRect(c.x - 12 * s, box.y - 12 * s, 24 * s, 14 * s);
        }
        if (!alive && c.head > rows) {
          c.active = false;
          c.delay = between(rng, 0.2, 2.4);
        }
      }
      ctx.globalAlpha = 1;
    },
    poke(kind) {
      wake += kind === 'enter' ? 14 : 3;
    },
  };
}
