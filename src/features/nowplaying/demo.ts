/**
 * Demo "listening now" entries for the SIMULATED people (the demo friends in Direct messages, whose ids aren't real accounts).
 * Real accounts never go through here: only an id that is not a user id (see `isUserId` in store.ts) can match.
 */
import type { Track } from './track';

export const DEMO_LISTENING: Readonly<Record<string, Track>> = {
  alex: {
    title: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We’re Dreaming',
    artworkUrl: null,
    trackUrl: 'https://open.spotify.com/search/Midnight%20City%20M83',
    source: 'spotify',
  },
  jordan: { title: 'Weightless', artist: 'Marconi Union', album: 'Weightless', artworkUrl: null, trackUrl: null, source: 'youtube-music' },
  riley: {
    title: 'Sunset Lover',
    artist: 'Petit Biscuit',
    album: 'Presence',
    artworkUrl: null,
    trackUrl: 'https://soundcloud.com/search?q=Sunset%20Lover',
    source: 'soundcloud',
  },
};
