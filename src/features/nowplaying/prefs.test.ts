import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/useAuthStore';
import { setNowPlayingApiForTesting } from './hooks';
import { MemoryNowPlayingServer } from './memoryApi';

// The browser side is replaced: what matters here is what the preference does with it.
const ext = vi.hoisted(() => ({
  canDetect: true,
  request: vi.fn<() => Promise<boolean>>(),
  drop: vi.fn<() => Promise<void>>(),
  write: vi.fn<(c: unknown) => Promise<void>>(),
  access: vi.fn<() => Promise<boolean>>(),
  permissionListener: null as null | (() => void),
  configListener: null as null | ((c: { detect: boolean; share: string; paused: boolean }) => void),
}));
vi.mock('./extension', () => ({
  get canDetect() {
    return ext.canDetect;
  },
  requestMusicAccess: () => ext.request(),
  dropMusicAccess: () => ext.drop(),
  writeConfig: (c: unknown) => ext.write(c),
  hasMusicAccess: () => ext.access(),
  onPermissionsChanged: (cb: () => void) => {
    ext.permissionListener = cb;
    return () => {};
  },
  onConfigChanged: (cb: (c: { detect: boolean; share: string; paused: boolean }) => void) => {
    ext.configListener = cb;
    return () => {};
  },
  readCurrent: async () => null,
  onCurrentChanged: () => () => {},
}));

import { NOWPLAYING_KEY, useNowPlayingPrefs } from './prefs';
import { effectiveConfig, refreshShare, stopSharingNow, useNowPlayingSync } from './sync';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function SyncProbe() {
  useNowPlayingSync();
  return null;
}

const ME = '11111111-1111-4111-8111-111111111111';
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const prefs = () => useNowPlayingPrefs.getState();

let server: MemoryNowPlayingServer;
const signIn = () => useAuthStore.setState({ status: 'signedIn', user: { id: ME, email: 'a@b.co', provider: 'github', name: 'Ada' } });
const signOutState = () => useAuthStore.setState({ status: 'guest', user: null });

beforeEach(() => {
  ext.canDetect = true;
  ext.request.mockReset().mockResolvedValue(true);
  ext.drop.mockReset().mockResolvedValue();
  ext.write.mockReset().mockResolvedValue();
  ext.access.mockReset().mockResolvedValue(true);
  ext.permissionListener = null;
  ext.configListener = null;
  server = new MemoryNowPlayingServer();
  setNowPlayingApiForTesting(server.api(ME));
  useNowPlayingPrefs.setState({ detect: false, share: 'off', paused: false, note: null });
  signIn();
});

describe('the preference', () => {
  it('starts with everything off', () => {
    expect(prefs()).toMatchObject({ detect: false, share: 'off', paused: false });
  });

  it('only the three choices are stored — not the note', () => {
    useNowPlayingPrefs.setState({ detect: true, share: 'communities', paused: true, note: 'boom' });
    const stored = JSON.parse(localStorage.getItem(NOWPLAYING_KEY) ?? '{}');
    expect(Object.keys(stored.state).sort()).toEqual(['detect', 'paused', 'share']);
  });

  it('stored junk falls back to the safe values', async () => {
    localStorage.setItem(NOWPLAYING_KEY, JSON.stringify({ state: { detect: 'yes', share: 'friends', paused: 1 }, version: 1 }));
    await useNowPlayingPrefs.persist.rehydrate();
    expect(prefs()).toMatchObject({ detect: false, share: 'off', paused: false });
  });
});

describe('turning detection on', () => {
  it('asks the browser for the music pages in the very same tick as the click (the prompt needs the gesture), then turns on', async () => {
    const promise = prefs().enable();
    expect(ext.request).toHaveBeenCalledTimes(1); // nothing was awaited first
    expect(await promise).toBe(true);
    expect(prefs().detect).toBe(true);
    expect(prefs().note).toBeNull();
  });

  it('if the browser says no, nothing is turned on and the person is told', async () => {
    ext.request.mockResolvedValue(false);
    expect(await prefs().enable()).toBe(false);
    expect(prefs().detect).toBe(false);
    expect(prefs().note).toMatch(/didn’t give pact access/);
  });

  it('outside the extension it says so instead of pretending', async () => {
    ext.canDetect = false;
    ext.request.mockResolvedValue(false);
    await prefs().enable();
    expect(prefs().note).toMatch(/installed pact extension/);
  });
});

describe('turning it off', () => {
  it('gives the permission back, forgets "paused", and removes the shared row', async () => {
    useNowPlayingPrefs.setState({ detect: true, share: 'communities', paused: true });
    server.set(ME, { title: 'T', artist: '', album: '', artworkUrl: null, trackUrl: null, source: 'spotify' }, 'communities');
    await prefs().disable();
    expect(prefs()).toMatchObject({ detect: false, paused: false });
    expect(ext.drop).toHaveBeenCalledTimes(1);
    expect(server.rows.has(ME)).toBe(false);
    expect(prefs().share).toBe('communities'); // who may see it is the account's setting: unchanged
  });
});

describe('who may see it', () => {
  it('the account decides first (the database enforces it); the local copy follows', async () => {
    await prefs().setShare('communities');
    expect(server.visibility.get(ME)).toBe('communities');
    expect(prefs().share).toBe('communities');
  });

  it('choosing nobody also clears pause and removes the row', async () => {
    useNowPlayingPrefs.setState({ share: 'everyone', paused: true });
    server.set(ME, { title: 'T', artist: '', album: '', artworkUrl: null, trackUrl: null, source: 'spotify' });
    await prefs().setShare('off');
    expect(prefs()).toMatchObject({ share: 'off', paused: false });
    expect(server.rows.has(ME)).toBe(false);
  });

  it('if the account can’t be changed, the local copy is left alone and the person is told', async () => {
    useNowPlayingPrefs.setState({ share: 'off' });
    server.available = false;
    await prefs().setShare('everyone');
    expect(prefs().share).toBe('off');
    expect(prefs().note).toMatch(/isn’t available/);
  });

  it('without an account it can’t be changed at all', async () => {
    setNowPlayingApiForTesting(null);
    signOutState();
    await prefs().setShare('everyone');
    expect(prefs().share).toBe('off');
    expect(prefs().note).toMatch(/Sign in/);
  });

  it('pausing is a local switch', () => {
    prefs().setPaused(true);
    expect(prefs().paused).toBe(true);
  });
});

describe('what the service worker is told', () => {
  it('the choices — but nothing is ever shared without an account', () => {
    expect(effectiveConfig({ detect: true, share: 'everyone', paused: false }, true)).toEqual({ detect: true, share: 'everyone', paused: false });
    expect(effectiveConfig({ detect: true, share: 'everyone', paused: false }, false)).toEqual({ detect: true, share: 'off', paused: false });
  });

  it('refreshShare reads the account’s setting (it may have changed on another device) and keeps the copy if that fails', async () => {
    server.visibility.set(ME, 'everyone');
    await refreshShare();
    expect(prefs().share).toBe('everyone');
    server.available = false;
    server.visibility.set(ME, 'off');
    await refreshShare();
    expect(prefs().share).toBe('everyone');
  });

  it('stopSharingNow (before sign-out) removes the row and tells the worker "off"', async () => {
    useNowPlayingPrefs.setState({ detect: true, share: 'communities' });
    server.set(ME, { title: 'T', artist: '', album: '', artwork: null, trackUrl: null, source: 'spotify' } as never, 'communities');
    await stopSharingNow();
    expect(server.rows.has(ME)).toBe(false);
    expect(ext.write).toHaveBeenLastCalledWith({ detect: true, share: 'off', paused: false });
  });
});

describe('useNowPlayingSync', () => {
  const mountSync = async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(SyncProbe)));
    await flush();
    return async () => {
      await act(async () => root.unmount());
      host.remove();
    };
  };

  it('mirrors the preference to the worker whenever it changes', async () => {
    const unmount = await mountSync();
    expect(ext.write).toHaveBeenLastCalledWith({ detect: false, share: 'off', paused: false });
    await act(async () => useNowPlayingPrefs.setState({ detect: true, share: 'communities' }));
    expect(ext.write).toHaveBeenLastCalledWith({ detect: true, share: 'communities', paused: false });
    await act(async () => useNowPlayingPrefs.setState({ paused: true }));
    expect(ext.write).toHaveBeenLastCalledWith({ detect: true, share: 'communities', paused: true });
    await unmount();
  });

  it('signing out sends "off" for sharing, without touching what the person chose', async () => {
    useNowPlayingPrefs.setState({ detect: true, share: 'everyone' });
    server.visibility.set(ME, 'everyone');
    const unmount = await mountSync();
    await act(async () => signOutState());
    expect(ext.write).toHaveBeenLastCalledWith({ detect: true, share: 'off', paused: false });
    expect(prefs().share).toBe('everyone');
    await unmount();
  });

  it('reads the account’s setting after sign-in', async () => {
    server.visibility.set(ME, 'communities');
    const unmount = await mountSync();
    expect(prefs().share).toBe('communities');
    await unmount();
  });

  it('if the browser permission was taken back, the switch follows', async () => {
    useNowPlayingPrefs.setState({ detect: true });
    ext.access.mockResolvedValue(false);
    const unmount = await mountSync();
    expect(prefs().detect).toBe(false);
    await unmount();
  });

  it('while the permission is there, a later check changes nothing; revoking it later is noticed', async () => {
    useNowPlayingPrefs.setState({ detect: true });
    const unmount = await mountSync();
    expect(prefs().detect).toBe(true);
    ext.access.mockResolvedValue(false);
    await act(async () => ext.permissionListener?.());
    await flush();
    expect(prefs().detect).toBe(false);
    await unmount();
  });

  it('when the worker finds out the account isn’t sharing, the preference follows', async () => {
    useNowPlayingPrefs.setState({ detect: true, share: 'everyone' });
    const unmount = await mountSync();
    await act(async () => ext.configListener?.({ detect: true, share: 'off', paused: false }));
    expect(prefs().share).toBe('off');
    await unmount();
  });
});
