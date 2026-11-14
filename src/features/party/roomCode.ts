// Relative (not `@/`) on purpose: the relay server imports this module directly under Node/Bun, which
// know nothing about the bundler's path alias.
import { pick, randomInt } from '../../lib/random.ts';

const WORDS = [
  'amber',
  'aurora',
  'azure',
  'breeze',
  'cobalt',
  'cosmic',
  'coral',
  'cozy',
  'crimson',
  'dawn',
  'disco',
  'dusk',
  'ember',
  'fuzzy',
  'galaxy',
  'golden',
  'groove',
  'hazel',
  'indigo',
  'ivory',
  'jade',
  'jazzy',
  'lofi',
  'lunar',
  'maple',
  'mellow',
  'midnight',
  'mint',
  'misty',
  'neon',
  'nova',
  'ocean',
  'olive',
  'onyx',
  'opal',
  'pastel',
  'pixel',
  'plum',
  'polar',
  'quartz',
  'retro',
  'rosy',
  'ruby',
  'sable',
  'sage',
  'scarlet',
  'silk',
  'solar',
  'static',
  'sunset',
  'tango',
  'teal',
  'topaz',
  'turbo',
  'velvet',
  'vinyl',
  'violet',
  'vivid',
  'wave',
  'wild',
  'winter',
  'zen',
  'zesty',
  'zephyr',
] as const;

// No look-alikes (0/o, 1/l/i) so codes survive being read aloud or typed from a screenshot.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * `amber-lofi-k7q2x9dm` — two words for readability + 8 random characters.
 * ≈ 12 bits (words) + 40 bits (suffix) = ~52 bits. The code IS the room's password, so it must not
 * be guessable: the old `amber-lofi-42` format had only ~14 bits (21,600 possibilities) and used Math.random().
 */
export function generateRoomCode(): string {
  const suffix = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${pick(WORDS)}-${pick(WORDS)}-${suffix}`;
}

/** Clean up pasted/typed input: lowercase, spaces → dashes, drop anything else, collapse dashes. */
export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export function isValidRoomCode(code: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(code) && code.length >= 4 && code.length <= 32;
}

/** Find a room code inside free text, e.g. a chat message "…room code: amber-lofi-k7q2x9dm". */
export function findRoomCode(text: string): string | null {
  const m = /room code:\s*`?([a-z0-9]+(?:-[a-z0-9]+){1,4})`?/i.exec(text);
  const code = m?.[1] ? normalizeRoomCode(m[1]) : '';
  return code && isValidRoomCode(code) ? code : null;
}

export const ROOM_CODE_BITS = Math.round(Math.log2(WORDS.length ** 2) + 8 * Math.log2(ALPHABET.length));
