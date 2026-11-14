import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg, wifiPayload } from '@/features/tools/lib/qr';

describe('qr', () => {
  it('encodes a real QR matrix (not the old Math.random() squares)', () => {
    const m = qrMatrix('https://pact.app', 'M');
    expect(m.length).toBe(25); // version 2
    expect(m.every((row) => row.length === 25)).toBe(true);
    // finder pattern: solid 7×7 ring with a 3×3 core, at all three corners
    const ring = (ox: number, oy: number) =>
      [0, 1, 2, 3, 4, 5, 6].every((i) => m[oy]?.[ox + i] && m[oy + 6]?.[ox + i] && m[oy + i]?.[ox] && m[oy + i]?.[ox + 6]) &&
      m[oy + 3]?.[ox + 3] === true &&
      m[oy + 1]?.[ox + 1] === false;
    expect(ring(0, 0)).toBe(true);
    expect(ring(18, 0)).toBe(true);
    expect(ring(0, 18)).toBe(true);
  });

  it('is deterministic — same input, same code (the old tool re-randomised on every keystroke)', () => {
    expect(qrMatrix('hello', 'Q')).toEqual(qrMatrix('hello', 'Q'));
    expect(qrMatrix('hello', 'Q')).not.toEqual(qrMatrix('hellp', 'Q'));
  });

  it('higher error correction needs a denser code', () => {
    const text = 'https://example.com/some/longer/path?with=query';
    expect(qrMatrix(text, 'H').length).toBeGreaterThanOrEqual(qrMatrix(text, 'L').length);
  });

  it('throws when the payload cannot fit', () => {
    expect(() => qrMatrix('x'.repeat(5000), 'H')).toThrow();
  });

  it('renders square and dot SVGs; finder eyes stay square in dots mode for scannability', () => {
    const m = qrMatrix('pact', 'M');
    const opts = { ecc: 'M' as const, fg: '#000', bg: '#fff', margin: 2 };
    const sq = qrSvg(m, { ...opts, style: 'square' });
    const dots = qrSvg(m, { ...opts, style: 'dots' });
    expect(sq).toContain('<rect');
    expect(sq).not.toContain('<circle');
    expect(dots).toContain('<circle');
    expect(dots).toContain('rx="0.3"');
  });

  it('builds Wi-Fi payloads with escaping', () => {
    expect(wifiPayload('Home', 'secret', 'WPA', false)).toBe('WIFI:T:WPA;S:Home;P:secret;;');
    expect(wifiPayload('a;b', 'p:w', 'WPA', true)).toBe('WIFI:T:WPA;S:a\\;b;P:p\\:w;H:true;;');
    expect(wifiPayload('Open', '', 'nopass', false)).toBe('WIFI:T:nopass;S:Open;;');
  });
});
