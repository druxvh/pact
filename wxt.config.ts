import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { CAPTURE_COMMAND_KEYS } from './src/features/capture/defaults';

// A stable extension ID. Without a `key` Chrome derives the ID from the folder an unpacked extension is loaded from, so it
// changes between dev / build / another machine — and the sign-in redirect (`https://<id>.chromiumapp.org/`, allow-listed in
// Supabase) breaks every time. This is a PUBLIC key (the matching private key was discarded; nothing needs it), and it gives:
//   kkjbfallganmejcadkcdhppaokcnkefp
// Overrides:  WXT_EXTENSION_KEY=<public key>  to use another (e.g. the one Chrome Web Store shows under Package → View public
// key, so dev and the published listing share an ID);  WXT_OMIT_KEY=1  to leave it out (the `zip` scripts do, for store upload).
const EXTENSION_KEY = process.env.WXT_OMIT_KEY
  ? undefined
  : process.env.WXT_EXTENSION_KEY?.trim() ||
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4/x6PMiVL9x/qwdvMDnr65dwZ20f0uU4IPKauIex/pHrJ/k0DXTSjVxW1UNCNLNoRCsidF90a/15KhS1k9t7x50JKdN285jBBgFzscdTNG5K+IZABaA5a5Mjj8FOJ7enP5ovxhVLdii7XlTWDpEKZ9nPmyux3F8nsgAK3JZOEDhBYnJHRDQwilCk88svoRNI/5mUC69tq32slLp8820Q30NVgQK0v97mRQ9mct8HQPhuRtl5UgSDhqY9IpF+oVFhzIiRRJiC15m3g2b/w/an4KOLZu7DRc4gnaM2i5x4GS0oqF4kmYEk3/uF4PHghUn4sKYnXjgIC6JdgUsgze8PSQIDAQAB';

export default defineConfig({
  // All source lives in src/. WXT provides the `@/` and `~/` aliases → src/ out of the box.
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'pact',
    ...(EXTENSION_KEY ? { key: EXTENSION_KEY } : null),
    description: 'A fun, fast new tab: search, notes, kanban, focus timer, tiny tools, chat — and watch YouTube in sync with friends.',
    minimum_chrome_version: '116',
    // Each permission is used by a feature and shows in the install prompt, so keep this list tight:
    //  storage       VibeParty remembers your display name / panel prefs; the YouTube tab ↔ background hand-off
    //  topSites      "most visited" tiles on Home
    //  favicon       private, local site icons (instead of a third-party favicon service)
    //  search        search with the user's default engine
    //  alarms        focus timer fires even if every pact tab is closed
    //  notifications "focus session complete" when pact isn't focused
    //  identity      "Sign in with GitHub / Google" (chrome.identity.launchWebAuthFlow) — no email/profile access is requested
    //  offscreen     VibeParty's live connection lives in a hidden extension page (needs the signed-in session in localStorage and must
    //                not be killed with the idle service worker). No install warning. Chromium only — Firefox runs it in the background page.
    // (`tabs` and `bookmarks` were requested before but never needed — removed.)
    permissions: ['storage', 'topSites', 'favicon', 'search', 'alarms', 'notifications', 'identity', 'offscreen'],
    // youtube.com: find an open YouTube tab to start a party in (tabs.query by URL) — nothing else needs it.
    host_permissions: ['https://www.youtube.com/*'],
    chrome_url_overrides: {
      newtab: 'newtab.html',
    },
    omnibox: {
      keyword: 'pact',
    },
    // Quick capture: the toolbar button opens a small popup (src/entrypoints/capture) and so does this shortcut. It needs no
    // permission. Chrome applies the suggested key only if it's free; people can rebind it at chrome://extensions/shortcuts.
    action: {
      default_title: 'Quick capture',
      default_popup: 'capture.html',
    },
    commands: {
      _execute_action: {
        suggested_key: CAPTURE_COMMAND_KEYS,
        description: 'Quick capture a note or task',
      },
    },
  },
  hooks: {
    // Firefox MV2 has no `_execute_action`; its toolbar button is a `browser_action`.
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.manifestVersion !== 2 || !manifest.commands?._execute_action) return;
      manifest.commands._execute_browser_action = manifest.commands._execute_action;
      delete manifest.commands._execute_action;
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
