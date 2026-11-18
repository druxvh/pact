import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui';
import { CameraStudio } from '@/features/camera/CameraStudio';
import { DEFAULT_PREFS, useCameraStore } from '@/features/camera/store';
import { type Mounted, mount, run } from '@/test/render';

type FakeTrack = {
  kind: string;
  label: string;
  stop: ReturnType<typeof vi.fn>;
  readyState: string;
  addEventListener: ReturnType<typeof vi.fn>;
  getSettings: () => MediaTrackSettings;
  getCapabilities: () => MediaTrackCapabilities;
  applyConstraints: () => Promise<void>;
};

const makeTrack = (): FakeTrack => ({
  kind: 'video',
  label: 'Fake camera',
  readyState: 'live',
  stop: vi.fn(),
  addEventListener: vi.fn(),
  getSettings: () => ({ width: 1280, height: 720, deviceId: 'cam-1', facingMode: 'user' }),
  getCapabilities: () => ({ width: { min: 320, max: 1920 }, height: { min: 240, max: 1080 } }) as MediaTrackCapabilities,
  applyConstraints: async () => undefined,
});

const makeStream = (track: FakeTrack) => ({ getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] }) as unknown as MediaStream;

function installMedia(opts: { permission?: PermissionState; gum?: () => Promise<MediaStream> } = {}) {
  const track = makeTrack();
  const stream = makeStream(track);
  const getUserMedia = vi.fn(opts.gum ?? (async () => stream));
  const enumerateDevices = vi.fn(async () => [{ deviceId: 'cam-1', kind: 'videoinput', label: 'Fake camera', groupId: 'g', toJSON: () => ({}) }]);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn(async () => ({ state: opts.permission ?? 'granted', addEventListener: vi.fn(), removeEventListener: vi.fn() })) },
  });
  return { track, stream, getUserMedia };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await run(() => new Promise<void>((r) => setTimeout(r, 0)));
};

let view: Mounted | null = null;
const onOpenChange = vi.fn();
const studio = (open: boolean) => createElement(TooltipProvider, null, createElement(CameraStudio, { open, onOpenChange }));
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  // happy-dom's <video> only accepts a real MediaStream for `srcObject`; the fakes here are plain objects.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get(this: { __src?: unknown }) {
      return this.__src ?? null;
    },
    set(this: { __src?: unknown }, v: unknown) {
      this.__src = v;
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  useCameraStore.setState({ ...DEFAULT_PREFS });
  onOpenChange.mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

describe('the camera studio (smoke)', () => {
  it('starts the camera when opened, shows it as live, and stops every track when closed', async () => {
    const { track, getUserMedia } = installMedia();
    view = await mount(studio(true));
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Camera on');
    expect(text()).toContain('Fake camera');
    expect(document.querySelector('video')).not.toBeNull();
    expect(track.stop).not.toHaveBeenCalled();

    // The dialog closes → the stream must stop at once, not after the exit animation.
    await view.unmount();
    view = await mount(studio(false));
    await settle();
    expect(track.stop).toHaveBeenCalled();
  });

  it('a browser that fires a permission "change" event on every open does not make the camera restart in a loop', async () => {
    const listeners = new Set<() => void>();
    const { getUserMedia } = installMedia({ permission: 'granted' });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: {
        query: vi.fn(async () => ({
          state: 'granted',
          addEventListener: (_: string, fn: () => void) => listeners.add(fn),
          removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        })),
      },
    });
    getUserMedia.mockImplementation(async () => {
      for (const fn of listeners) fn();
      return makeStream(makeTrack());
    });
    view = await mount(studio(true));
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Camera on');
  });

  it('does not touch the camera while closed', async () => {
    const { getUserMedia } = installMedia();
    view = await mount(studio(false));
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('first run: explains before asking, and only asks after "Allow camera"', async () => {
    const { getUserMedia } = installMedia({ permission: 'prompt' });
    view = await mount(studio(true));
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(text()).toContain('Turn on your camera');
    const allow = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Allow camera')) as HTMLButtonElement;
    await run(() => allow.click());
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Camera on');
  });

  it.each([
    ['NotAllowedError', 'Permission denied', 'Camera access is blocked'],
    ['NotFoundError', 'Requested device not found', 'No camera found'],
    ['NotReadableError', 'Could not start video source', 'The camera is busy'],
  ])('shows a helpful screen for %s', async (name, message, title) => {
    installMedia({
      gum: async () => {
        throw new DOMException(message, name);
      },
    });
    view = await mount(studio(true));
    await settle();
    expect(text()).toContain(title);
    expect(document.querySelector('video')).not.toBeNull();
  });

  it('an already-blocked camera goes straight to the "how to re-enable" help, with the chrome:// address as copyable text', async () => {
    const { getUserMedia } = installMedia({ permission: 'denied' });
    view = await mount(studio(true));
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(text()).toContain('Camera access is blocked');
    expect(text()).toContain('chrome://settings/content/camera');
  });

  it('no mediaDevices at all (insecure page) says the camera is unavailable', async () => {
    installMedia();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    view = await mount(studio(true));
    await settle();
    expect(text()).toContain('Camera isn’t available here');
  });
});

const key = (k: string, target: Element = document.body, init: KeyboardEventInit = {}) =>
  run(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });

describe('closing', () => {
  it('stops every track as soon as `open` turns false, without unmounting', async () => {
    const { track } = installMedia();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(studio(true)));
    await settle();
    expect(text()).toContain('Camera on');
    expect(track.stop).not.toHaveBeenCalled();
    await act(async () => root.render(studio(false)));
    await settle();
    expect(track.stop).toHaveBeenCalled();
    expect(text()).not.toContain('Camera on');
    // and it can be opened again
    await act(async () => root.render(studio(true)));
    await settle();
    expect(text()).toContain('Camera on');
    await act(async () => root.unmount());
    container.remove();
  });

  it('Escape asks to close (nothing else is going on)', async () => {
    installMedia();
    view = await mount(studio(true));
    await settle();
    await key('Escape');
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('keyboard shortcuts', () => {
  const state = () => useCameraStore.getState();
  const modeTab = (label: string) => document.querySelector(`[role="tab"][aria-label="${label}"]`);

  it('M mirrors (a front camera starts mirrored), G toggles the grid, T cycles the timer, A the aspect', async () => {
    installMedia();
    view = await mount(studio(true));
    await settle();
    expect(state().mirror).toBeNull();
    await key('m');
    expect(state().mirror).toBe(false);
    await key('m');
    expect(state().mirror).toBe(true);
    await key('g');
    expect(state().grid).toBe(true);
    await key('t');
    expect(state().timer).toBe(3);
    await key('t');
    await key('t');
    await key('t');
    expect(state().timer).toBe(0);
    await key('a');
    expect(state().aspect).toBe('1:1');
  });

  it('1–8 pick the filters in order', async () => {
    installMedia();
    view = await mount(studio(true));
    await settle();
    await key('3');
    expect(state().filter).toBe('noir');
    await key('8');
    expect(state().filter).toBe('sepia');
    await key('1');
    expect(state().filter).toBe('none');
  });

  it('offers Video only where the browser can record', async () => {
    installMedia();
    vi.stubGlobal('MediaRecorder', undefined);
    view = await mount(studio(true));
    await settle();
    expect(modeTab('Photo mode')).not.toBeNull();
    expect(modeTab('Video mode')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('P and V switch between photo and video', async () => {
    installMedia();
    vi.stubGlobal('MediaRecorder', class {});
    view = await mount(studio(true));
    await settle();
    expect(modeTab('Photo mode')?.getAttribute('aria-selected')).toBe('true');
    await key('v');
    expect(modeTab('Video mode')?.getAttribute('aria-selected')).toBe('true');
    await key('p');
    expect(modeTab('Photo mode')?.getAttribute('aria-selected')).toBe('true');
  });

  it('are ignored with a modifier held, while typing, and when the studio is closed', async () => {
    installMedia();
    view = await mount(studio(true));
    await settle();
    await key('g', document.body, { ctrlKey: true });
    await key('g', document.body, { metaKey: true });
    expect(state().grid).toBe(false);
    const input = document.createElement('input');
    document.body.append(input);
    await key('g', input);
    input.remove();
    expect(state().grid).toBe(false);
    await view.unmount();
    view = await mount(studio(false));
    await settle();
    await key('g');
    expect(state().grid).toBe(false);
  });
});
