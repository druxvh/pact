import { describe, expect, it } from 'vitest';
import {
  CURRENT_STALE_MS,
  isPublishResult,
  isVisibility,
  NO_CONFIG,
  parseConfig,
  parseContentReport,
  parseCurrent,
  parseHostCommand,
  parseLocalNow,
} from './protocol';

const track = { title: 'T', artist: 'A', album: '', artworkUrl: null, trackUrl: null, source: 'spotify' };

describe('parseConfig', () => {
  it('reads the three choices and falls back to "off" for anything odd', () => {
    expect(parseConfig({ detect: true, share: 'communities', paused: true })).toEqual({ detect: true, share: 'communities', paused: true });
    expect(parseConfig({ detect: 'yes', share: 'friends', paused: 1 })).toEqual(NO_CONFIG);
    for (const v of [null, undefined, 'x', 5, []]) expect(parseConfig(v)).toEqual(NO_CONFIG);
  });
  it('knows the three visibilities', () => {
    expect(['off', 'communities', 'everyone'].every(isVisibility)).toBe(true);
    expect(isVisibility('friends')).toBe(false);
  });
});

describe('parseContentReport', () => {
  const ok = { type: 'nowplaying:report', playing: true, title: 'T', artist: 'A', album: 'B', artwork: 'https://i.scdn.co/x', link: '' };
  it('accepts a report and caps every string, so a page can’t make us carry megabytes', () => {
    expect(parseContentReport(ok)).toEqual(ok);
    const big = parseContentReport({ ...ok, title: 'x'.repeat(100_000), artwork: 'y'.repeat(100_000) });
    expect(big?.title).toHaveLength(1000);
    expect(big?.artwork).toHaveLength(2048);
  });
  it('rejects anything that is not one', () => {
    for (const v of [null, undefined, 'x', 5, [], {}, { type: 'other' }, { ...ok, type: 'vibeparty:ping' }]) expect(parseContentReport(v)).toBeNull();
  });
  it('non-string fields become empty, and "playing" is true only for true', () => {
    expect(parseContentReport({ ...ok, title: 5, playing: 'yes' })).toMatchObject({ title: '', playing: false });
  });
  it('carries no tab address or page title (nothing in the shape could)', () => {
    expect(Object.keys(parseContentReport({ ...ok, url: 'https://x', pageTitle: 'secret' }) ?? {}).sort()).toEqual([
      'album',
      'artist',
      'artwork',
      'link',
      'playing',
      'title',
      'type',
    ]);
  });
});

describe('host commands', () => {
  it('parses publish (with a re-validated track) and clear', () => {
    expect(parseHostCommand({ type: 'nowplaying-host:clear' })).toEqual({ type: 'nowplaying-host:clear' });
    expect(parseHostCommand({ type: 'nowplaying-host:publish', track })).toMatchObject({ type: 'nowplaying-host:publish', track: { title: 'T' } });
    const cleaned = parseHostCommand({ type: 'nowplaying-host:publish', track: { ...track, artworkUrl: 'https://evil.example/a.png' } });
    expect(cleaned).toMatchObject({ track: { artworkUrl: null } });
  });
  it('rejects the rest', () => {
    for (const v of [
      null,
      'x',
      {},
      { type: 'nowplaying-host:publish' },
      { type: 'nowplaying-host:publish', track: { title: '' } },
      { type: 'vibeparty-host:ping' },
    ]) {
      expect(parseHostCommand(v)).toBeNull();
    }
  });
  it('knows the publish results', () => {
    expect(['ok', 'signed-out', 'not-shared', 'rate-limited', 'unavailable', 'error'].every(isPublishResult)).toBe(true);
    expect(isPublishResult('nope')).toBe(false);
  });
});

describe('what the page reads from the worker', () => {
  it('parseLocalNow keeps a valid track and the flags', () => {
    expect(parseLocalNow({ track, playing: true, shared: true })).toMatchObject({ playing: true, shared: true, track: { title: 'T' } });
    expect(parseLocalNow({ track: { title: '' }, playing: true })).toBeNull();
    expect(parseLocalNow(null)).toBeNull();
  });
  it('a value the worker hasn’t confirmed for a while counts as nothing', () => {
    const now = 1_000_000;
    const value = { now: { track, playing: true, shared: false }, at: now - 1000 };
    expect(parseCurrent(value, now)).not.toBeNull();
    expect(parseCurrent({ ...value, at: now - CURRENT_STALE_MS - 1 }, now)).toBeNull();
    expect(parseCurrent({ now: null, at: now }, now)).toBeNull();
    expect(parseCurrent({ now: value.now }, now)).toBeNull(); // no timestamp
  });
});
