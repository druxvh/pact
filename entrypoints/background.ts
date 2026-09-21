export default defineBackground(() => {
  console.log('pact background ready', { id: browser.runtime.id });

  // Omnibox — type "pact <query>" in address bar → Google search (keeps pact thriving even when omnibox has focus)
  try {
    const omnibox = (browser as any).omnibox ?? (globalThis as any).chrome?.omnibox;
    if (omnibox?.onInputEntered?.addListener) {
      omnibox.onInputEntered.addListener((text: string, disposition: string) => {
        const q = text.trim();
        const url = q
          ? `https://www.google.com/search?q=${encodeURIComponent(q)}`
          : 'https://www.google.com';
        const target: any = { url };
        // disposition: "currentTab" | "newForegroundTab" | "newBackgroundTab"
        if (disposition === 'currentTab') {
          browser.tabs.update({ url });
        } else {
          browser.tabs.create(target);
        }
        console.log('pact omnibox →', q);
      });

      // Optional suggestions — shows pact hint while typing
      if (omnibox?.onInputChanged?.addListener && omnibox?.setDefaultSuggestion) {
        omnibox.setDefaultSuggestion({ description: 'Search with pact — pact <query> → Google' });
        omnibox.onInputChanged.addListener((text: string, suggest: (s: Array<{ content: string; description: string }>) => void) => {
          if (!text) return;
          suggest([
            { content: text, description: `Search Google for "${text}"` },
            { content: `site:pact.app ${text}`, description: `Search pact spaces: "${text}" (mock)` },
          ]);
        });
      }
    }
  } catch {}
});
