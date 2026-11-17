import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, backupFileName, FILE_MAX_CHARS, parseBackupText, serializeBundle, sniffImage, WALLPAPER_MAX_BYTES } from './format';
import type { Bundle } from './types';

const env = (state: Record<string, unknown>, version: number) => JSON.stringify({ state, version });
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const v1 = (data: Record<string, string>) => JSON.stringify({ app: 'pact', version: 1, exportedAt: '2026-01-02T03:04:05.000Z', data });

describe('sniffImage', () => {
  it('recognises raster images by their bytes, and nothing else — SVG (which can carry script) is not one', () => {
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<?xml version="1.0"?>'))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
});

describe('reading a backup file', () => {
  it('still reads the original format (version 1, no media)', () => {
    const r = parseBackupText(v1({ 'pact-notes': env({ notes: [] }, 3), 'pact-theme': env({ mode: 'dark' }, 2) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fileVersion).toBe(1);
    expect(Object.keys(r.bundle.data).sort()).toEqual(['pact-notes', 'pact-theme']);
    expect(r.bundle.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(r.bundle.appVersion).toBe('unknown');
    expect(r.bundle.wallpaper).toBeNull();
  });

  it('a file with no version is treated as the original format', () => {
    expect(parseBackupText(JSON.stringify({ app: 'pact', data: { 'pact-theme': env({ mode: 'dark' }, 2) } })).ok).toBe(true);
  });

  it('rejects garbage with a plain-language reason and never throws', () => {
    const cases: Array<[string, RegExp]> = [
      ['not json {', /valid JSON/],
      ['[]', /doesn’t look like a pact backup/],
      ['null', /doesn’t look like a pact backup/],
      [JSON.stringify({ app: 'other', data: {} }), /doesn’t look like a pact backup/],
      [JSON.stringify({ app: 'pact', version: 'two', data: {} }), /format version/],
      [JSON.stringify({ app: 'pact', version: 0, data: {} }), /format version/],
      [JSON.stringify({ app: 'pact', version: 1.5, data: {} }), /format version/],
      [JSON.stringify({ app: 'pact', version: 1, data: 'x' }), /no data/],
      [JSON.stringify({ app: 'pact', version: 1, data: null }), /no data/],
      [JSON.stringify({ app: 'pact', version: 1, data: {} }), /empty/],
      [JSON.stringify({ app: 'pact', version: 1, data: { 'pact-auth': '{}', 'something-else': 'x' } }), /empty/], // only unknown / excluded keys
    ];
    for (const [text, why] of cases) {
      const r = parseBackupText(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.error).toMatch(why);
    }
  });

  it('refuses a backup from a newer format with an actionable message', () => {
    const r = parseBackupText(JSON.stringify({ app: 'pact', version: BACKUP_FORMAT + 1, data: { 'pact-theme': '{}' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version of pact.*Update pact/s);
  });

  it('caps the file size', () => {
    const r = parseBackupText('x'.repeat(FILE_MAX_CHARS + 1));
    expect(r.ok).toBe(false);
  });

  it('ignores keys that must never come from a file (auth session, owner, sync bookkeeping) and non-string values', () => {
    const r = parseBackupText(
      JSON.stringify({
        app: 'pact',
        version: 2,
        data: {
          'pact-theme': env({ mode: 'dark' }, 2),
          'pact-auth': '{"access_token":"x"}',
          'pact-local-owner': 'someone',
          'pact-sync-notes': '{}',
          'pact-notes': 42,
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.bundle.data)).toEqual(['pact-theme']);
    expect(r.warnings.join(' ')).toMatch(/pact-notes/);
  });

  it('type-checks the envelope fields', () => {
    const r = parseBackupText(
      JSON.stringify({ app: 'pact', version: 2, exportedAt: 12, appVersion: { x: 1 }, account: ['a'], data: { 'pact-theme': env({ mode: 'dark' }, 2) } }),
    );
    expect(r.ok && r.bundle).toMatchObject({ exportedAt: '', appVersion: 'unknown', account: null });
  });

  describe('the wallpaper picture', () => {
    const file = (wallpaper: unknown) => JSON.stringify({ app: 'pact', version: 2, data: { 'pact-theme': env({ mode: 'dark' }, 2) }, media: { wallpaper } });

    it('is decoded when its bytes really are an image (whatever the file claims it is)', () => {
      const r = parseBackupText(file({ mime: 'text/html', name: 'sunset.webp', base64: b64(WEBP) }));
      expect(r.ok && r.bundle.wallpaper?.blob.type).toBe('image/webp');
      expect(r.ok && r.bundle.wallpaper?.name).toBe('sunset.webp');
      expect(r.ok && r.bundle.wallpaper?.blob.size).toBe(WEBP.length);
    });

    it('is skipped (with a warning, the rest still imports) when it is not an image, not base64, or too big', () => {
      const svg = btoa('<svg onload="alert(1)"></svg>');
      for (const bad of [
        { base64: svg },
        { base64: '%%%not base64%%%' },
        { base64: '' },
        { base64: 12 },
        { base64: 'A'.repeat(9 * 1024 * 1024) },
        'string',
        null,
      ]) {
        const r = parseBackupText(file(bad));
        expect(r.ok, JSON.stringify(bad).slice(0, 40)).toBe(true);
        if (r.ok) {
          expect(r.bundle.wallpaper).toBeNull();
          if (typeof bad === 'object' && bad !== null) expect(r.warnings.length).toBeGreaterThan(0);
        }
      }
    });
  });
});

describe('writing a backup file', () => {
  const bundle = (wallpaper: Bundle['wallpaper']): Bundle => ({
    exportedAt: '2026-11-17T10:00:00.000Z',
    appVersion: '1.2.3',
    account: 'abc123',
    data: { 'pact-notes': env({ notes: [{ id: 'a' }] }, 3), 'pact-theme': env({ mode: 'light' }, 2) },
    wallpaper,
  });

  it('round-trips, wallpaper included', async () => {
    const text = await serializeBundle(bundle({ blob: new Blob([PNG as BlobPart], { type: 'image/png' }), name: 'Wallpaper' }));
    const back = parseBackupText(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.fileVersion).toBe(BACKUP_FORMAT);
    expect(back.bundle).toMatchObject({ appVersion: '1.2.3', account: 'abc123', exportedAt: '2026-11-17T10:00:00.000Z' });
    expect(back.bundle.data).toEqual(bundle(null).data);
    expect(back.bundle.wallpaper?.blob.type).toBe('image/png');
    expect(back.bundle.wallpaper?.blob.size).toBe(PNG.length);
  });

  it('without a wallpaper there is no media at all', async () => {
    const parsed = JSON.parse(await serializeBundle(bundle(null)));
    expect(parsed.media).toEqual({});
    expect(parsed.app).toBe('pact');
  });

  it('the cap on a wallpaper in a backup is a few megabytes', () => {
    expect(WALLPAPER_MAX_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(backupFileName('2026-11-17T10:00:00.000Z')).toBe('pact-backup-2026-11-17.json');
  });
});
