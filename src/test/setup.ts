import { beforeEach } from 'vitest';

// Every test starts with an empty localStorage (happy-dom provides a real one).
// A few suites opt into the plain Node environment (`// @vitest-environment node`, e.g. the Edge Function and PDF-worker
// tests), where there is no window — so only clear when there is one.
beforeEach(() => {
  if (typeof window !== 'undefined') window.localStorage?.clear();
});
