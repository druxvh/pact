import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  // All source lives in src/. WXT provides the `@/` and `~/` aliases → src/ out of the box.
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'pact',
    description:
      'pact — notes, kanban, timer, utility tools, chatrooms, and VibeParty YouTube sync for your new tab.',
    permissions: ['storage', 'tabs', 'topSites', 'bookmarks'],
    host_permissions: ['https://*.youtube.com/*', 'https://music.youtube.com/*'],
    chrome_url_overrides: {
      newtab: 'newtab.html',
    },
    omnibox: {
      keyword: 'pact',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
