import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // WxtVitest wires up the `@/` alias, WXT auto-imports and an in-memory `browser` for extension code.
  plugins: [WxtVitest()],
  test: {
    // A DOM is required: zustand's `persist` defaults to `window.localStorage`, and it silently
    // disables persistence (no `store.persist` API at all) when there is no window.
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
