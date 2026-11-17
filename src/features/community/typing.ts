import { useEffect, useState } from 'react';
import type { Profile } from './types';

/** How long someone counts as "typing" after their last signal. */
export const TYPING_TTL_MS = 5000;
/** How often we send our own signal while typing. */
export const TYPING_ANNOUNCE_MS = 3000;

/** userId → time (ms) until which they count as typing. */
export type TypingMap = Record<string, number>;

/** Who is typing right now: not me, not expired. */
export function activeTypers(map: TypingMap | undefined, me: string, now: number): string[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([id, until]) => id !== me && until > now)
    .map(([id]) => id);
}

export function typingLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing…`;
  return 'Several people are typing…';
}

export const displayName = (p: Profile | undefined) => p?.displayName || p?.username || 'Someone';

/** Re-renders once a second while the map has anyone in it, so names disappear on time without another event. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}
