import { generatePassword } from '@/features/tools/lib/password';
import type { Answer } from '@/lib/omnibox/types';
import { pick, randomInt } from '@/lib/random';

const UUID = /^(?:uuid|guid)(?:\s*v?4)?$/i;
const COIN = /^(?:flip(?:\s+a)?(?:\s+coin)?|coin(?:\s+flip)?|toss(?:\s+a)?\s+coin|heads\s+or\s+tails)$/i;
const DICE = /^(?:roll\s*(?:a\s*)?)?(\d{1,2})?d(\d{1,4})(?:\s*([+-])\s*(\d{1,4}))?$/i;
const ANY_DIE = /^(?:roll(?:\s+(?:a\s+)?(?:dice|die))?|dice|die)$/i;
const PICK = /^(?:pick|choose|decide)(?:\s+(?:one|from|between))*\s*:?\s+(.+)$/i;
const RANDOM_NUMBER = /^(?:random|rand|rng)(?:\s+number)?(?:\s+(?:between|from))?\s+(-?\d{1,10})(?:\s*(?:-|to|and|\.\.)\s*(-?\d{1,10}))?$/i;
const PASSWORD = /^(?:password|passwd|pass|pw)(?:\s+(\d{1,3}))?$/i;

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

/**
 * `uuid`, `roll d20` / `2d6+1`, `flip a coin`, `pick a, b, c`, `random 1-100`, `password 20`.
 * Every call rolls fresh (crypto-random); the host re-runs this to "roll again".
 */
export function randomAnswer(input: string): Answer | null {
  const text = input.trim().replace(/\?+$/, '');
  if (!text || text.length > 400) return null;

  if (UUID.test(text)) {
    const id = uuid();
    return { kind: 'random', expression: 'UUID v4', value: id, copy: id, mono: true, reroll: true };
  }
  if (COIN.test(text)) {
    const side = pick(['Heads', 'Tails'] as const);
    return { kind: 'random', expression: 'Coin flip', value: side, copy: side, reroll: true };
  }

  const dice = DICE.exec(text);
  if (dice || ANY_DIE.test(text)) {
    const count = Math.min(50, Math.max(1, Number(dice?.[1] ?? 1)));
    const sides = dice ? Number(dice[2]) : 6;
    if (sides < 2) return null;
    const rolls = Array.from({ length: count }, () => randomInt(sides) + 1);
    const mod = dice?.[3] ? (dice[3] === '-' ? -1 : 1) * Number(dice[4]) : 0;
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    const label = `${count > 1 ? count : ''}d${sides}${mod ? `${mod > 0 ? '+' : '−'}${Math.abs(mod)}` : ''}`;
    return {
      kind: 'random',
      expression: `Roll ${label}`,
      value: String(total),
      copy: String(total),
      caption: count > 1 || mod ? `${rolls.join(' + ')}${mod ? ` ${mod > 0 ? '+' : '−'} ${Math.abs(mod)}` : ''}` : undefined,
      reroll: true,
    };
  }

  const rn = RANDOM_NUMBER.exec(text);
  if (rn) {
    const a = Number(rn[1]);
    const b = rn[2] === undefined ? undefined : Number(rn[2]);
    const [lo, hi] = b === undefined ? (a >= 1 ? [1, a] : [a, 1]) : a <= b ? [a, b] : [b, a];
    if (hi - lo + 1 > 2 ** 32) return null;
    const n = lo + randomInt(hi - lo + 1);
    return { kind: 'random', expression: `Random number ${lo}–${hi}`, value: String(n), copy: String(n), reroll: true };
  }

  const choose = PICK.exec(text);
  if (choose) {
    const options = (choose[1] ?? '')
      .split(/\s*(?:,|\||\bor\b)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (options.length < 2) return null;
    const chosen = pick(options);
    return { kind: 'random', expression: `Pick from ${options.length} options`, value: chosen, copy: chosen, caption: options.join(' · '), reroll: true };
  }

  const pw = PASSWORD.exec(text);
  if (pw) {
    const length = Math.min(128, Math.max(6, Number(pw[1] ?? 20)));
    const value = generatePassword({ length, sets: { lower: true, upper: true, digits: true, symbols: true }, excludeAmbiguous: false });
    return { kind: 'random', expression: `Password · ${length} characters`, value, copy: value, mono: true, reroll: true };
  }
  return null;
}
