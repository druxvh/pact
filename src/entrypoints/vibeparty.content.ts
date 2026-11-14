import { initVibeParty } from '@/features/party/vibeparty/content';

export default defineContentScript({
  matches: ['https://*.youtube.com/*', 'https://music.youtube.com/*'],
  runAt: 'document_idle',
  allFrames: false,
  main(ctx) {
    initVibeParty(ctx);
  },
});
