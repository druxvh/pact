/**
 * Notes, likes and comments for the SIMULATED people (the demo friends in Direct messages, whose ids aren't real accounts — see
 * `isUserId`). They are served from an in-memory server of their own, never from the network, and their notes never expire so
 * the demo doesn't go quiet. Real accounts never go through here.
 */

import type { Track } from '@/features/nowplaying/track';
import { ME_ID } from '@/store/useUserStore';
import type { ActivityApi } from './api';
import { MemoryActivityServer } from './memoryApi';
import type { SubjectRef } from './types';

/** Covers on the player's own image host, so the real picture path is exercised too (the generated cover shows when offline). */
const midnight: Track = {
  title: 'Midnight City',
  artist: 'M83',
  album: 'Hurry Up, We’re Dreaming',
  artworkUrl: 'https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg',
  trackUrl: 'https://music.youtube.com/watch?v=dX3k_QDnzHE',
  source: 'youtube-music',
};
const weightless: Track = {
  title: 'Weightless',
  artist: 'Marconi Union',
  album: 'Weightless',
  artworkUrl: 'https://i.ytimg.com/vi/UfcAVejslrU/hqdefault.jpg',
  trackUrl: 'https://music.youtube.com/watch?v=UfcAVejslrU',
  source: 'youtube-music',
};

/** Who the demo server treats as "me" (the local, simulated account — `ME_ID`). */
export const DEMO_VIEWER = ME_ID;

export type DemoNote = { owner: string; text: string; track: Track | null; ageMinutes: number };

export const DEMO_NOTES: readonly DemoNote[] = [
  { owner: 'alex', text: 'Shipping the new onboarding today', track: midnight, ageMinutes: 95 },
  { owner: 'jordan', text: '', track: weightless, ageMinutes: 40 },
  { owner: 'riley', text: 'Writing at the café — send snacks', track: null, ageMinutes: 210 },
];

/** A few reactions from other simulated people, so the counts aren't all zero. */
const DEMO_REACTIONS: ReadonlyArray<{ owner: string; likes: readonly string[]; comments: ReadonlyArray<{ by: string; body: string; ageMinutes: number }> }> = [
  {
    owner: 'alex',
    likes: ['jordan', 'riley', 'sam', 'maya'],
    comments: [
      { by: 'jordan', body: 'Finally! Can’t wait to try it', ageMinutes: 70 },
      { by: 'riley', body: 'Ship it 🚀', ageMinutes: 55 },
    ],
  },
  { owner: 'jordan', likes: ['alex', 'riley'], comments: [{ by: 'alex', body: 'On repeat for me too', ageMinutes: 20 }] },
  { owner: 'riley', likes: ['alex'], comments: [] },
];

export function createDemoServer(): MemoryActivityServer {
  const server = new MemoryActivityServer();
  server.ttlMs = 365 * 24 * 3_600_000; // the demo people always have something to show
  for (const n of DEMO_NOTES) server.seedNote(n.owner, n.text, n.track, n.ageMinutes * 60_000, 'everyone');
  for (const r of DEMO_REACTIONS) {
    const note = server.notes.get(r.owner);
    if (!note) continue;
    const ref: SubjectRef = { ownerId: r.owner, kind: 'note', key: note.id };
    for (const by of r.likes) server.seedLike(ref, by);
    for (const c of r.comments) server.seedComment(ref, c.by, c.body, c.ageMinutes * 60_000);
  }
  return server;
}

let cached: ActivityApi | null = null;
/** The one demo API (created on first use). */
export function demoActivityApi(): ActivityApi {
  cached ??= createDemoServer().api(DEMO_VIEWER);
  return cached;
}
