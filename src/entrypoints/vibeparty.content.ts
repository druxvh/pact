import { initVibeParty } from '@/features/party/vibeparty/content';

export default defineContentScript({
  matches: ['https://*.youtube.com/*'],
  runAt: 'document_idle',
  allFrames: false,
  main(ctx) {
    initVibeParty(ctx);
  },
});
