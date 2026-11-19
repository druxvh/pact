import { initNowPlayingContent } from '@/features/nowplaying/content';
import { MUSIC_MATCH_PATTERNS } from '@/features/nowplaying/sources';

export default defineContentScript({
  // NOT a static content script: `registration: 'runtime'` keeps it out of the manifest's `content_scripts`, and wxt.config.ts moves
  // these hosts to the OPTIONAL host permissions. The service worker registers it (src/features/nowplaying/scripts.ts) only after
  // the person turned "Detect music in this browser" on and the browser granted these pages — and removes it again when they
  // turn it off. So installing pact asks for none of this.
  registration: 'runtime',
  matches: [...MUSIC_MATCH_PATTERNS],
  runAt: 'document_idle',
  allFrames: false,
  main(ctx) {
    initNowPlayingContent(ctx);
  },
});
