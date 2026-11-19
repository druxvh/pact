import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { click, mount, run } from '@/test/render';
import { setNowPlayingApiForTesting } from './hooks';
import { useLocalNowStore } from './localNow';
import { MemoryNowPlayingServer } from './memoryApi';
import { NowPlayingSettings } from './NowPlayingSettings';
import { NowPlayingWidget } from './NowPlayingWidget';
import { useNowPlayingPrefs } from './prefs';
import type { LocalNow } from './protocol';

const ext = vi.hoisted(() => ({ canDetect: true, request: vi.fn<() => Promise<boolean>>(), drop: vi.fn<() => Promise<void>>() }));
vi.mock('./extension', () => ({
  get canDetect() {
    return ext.canDetect;
  },
  requestMusicAccess: () => ext.request(),
  dropMusicAccess: () => ext.drop(),
  writeConfig: async () => {},
  hasMusicAccess: async () => true,
  onPermissionsChanged: () => () => {},
  onConfigChanged: () => () => {},
  readCurrent: async () => null,
  onCurrentChanged: () => () => {},
}));

const ME = '11111111-1111-4111-8111-111111111111';
const track = (over: Record<string, unknown> = {}) => ({
  title: 'Night Drive',
  artist: 'The Tests',
  album: 'Fixtures',
  artworkUrl: null,
  trackUrl: null,
  source: 'spotify',
  ...over,
});
const nowPlaying = (over: Partial<LocalNow> = {}): LocalNow => ({ track: track() as LocalNow['track'], playing: true, shared: false, ...over });
const setLocal = (now: LocalNow | null) => useLocalNowStore.setState({ now, at: Date.now() });
const prefs = () => useNowPlayingPrefs.getState();
const signIn = () => useAuthStore.setState({ status: 'signedIn', user: { id: ME, email: 'a@b.co', provider: 'github', name: 'Ada' } });
const signOut = () => useAuthStore.setState({ status: 'guest', user: null });

let unmount: (() => Promise<void>) | null = null;
const show = async (node: Parameters<typeof mount>[0]) => {
  const m = await mount(node);
  unmount = m.unmount;
  return m.container;
};
const buttons = (c: HTMLElement) => [...c.querySelectorAll('button')];
const button = (c: HTMLElement, text: RegExp) => buttons(c).find((b) => text.test(b.textContent ?? ''));
const switchOf = (c: HTMLElement, label: string) => c.querySelector(`[role="switch"][aria-label="${label}"]`) as HTMLElement;

beforeEach(() => {
  ext.canDetect = true;
  ext.request.mockReset().mockResolvedValue(true);
  ext.drop.mockReset().mockResolvedValue();
  useNowPlayingPrefs.setState({ detect: false, share: 'off', paused: false, note: null });
  useLocalNowStore.setState({ now: null, at: 0 });
  signIn();
  setNowPlayingApiForTesting(new MemoryNowPlayingServer().api(ME));
});
afterEach(async () => {
  await unmount?.();
  unmount = null;
  setNowPlayingApiForTesting(null);
  useNavStore.setState({ section: 'home', sub: null });
});

describe('the Now playing widget', () => {
  it('starts as an invitation: what is read, and a button to turn it on', async () => {
    const c = await show(createElement(NowPlayingWidget));
    expect(c.textContent).toContain('Now playing');
    expect(c.textContent).toMatch(/Only the track name, artist and cover are read/);
    expect(c.textContent).toMatch(/Spotify/);
    const turnOn = button(c, /Turn on/);
    expect(turnOn).toBeDefined();
    await click(turnOn as HTMLElement);
    await run(() => new Promise<void>((r) => setTimeout(r, 0)));
    expect(ext.request).toHaveBeenCalledTimes(1);
    expect(prefs().detect).toBe(true);
  });

  it('if the browser says no, the person is told on the spot', async () => {
    ext.request.mockResolvedValue(false);
    const c = await show(createElement(NowPlayingWidget));
    await click(button(c, /Turn on/) as HTMLElement);
    await run(() => new Promise<void>((r) => setTimeout(r, 0)));
    expect(prefs().detect).toBe(false);
    expect(c.querySelector('[role="status"]')?.textContent).toMatch(/didn’t give pact access/);
  });

  it('switched on with nothing playing it says how to get something here', async () => {
    useNowPlayingPrefs.setState({ detect: true });
    const c = await show(createElement(NowPlayingWidget));
    expect(c.textContent).toMatch(/Nothing playing/);
    expect(c.textContent).toMatch(/Play something in/);
    expect(button(c, /Turn on/)).toBeUndefined();
  });

  it('shows your track: title, artist, player and that it is playing', async () => {
    useNowPlayingPrefs.setState({ detect: true });
    setLocal(nowPlaying());
    const c = await show(createElement(NowPlayingWidget));
    expect(c.textContent).toContain('Night Drive');
    expect(c.textContent).toContain('The Tests');
    expect(c.textContent).toContain('Playing · Spotify');
    expect(c.querySelector('.np-eq')?.getAttribute('data-state')).toBe('live');
  });

  it('shows "Paused" (and a still, dimmed equalizer) when it is paused', async () => {
    useNowPlayingPrefs.setState({ detect: true });
    setLocal(nowPlaying({ playing: false }));
    const c = await show(createElement(NowPlayingWidget));
    expect(c.textContent).toContain('Paused · Spotify');
    expect(c.querySelector('.np-eq')?.getAttribute('data-state')).toBe('still');
  });

  it('text from the page is text: markup in a title stays characters', async () => {
    useNowPlayingPrefs.setState({ detect: true });
    setLocal(nowPlaying({ track: track({ title: '<img src=x onerror=alert(1)>' }) as LocalNow['track'] }));
    const c = await show(createElement(NowPlayingWidget));
    expect(c.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(c.querySelector('img')).toBeNull();
  });

  it('for a guest it works on this device and says sharing needs an account — with no sharing controls', async () => {
    signOut();
    useNowPlayingPrefs.setState({ detect: true });
    setLocal(nowPlaying());
    const c = await show(createElement(NowPlayingWidget));
    expect(c.textContent).toContain('Night Drive');
    expect(c.textContent).toMatch(/Sign in to share/);
    expect(button(c, /Pause sharing|Share…/)).toBeUndefined();
  });

  it('signed in but sharing with nobody: "Only you can see this", with a way to change that', async () => {
    useNowPlayingPrefs.setState({ detect: true, share: 'off' });
    setLocal(nowPlaying());
    const c = await show(createElement(NowPlayingWidget));
    expect(c.textContent).toMatch(/Only you can see this/);
    await click(button(c, /Share…/) as HTMLElement);
    expect(useNavStore.getState().section).toBe('settings');
  });

  it('says who sees it, and has a quick "Pause sharing" that toggles', async () => {
    useNowPlayingPrefs.setState({ detect: true, share: 'communities' });
    setLocal(nowPlaying());
    const c = await show(createElement(NowPlayingWidget));
    expect(c.textContent).toMatch(/Shared with my communities/);
    await click(button(c, /Pause sharing/) as HTMLElement);
    expect(prefs().paused).toBe(true);
    expect(c.textContent).toMatch(/Sharing is paused/);
    expect(button(c, /Resume sharing/)?.getAttribute('aria-pressed')).toBe('true');
    await click(button(c, /Resume sharing/) as HTMLElement);
    expect(prefs().paused).toBe(false);
  });

  it('the Settings shortcut goes to Settings', async () => {
    useNowPlayingPrefs.setState({ detect: true });
    const c = await show(createElement(NowPlayingWidget));
    await click(button(c, /Settings/) as HTMLElement);
    expect(useNavStore.getState().section).toBe('settings');
  });
});

describe('the Now playing settings', () => {
  it('explains what is read and for which sites, before anything is asked', async () => {
    const c = await show(createElement(NowPlayingSettings));
    expect(c.textContent).toContain('Detect music in this browser');
    expect(c.textContent).toMatch(/only the track title, artist, album and cover/);
    for (const host of ['open.spotify.com', 'music.youtube.com', 'soundcloud.com', 'music.apple.com', 'www.deezer.com', 'tidal.com'])
      expect(c.textContent).toContain(host);
  });

  it('the master switch asks for the permission when turned on, and gives it back when turned off', async () => {
    const c = await show(createElement(NowPlayingSettings));
    const sw = switchOf(c, 'Detect music in this browser');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await click(sw);
    await run(() => new Promise<void>((r) => setTimeout(r, 0)));
    expect(ext.request).toHaveBeenCalledTimes(1);
    expect(prefs().detect).toBe(true);
    await click(switchOf(c, 'Detect music in this browser'));
    await run(() => new Promise<void>((r) => setTimeout(r, 0)));
    expect(ext.drop).toHaveBeenCalledTimes(1);
    expect(prefs().detect).toBe(false);
  });

  it('can’t be switched on in a plain web page (no extension permissions there)', async () => {
    ext.canDetect = false;
    const c = await show(createElement(NowPlayingSettings));
    expect(switchOf(c, 'Detect music in this browser').hasAttribute('data-disabled')).toBe(true);
    expect(c.textContent).toMatch(/installed extension/);
  });

  it('“Share with” defaults to Nobody and lists the three choices', async () => {
    const c = await show(createElement(NowPlayingSettings));
    const tabs = [...c.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Nobody', 'My communities', 'Everyone']);
    expect(tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.textContent).toBe('Nobody');
    expect(c.textContent).toMatch(/Only you see it/);
  });

  it('signed out, sharing can’t be chosen and the row says why', async () => {
    signOut();
    const c = await show(createElement(NowPlayingSettings));
    expect(c.textContent).toMatch(/Sign in to share/);
    expect(c.querySelector('[role="tab"]')?.hasAttribute('data-disabled') || c.querySelector('[role="tab"]')?.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );
  });

  it('choosing who sees it goes to the account first', async () => {
    const server = new MemoryNowPlayingServer();
    setNowPlayingApiForTesting(server.api(ME));
    const c = await show(createElement(NowPlayingSettings));
    const everyone = [...c.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'My communities') as HTMLElement;
    await click(everyone);
    await run(() => new Promise<void>((r) => setTimeout(r, 0)));
    expect(server.visibility.get(ME)).toBe('communities');
    expect(prefs().share).toBe('communities');
    expect(c.textContent).toMatch(/share a community with you/);
  });

  it('pause sharing is only available when something is being shared', async () => {
    const c = await show(createElement(NowPlayingSettings));
    expect(switchOf(c, 'Pause sharing').hasAttribute('data-disabled')).toBe(true);
    await run(() => void useNowPlayingPrefs.setState({ detect: true, share: 'everyone' }));
    expect(switchOf(c, 'Pause sharing').hasAttribute('data-disabled')).toBe(false);
    await click(switchOf(c, 'Pause sharing'));
    expect(prefs().paused).toBe(true);
  });

  it('shows the last problem under the controls', async () => {
    useNowPlayingPrefs.setState({ note: 'Sharing isn’t available on this server yet.' });
    const c = await show(createElement(NowPlayingSettings));
    expect(c.querySelector('[role="status"]')?.textContent).toContain('isn’t available');
  });
});
