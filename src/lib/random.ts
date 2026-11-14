/** Secure random helpers — everything uses crypto.getRandomValues (never Math.random). */

/** Unbiased random integer in [0, max) via rejection sampling (a plain `% max` skews low values). */
export function randomInt(max: number): number {
  if (max <= 0 || max > 2 ** 32) throw new RangeError('max out of range');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0] as number;
    if (v < limit) return v % max;
  }
}

export function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)] as T;
}
