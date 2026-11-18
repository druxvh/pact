import { beforeEach, describe, expect, it } from 'vitest';
import { CAMERA_KEY, coercePrefs, DEFAULT_PREFS, effectiveMirror, useCameraStore } from '@/features/camera/store';

beforeEach(() => {
  useCameraStore.setState({ ...DEFAULT_PREFS });
});

describe('the camera prefs', () => {
  it('live under pact-camera', () => {
    expect(CAMERA_KEY).toBe('pact-camera');
  });

  it('start as a plain, ready-to-shoot camera', () => {
    expect(DEFAULT_PREFS).toEqual({
      mirror: null,
      grid: false,
      timer: 0,
      aspect: 'original',
      filter: 'none',
      deviceId: null,
      resolution: 'auto',
      mic: true,
      shutterSound: true,
      allowedBefore: false,
    });
  });

  it('are saved as you change them', () => {
    const s = useCameraStore.getState();
    s.set('filter', 'noir');
    s.set('timer', 5);
    s.set('grid', true);
    const saved = JSON.parse(localStorage.getItem(CAMERA_KEY) ?? '{}') as { state: Record<string, unknown>; version: number };
    expect(saved.version).toBe(1);
    expect(saved.state).toMatchObject({ filter: 'noir', timer: 5, grid: true });
    expect('set' in saved.state).toBe(false);
  });

  it('restore from storage', async () => {
    localStorage.setItem(CAMERA_KEY, JSON.stringify({ state: { filter: 'vivid', aspect: '4:3', deviceId: 'abc', mirror: false }, version: 1 }));
    await useCameraStore.persist.rehydrate();
    expect(useCameraStore.getState()).toMatchObject({ filter: 'vivid', aspect: '4:3', deviceId: 'abc', mirror: false });
  });
});

describe('coercePrefs', () => {
  it('never trusts what is in storage', () => {
    const c = coercePrefs({
      mirror: 'yes',
      grid: 1,
      timer: 7,
      aspect: '3:2',
      filter: 'rainbow',
      deviceId: 42,
      resolution: '8k',
      mic: 'no',
      shutterSound: null,
      allowedBefore: 'true',
    });
    expect(c).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid values', () => {
    expect(
      coercePrefs({
        mirror: true,
        grid: true,
        timer: 10,
        aspect: '16:9',
        filter: 'sepia',
        deviceId: 'x',
        resolution: '1080p',
        mic: false,
        shutterSound: false,
        allowedBefore: true,
      }),
    ).toEqual({
      mirror: true,
      grid: true,
      timer: 10,
      aspect: '16:9',
      filter: 'sepia',
      deviceId: 'x',
      resolution: '1080p',
      mic: false,
      shutterSound: false,
      allowedBefore: true,
    });
  });

  it('copes with garbage and absurd ids', () => {
    expect(coercePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(coercePrefs('nope')).toEqual(DEFAULT_PREFS);
    expect(coercePrefs({ deviceId: 'x'.repeat(600) }).deviceId).toBeNull();
    expect(coercePrefs({ deviceId: '' }).deviceId).toBeNull();
  });
});

describe('effectiveMirror', () => {
  it('follows the camera until the person decides', () => {
    expect(effectiveMirror(null, true)).toBe(true);
    expect(effectiveMirror(null, false)).toBe(false);
  });

  it('then the choice wins', () => {
    expect(effectiveMirror(false, true)).toBe(false);
    expect(effectiveMirror(true, false)).toBe(true);
  });
});
