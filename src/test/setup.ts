import { beforeEach } from 'vitest';

// Every test starts with an empty localStorage (happy-dom provides a real one).
beforeEach(() => {
  localStorage.clear();
});
