import { initVibeParty } from '@/features/party/vibeparty/content';

export default defineContentScript({
  // Only the main site: not studio.youtube.com, accounts.youtube.com or embeds — the panel makes no sense there,
  // and a narrower match means a narrower permission warning at install time.
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  allFrames: false,
  main(ctx) {
    initVibeParty(ctx);
  },
});
