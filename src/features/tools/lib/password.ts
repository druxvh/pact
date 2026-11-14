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

export const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~',
} as const;
export type SetKey = keyof typeof SETS;

const AMBIGUOUS = /[Il1O0o|]/g;

export type PasswordOptions = { length: number; sets: Record<SetKey, boolean>; excludeAmbiguous: boolean };

export function poolFor(opts: PasswordOptions): string[] {
  const pools = (Object.keys(SETS) as SetKey[])
    .filter((k) => opts.sets[k])
    .map((k) => (opts.excludeAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
  return pools;
}

/** Guarantees at least one character from every selected set, then shuffles (Fisher–Yates). */
export function generatePassword(opts: PasswordOptions): string {
  const pools = poolFor(opts);
  if (pools.length === 0) return '';
  const all = pools.join('');
  const length = Math.max(opts.length, pools.length);
  const chars: string[] = pools.map((p) => pick(Array.from(p)));
  while (chars.length < length) chars.push(pick(Array.from(all)));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}

/** Entropy in bits assuming uniform random choice from the combined pool. */
export function entropyBits(opts: PasswordOptions): number {
  const size = new Set(poolFor(opts).join('')).size;
  return size > 1 ? opts.length * Math.log2(size) : 0;
}

export function strengthLabel(bits: number): { label: string; tone: 'destructive' | 'warning' | 'success' | 'brand'; pct: number } {
  if (bits < 40) return { label: 'Weak', tone: 'destructive', pct: 20 };
  if (bits < 60) return { label: 'Fair', tone: 'warning', pct: 45 };
  if (bits < 80) return { label: 'Strong', tone: 'success', pct: 72 };
  return { label: 'Excellent', tone: 'brand', pct: 100 };
}

/** URL-safe random id (like nanoid) — 21 chars ≈ 126 bits. */
export function randomId(length = 21): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}
