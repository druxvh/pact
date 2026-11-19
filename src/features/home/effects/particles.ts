/**
 * A tiny particle pool with the physics the effects need: velocity, drag, buoyancy (flames and embers rise), gravity (sparks fall) and a
 * turbulent sideways push that wobbles with position and time. Stepping is pure — no drawing here — so it can be tested with a fixed seed.
 */
import { clamp } from './rng';

export type Kind = 'flame' | 'ember' | 'spark';

export type Particle = {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived and total lifetime. */
  age: number;
  life: number;
  size: number;
  /** A per-particle random number in [0, 1) for wobble phase and flicker. */
  seed: number;
};

export type Forces = {
  /** Acceleration along y (negative = up), px/s². */
  ay: number;
  /** Fraction of velocity lost per second. */
  drag: number;
  /** Strength of the sideways turbulence, px/s². */
  turbulence: number;
};

export const FORCES: Readonly<Record<Kind, Forces>> = {
  flame: { ay: -70, drag: 1.1, turbulence: 38 },
  ember: { ay: -22, drag: 0.55, turbulence: 52 },
  spark: { ay: 420, drag: 1.6, turbulence: 0 },
};

/** Advance one particle by `dt` seconds. Returns false once it has died. */
export function step(p: Particle, dt: number, time: number, scale = 1, wind = 1): boolean {
  p.age += dt;
  if (p.age >= p.life) return false;
  const f = FORCES[p.kind];
  const sway = f.turbulence * scale * wind * (Math.sin(p.y * 0.045 + time * 6.3 + p.seed * 9) + 0.5 * Math.sin(p.x * 0.031 + time * 3.1 + p.seed * 5));
  p.vx += sway * dt;
  p.vy += f.ay * scale * dt;
  const k = clamp(1 - f.drag * dt, 0, 1);
  p.vx *= k;
  p.vy *= k;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  return true;
}

/** Step every particle and drop the dead ones in place (no allocation). */
export function stepAll(list: Particle[], dt: number, time: number, scale = 1, wind = 1): void {
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i] as Particle;
    if (step(p, dt, time, scale, wind)) list[w++] = p;
  }
  list.length = w;
}

/** How far through its life a particle is, 0 → 1. */
export const lifeFraction = (p: Particle): number => clamp(p.age / p.life, 0, 1);

/** Hard cap so a runaway emitter can never eat the CPU. */
export function capped<T>(list: T[], max: number): void {
  if (list.length > max) list.splice(0, list.length - max);
}
