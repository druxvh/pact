import { browser } from 'wxt/browser';
import { initVibePartyBackground } from '@/features/party/vibeparty/background';
import { registerTimerBackground } from '@/features/timer/background';

/** Section keywords for the `pact <keyword>` omnibox shortcut. */
const SECTIONS: Array<{ id: string; label: string; keywords: string[] }> = [
  { id: 'notes', label: 'Notes', keywords: ['notes', 'note', 'notebook'] },
  { id: 'kanban', label: 'Kanban', keywords: ['kanban', 'board', 'tasks', 'task', 'todo'] },
  { id: 'timer', label: 'Focus timer', keywords: ['timer', 'focus', 'pomodoro'] },
  { id: 'tools', label: 'Tools', keywords: ['tools', 'tool', 'qr', 'calc', 'calculator', 'convert'] },
  { id: 'discover', label: 'Discover', keywords: ['discover', 'news', 'articles', 'read', 'reading', 'rss', 'feeds'] },
  { id: 'chat', label: 'Chat', keywords: ['chat', 'chats', 'messages', 'friends'] },
  { id: 'party', label: 'VibeParty', keywords: ['party', 'vibeparty', 'watch', 'youtube'] },
  { id: 'settings', label: 'Settings', keywords: ['settings', 'profile', 'prefs'] },
];

// Minimal typing for the Chromium omnibox API (not part of WXT's cross-browser typings).
type OmniboxSuggestion = { content: string; description: string };
type Disposition = 'currentTab' | 'newForegroundTab' | 'newBackgroundTab';
type Omnibox = {
  setDefaultSuggestion?: (s: { description: string }) => void;
  onInputChanged: { addListener: (cb: (text: string, suggest: (s: OmniboxSuggestion[]) => void) => void) => void };
  onInputEntered: { addListener: (cb: (text: string, disposition: Disposition) => void) => void };
};

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

function registerOmnibox(): void {
  // `omnibox` isn't in every browser's typings/runtime; feature-detect.
  const omnibox = (browser as unknown as { omnibox?: Omnibox }).omnibox;
  if (!omnibox?.onInputEntered) return;

  omnibox.setDefaultSuggestion?.({ description: 'Search the web — or type a page: notes, kanban, timer…' });

  omnibox.onInputChanged.addListener((text, suggest) => {
    const q = text.trim().toLowerCase();
    if (!q) return;
    const pages = SECTIONS.filter((s) => s.keywords.some((k) => k.startsWith(q))).map((s) => ({
      content: `go:${s.id}`,
      description: `Open <match>${escapeXml(s.label)}</match> in pact`,
    }));
    suggest([...pages, { content: text, description: `Search the web for <match>${escapeXml(text)}</match>` }]);
  });

  omnibox.onInputEntered.addListener(async (text, disposition) => {
    const getUrl = browser.runtime.getURL.bind(browser.runtime) as (p: string) => string;

    if (text.startsWith('go:')) {
      const url = `${getUrl('/newtab.html')}#/${text.slice(3)}`;
      if (disposition === 'currentTab') await browser.tabs.update({ url });
      else await browser.tabs.create({ url, active: disposition === 'newForegroundTab' });
      return;
    }

    const q = text.trim();
    if (!q) {
      await browser.tabs.create({ url: getUrl('/newtab.html') });
      return;
    }
    // Use the user's default search engine rather than hard-coding Google.
    const search = (browser as unknown as { search?: { query?: (o: { text: string; disposition: string }) => Promise<void> } }).search;
    const dispo = disposition === 'currentTab' ? 'CURRENT_TAB' : 'NEW_TAB';
    if (search?.query) await search.query({ text: q, disposition: dispo });
    else await browser.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(q)}` });
  });
}

export default defineBackground({
  // Firefox (MV2) only: the VibeParty host runs in this page, so it must not be suspended (ignored by Chromium's service worker).
  persistent: true,
  main() {
    registerTimerBackground();
    registerOmnibox();
    initVibePartyBackground();
  },
});
