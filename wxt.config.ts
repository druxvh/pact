import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@/components': './components',
    '@/store': './store',
    '@/lib': './lib',
    '@/types': './types',
    '@/assets': './assets',
  },
  manifest: {
    name: 'pact',
    description:
      'pact — notes, kanban, timer, utility tools, and chatrooms for your new tab.',
    permissions: ['storage', 'tabs', 'topSites', 'bookmarks'],
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
