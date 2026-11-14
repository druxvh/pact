import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  // All source lives in src/. WXT provides the `@/` and `~/` aliases → src/ out of the box.
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'pact',
    description:
      'A fun, fast new tab: search, notes, kanban, focus timer, tiny tools, chat — and watch YouTube in sync with friends.',
    minimum_chrome_version: '116',
    // Each permission is used by a feature and shows in the install prompt, so keep this list tight:
    //  storage       VibeParty hands the room code to the YouTube tab
    //  topSites      "most visited" tiles on Home
    //  favicon       private, local site icons (instead of a third-party favicon service)
    //  search        search with the user's default engine
    //  alarms        focus timer fires even if every pact tab is closed
    //  notifications "focus session complete" when pact isn't focused
    // (`tabs` and `bookmarks` were requested before but never needed — removed.)
    permissions: ['storage', 'topSites', 'favicon', 'search', 'alarms', 'notifications'],
    host_permissions: ['https://*.youtube.com/*'],
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
