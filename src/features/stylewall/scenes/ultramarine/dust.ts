/** Drifting stars and dust for Engraved Halo: pure seeded layout. Each mote orbits the centre slowly (nearer ones faster) and twinkles. */
import { mulberry32 } from '../../rng';

const TAU = Math.PI * 2;

export type Dust = {
  /** Per mote: radius (R0 units), angle at t = 0, angular speed (rad/s), size (css px), twinkle rate (rad/s), twinkle phase, kind (0 dot, 1 sparkle). */
  data: Float32Array;
  count: number;
};

export const DUST_STRIDE = 7;

export function generateDust(seed: number, count = 230): Dust {
  const rng = mulberry32(seed ^ 0xd057);
  const data = new Float32Array(count * DUST_STRIDE);
  for (let i = 0; i < count; i++) {
    const r = 1.25 + rng() ** 0.8 * 3.6;
    const sparkle = rng() < 0.08 ? 1 : 0;
    data.set(
      [
        r,
        rng() * TAU,
        (0.0045 / Math.sqrt(r)) * (rng() < 0.5 ? 1 : -1) * (0.6 + rng() * 0.8),
        sparkle ? 2 + rng() * 1.5 : 0.8 + rng() * 1.1,
        0.4 + rng() * 1.6,
        rng() * TAU,
        sparkle,
      ],
      i * DUST_STRIDE,
    );
  }
  return { data, count };
}
