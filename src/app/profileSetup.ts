import { normalizeUsername, validateUsername } from '@/store/useUserStore';

// U+0300–U+036F (combining diacritics), built from code points so no invisible character lives in this file.
const COMBINING_MARKS = new RegExp(`[${String.fromCodePoint(0x300)}-${String.fromCodePoint(0x36f)}]`, 'g');

/** A username to pre-fill from someone's name: "Sam Okafor" → `samokafor`. Empty when nothing usable remains. */
export function suggestUsername(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '') // é → e
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : '';
}

/** Can the first onboarding step be completed? */
export function profileStepError(name: string, username: string): string | null {
  if (!name.trim()) return 'Tell us what to call you';
  return validateUsername(normalizeUsername(username));
}
