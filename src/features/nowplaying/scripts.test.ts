import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { SCRIPT_FILE, SCRIPT_ID } from './protocol';
import { createScriptRegistrar } from './scripts';
import { MUSIC_MATCH_PATTERNS } from './sources';

// The browser's scripting API is replaced by recorders: the real thing is exercised in real Chrome (see the README's checklist).
let registered: Array<{ id: string; matches: string[]; js: string[]; persistAcrossSessions?: boolean; runAt?: string; allFrames?: boolean }>;
let injected: Array<{ tabId: number; files: string[] }>;
let openTabs: Array<{ id?: number }>;
let queried: unknown[];

beforeEach(() => {
  fakeBrowser.reset();
  registered = [];
  injected = [];
  openTabs = [{ id: 11 }, { id: 12 }, {}];
  queried = [];
  vi.spyOn(browser.scripting, 'getRegisteredContentScripts').mockImplementation((async (filter?: { ids?: string[] }) =>
    registered.filter((s) => !filter?.ids || filter.ids.includes(s.id))) as never);
  vi.spyOn(browser.scripting, 'registerContentScripts').mockImplementation((async (scripts: typeof registered) => void registered.push(...scripts)) as never);
  vi.spyOn(browser.scripting, 'unregisterContentScripts').mockImplementation((async (filter?: { ids?: string[] }) => {
    registered = registered.filter((s) => !filter?.ids?.includes(s.id));
  }) as never);
  vi.spyOn(browser.scripting, 'executeScript').mockImplementation(
    (async (inj: { target: { tabId: number }; files: string[] }) => void injected.push({ tabId: inj.target.tabId, files: inj.files })) as never,
  );
  vi.spyOn(browser.tabs, 'query').mockImplementation((async (q: unknown) => {
    queried.push(q);
    return openTabs;
  }) as never);
});

describe('registering the music-tab content script', () => {
  it('registers it at runtime for exactly the player pages — in the page’s isolated world, no frames, kept across restarts', async () => {
    await createScriptRegistrar().register();
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      id: SCRIPT_ID,
      matches: [...MUSIC_MATCH_PATTERNS],
      js: [SCRIPT_FILE],
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    });
    expect(registered[0]).not.toHaveProperty('world'); // the default, isolated world
  });

  it('puts the script into tabs that are already open, so nobody has to reload their music tab', async () => {
    await createScriptRegistrar().register();
    expect(queried).toEqual([{ url: [...MUSIC_MATCH_PATTERNS] }]);
    expect(injected.map((i) => i.tabId)).toEqual([11, 12]);
    expect(injected[0]?.files).toEqual([SCRIPT_FILE]);
  });

  it('is idempotent: with it already registered (every worker start asks) nothing is registered or injected again', async () => {
    const registrar = createScriptRegistrar();
    await registrar.register();
    injected = [];
    await registrar.register();
    expect(registered).toHaveLength(1);
    expect(injected).toHaveLength(0);
  });

  it('re-registers if the registration is for different pages (an update changed the list)', async () => {
    registered.push({ id: SCRIPT_ID, matches: ['https://old.example/*'], js: [SCRIPT_FILE] });
    await createScriptRegistrar().register();
    expect(registered).toHaveLength(1);
    expect(registered[0]?.matches).toEqual([...MUSIC_MATCH_PATTERNS]);
  });

  it('unregisters it when turned off', async () => {
    const registrar = createScriptRegistrar();
    await registrar.register();
    await registrar.unregister();
    expect(registered).toHaveLength(0);
  });

  it('asks the browser whether ALL six pages are granted — a partial grant is not enough', async () => {
    const contains = vi.spyOn(browser.permissions, 'contains') as unknown as ReturnType<typeof vi.fn>;
    contains.mockResolvedValue(false);
    expect(await createScriptRegistrar().hasAccess()).toBe(false);
    expect(contains).toHaveBeenCalledWith({ origins: [...MUSIC_MATCH_PATTERNS] });
    contains.mockResolvedValue(true);
    expect(await createScriptRegistrar().hasAccess()).toBe(true);
    contains.mockRejectedValue(new Error('nope'));
    expect(await createScriptRegistrar().hasAccess()).toBe(false);
  });
});
