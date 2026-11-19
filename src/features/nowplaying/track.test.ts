import { describe, expect, it } from 'vitest';
import { cleanText, cleanTrack, parseTrack, sameTrack, TEXT_MAX, trackFromRow } from './track';

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

describe('cleanText', () => {
  it('keeps ordinary text, including non-Latin scripts and emoji', () => {
    expect(cleanText('Sür Ma Ruh — 夜に駆ける 🎧')).toBe('Sür Ma Ruh — 夜に駆ける 🎧');
    expect(cleanText('ירדן')).toBe('ירדן');
  });
  it('turns control characters and line breaks into single spaces', () => {
    expect(cleanText(`a${cp(0x0a)}b${cp(0x09)}c${cp(0x1b)}d${cp(0x7f)}e${cp(0x85)}f`)).toBe('a b c d e f');
    expect(cleanText('  a   b  ')).toBe('a b');
  });
  it('removes what lets a title look like something it is: bidi overrides and isolates, zero-width characters, separators, BOM', () => {
    for (const code of [
      0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x2060, 0xfeff,
    ]) {
      const out = cleanText(`gnp${cp(code)}.exe`);
      expect(out, code.toString(16)).not.toContain(cp(code));
      expect(out.replace(/\s/g, '')).toBe('gnp.exe');
    }
  });
  it('is text only: markup comes out as the same characters, never anything to interpret', () => {
    expect(cleanText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
  it('caps by code point — never half an emoji — and trims what is left', () => {
    expect(cleanText('a'.repeat(300))).toHaveLength(TEXT_MAX);
    const cut = cleanText('🎧'.repeat(200));
    expect(Array.from(cut)).toHaveLength(TEXT_MAX);
    expect(cut.endsWith('🎧')).toBe(true);
    expect(cleanText(`${'a'.repeat(TEXT_MAX - 1)} b`)).toBe('a'.repeat(TEXT_MAX - 1));
  });
  it('anything that is not a string is empty', () => {
    for (const v of [undefined, null, 5, {}, [], true]) expect(cleanText(v)).toBe('');
  });
});

describe('cleanTrack', () => {
  const raw = {
    title: '  Night Drive ',
    artist: 'The Tests',
    album: 'Fixtures',
    artworkUrl: 'https://i.scdn.co/image/abc',
    trackUrl: 'https://open.spotify.com/track/1',
  };

  it('builds a clean track; the player comes from the caller, not from the data', () => {
    expect(cleanTrack({ ...raw, source: 'youtube-music' }, 'spotify')).toEqual({
      title: 'Night Drive',
      artist: 'The Tests',
      album: 'Fixtures',
      artworkUrl: 'https://i.scdn.co/image/abc',
      trackUrl: 'https://open.spotify.com/track/1',
      source: 'spotify',
    });
  });
  it('has nothing to show without a title', () => {
    expect(cleanTrack({ ...raw, title: '' }, 'spotify')).toBeNull();
    expect(cleanTrack({ ...raw, title: `  ${cp(0x200b)} ` }, 'spotify')).toBeNull();
    expect(cleanTrack({ artist: 'x' }, 'spotify')).toBeNull();
    for (const v of [null, undefined, 'x', 5, []]) expect(cleanTrack(v, 'spotify')).toBeNull();
  });
  it('drops an artwork address or link that is not on the player’s own hosts — and keeps the track', () => {
    const t = cleanTrack({ ...raw, artworkUrl: 'https://attacker.example/pixel.gif?me', trackUrl: 'javascript:alert(1)' }, 'spotify');
    expect(t).not.toBeNull();
    expect(t?.artworkUrl).toBeNull();
    expect(t?.trackUrl).toBeNull();
  });
  it('album and artist are optional', () => {
    expect(cleanTrack({ title: 'x' }, 'tidal')).toMatchObject({ artist: '', album: '', artworkUrl: null, trackUrl: null });
  });
});

describe('parseTrack / trackFromRow', () => {
  it('re-validates a track that is already in our shape (storage, messages) — the shape says nothing about what is in it', () => {
    const t = parseTrack({ title: 'x', artist: '', album: '', artworkUrl: 'https://evil.example/a.png', trackUrl: null, source: 'spotify' });
    expect(t?.artworkUrl).toBeNull();
    expect(parseTrack({ title: 'x', source: 'napster' })).toBeNull();
    expect(parseTrack({ title: 'x' })).toBeNull();
    expect(parseTrack(null)).toBeNull();
  });
  it('reads a database row (snake_case) and applies the same rules', () => {
    const row = { title: 'Song', artist: 'A', album: '', artwork_url: 'https://i.scdn.co/image/x', track_url: 'https://evil.example/', source: 'spotify' };
    expect(trackFromRow(row)).toEqual({ title: 'Song', artist: 'A', album: '', artworkUrl: 'https://i.scdn.co/image/x', trackUrl: null, source: 'spotify' });
    expect(trackFromRow({ ...row, source: 'x' })).toBeNull();
    expect(trackFromRow({ ...row, title: `<b>${cp(0x202e)}hi` })?.title).toBe('<b> hi');
    expect(trackFromRow('nope')).toBeNull();
  });
});

describe('sameTrack', () => {
  const a = cleanTrack({ title: 'x', artist: 'y' }, 'spotify');
  it('compares by content', () => {
    expect(sameTrack(a, cleanTrack({ title: 'x', artist: 'y' }, 'spotify'))).toBe(true);
    expect(sameTrack(a, cleanTrack({ title: 'x', artist: 'z' }, 'spotify'))).toBe(false);
    expect(sameTrack(a, cleanTrack({ title: 'x', artist: 'y' }, 'tidal'))).toBe(false);
    expect(sameTrack(a, null)).toBe(false);
    expect(sameTrack(null, null)).toBe(true);
  });
});
