import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { initNowPlayingBackground } from './background';
import { ALARM, CONFIG_KEY, CURRENT_KEY, type NowPlayingConfig, type PublishResult, parseCurrent } from './protocol';
import type { ScriptRegistrar } from './scripts';
import type { Track } from './track';

// The worker's wiring: messages in, storage and the publisher out. The pieces it wires have their own tests (hub, publisher, scripts).
const SPOTIFY = 'https://open.spotify.com/album/1';
const report = (over: Record<string, unknown> = {}) => ({
  type: 'nowplaying:report',
  playing: true,
  title: 'Night Drive',
  artist: 'The Tests',
  album: '',
  artwork: '',
  link: '',
  ...over,
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

let registrar: ScriptRegistrar & { registered: boolean; access: boolean };
let published: Track[];
let cleared: number;
let answer: PublishResult;
let permissionChanged: () => void;

const setConfig = async (config: NowPlayingConfig) => {
  await browser.storage.local.set({ [CONFIG_KEY]: config });
  await settle();
};
const current = async () => parseCurrent((await browser.storage.session.get(CURRENT_KEY))[CURRENT_KEY], Date.now());
const send = async (message: unknown, sender: Record<string, unknown>) => {
  // fakeBrowser's onMessage.trigger hands the listeners (message, sender, sendResponse)
  (browser.runtime.onMessage as unknown as { trigger: (...a: unknown[]) => unknown }).trigger(message, sender, () => {});
  await settle();
};
const fromTab = (url = SPOTIFY, tabId = 7) => ({ id: browser.runtime.id, tab: { id: tabId, url }, url });

beforeEach(async () => {
  vi.useRealTimers();
  fakeBrowser.reset();
  published = [];
  cleared = 0;
  answer = 'ok';
  // the fake browser has no permissions events: capture the listener so the test can fire it
  vi.spyOn(browser.permissions.onRemoved, 'addListener').mockImplementation((cb) => {
    permissionChanged = () => cb({});
  });
  vi.spyOn(browser.permissions.onAdded, 'addListener').mockImplementation(() => {});
  registrar = {
    registered: false,
    access: true,
    hasAccess: async () => registrar.access,
    register: async () => {
      registrar.registered = true;
    },
    unregister: async () => {
      registrar.registered = false;
    },
  };
  initNowPlayingBackground(
    {
      publish: async (track) => {
        published.push(track);
        return answer;
      },
      clear: async () => void cleared++,
    },
    registrar,
  );
  await settle();
});

describe('turning the feature on and off', () => {
  it('registers the music-tab content script only when detecting is on AND the browser granted the pages', async () => {
    expect(registrar.registered).toBe(false);
    await setConfig({ detect: true, share: 'off', paused: false });
    expect(registrar.registered).toBe(true);
    await setConfig({ detect: false, share: 'off', paused: false });
    expect(registrar.registered).toBe(false);
    registrar.access = false; // asked for, but the permission was refused or taken back
    await setConfig({ detect: true, share: 'off', paused: false });
    expect(registrar.registered).toBe(false);
  });

  it('if the person takes the permission back later (chrome://extensions), it stops at once', async () => {
    await setConfig({ detect: true, share: 'off', paused: false });
    await send(report(), fromTab());
    expect(await current()).not.toBeNull();
    registrar.access = false;
    permissionChanged();
    await settle();
    expect(registrar.registered).toBe(false);
    expect(await current()).toBeNull();
  });

  it('while the permission is missing, reports are ignored', async () => {
    registrar.access = false;
    await setConfig({ detect: true, share: 'communities', paused: false });
    await send(report(), fromTab());
    expect(await current()).toBeNull();
    expect(published).toHaveLength(0);
  });
});

describe('reports from music tabs', () => {
  beforeEach(() => setConfig({ detect: true, share: 'off', paused: false }));

  it('become what the new-tab page shows', async () => {
    await send(report(), fromTab());
    expect(await current()).toMatchObject({ playing: true, shared: false, track: { title: 'Night Drive', source: 'spotify' } });
  });

  it('only from our own content script, in a tab', async () => {
    await send(report(), { id: 'some-other-extension', tab: { id: 7, url: SPOTIFY }, url: SPOTIFY }); // another extension
    await send(report(), { id: browser.runtime.id }); // no tab (e.g. the new-tab page)
    expect(await current()).toBeNull();
  });

  it('a tab that is not a music player is ignored, whatever the message says', async () => {
    await send(report({ title: 'Banking' }), fromTab('https://www.youtube.com/watch?v=1'));
    await send(report({ title: 'Banking' }), fromTab('https://evil.example/'));
    expect(await current()).toBeNull();
  });

  it('closing the tab removes it', async () => {
    await send(report(), fromTab());
    (browser.tabs.onRemoved as unknown as { trigger: (id: number) => void }).trigger(7);
    await settle();
    expect(await current()).toBeNull();
  });

  it('messages that are not reports are none of its business', async () => {
    await send({ type: 'vibeparty:ping' }, fromTab());
    await send('hello', fromTab());
    expect(await current()).toBeNull();
  });
});

describe('sharing', () => {
  it('nothing is published while sharing is off — and the alarm only runs while something plays', async () => {
    await setConfig({ detect: true, share: 'off', paused: false });
    await send(report(), fromTab());
    expect(published).toHaveLength(0);
    expect(await browser.alarms.get(ALARM)).toBeDefined(); // something plays: the worker is woken to expire the tab
    await send(report({ playing: false }), fromTab());
    expect(await browser.alarms.get(ALARM)).toBeUndefined();
  });

  it('turning sharing on publishes the playing track straight away (it is the person’s own action)', async () => {
    await setConfig({ detect: true, share: 'off', paused: false });
    await send(report(), fromTab());
    await setConfig({ detect: true, share: 'communities', paused: false });
    expect(published.map((t) => t.title)).toEqual(['Night Drive']);
    expect(await current()).toMatchObject({ shared: true });
  });

  it('the alarm is created once, not restarted by every report (that would keep it from ever firing)', async () => {
    await setConfig({ detect: true, share: 'off', paused: false });
    const create = vi.spyOn(browser.alarms, 'create');
    await send(report(), fromTab());
    await send(report(), fromTab());
    await send(report({ title: 'Next' }), fromTab());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(ALARM, { periodInMinutes: 0.5 });
  });

  it('when the account says "not sharing", the stored preference is rewritten to off', async () => {
    answer = 'not-shared';
    await setConfig({ detect: true, share: 'off', paused: false });
    await send(report(), fromTab());
    await setConfig({ detect: true, share: 'everyone', paused: false });
    const stored = (await browser.storage.local.get(CONFIG_KEY))[CONFIG_KEY] as NowPlayingConfig;
    expect(stored).toEqual({ detect: true, share: 'off', paused: false });
  });

  it('keeps the host page alive only while a track is published', async () => {
    const keep = initNowPlayingBackground({ publish: async () => 'ok', clear: async () => {} }, registrar);
    expect(keep.keepsHost()).toBe(false);
  });
});
