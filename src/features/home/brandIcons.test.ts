import { describe, expect, it } from 'vitest';
import { brandFor, hexLightness } from './brandIcons';

describe('brandFor', () => {
  it('finds well-known sites by hostname, ignoring www and path', () => {
    expect(brandFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.title).toBe('YouTube');
    expect(brandFor('https://github.com/druxvh/pact')?.title).toBe('GitHub');
    expect(brandFor('https://notion.so/')?.title).toBe('Notion');
    expect(brandFor('https://x.com/home')?.title).toBe('X');
  });

  it('prefers the most specific host (Google has many products)', () => {
    expect(brandFor('https://mail.google.com/mail/u/0')?.title).toBe('Gmail');
    expect(brandFor('https://calendar.google.com/')?.title).toBe('Google Calendar');
    expect(brandFor('https://docs.google.com/document/d/1')?.title).toBe('Google Docs');
    expect(brandFor('https://music.youtube.com/')?.title).toBe('YouTube Music');
    expect(brandFor('https://www.google.com/search?q=x')?.title).toBe('Google');
  });

  it('matches subdomains of a known brand', () => {
    expect(brandFor('https://gist.github.com/x')?.title).toBe('GitHub');
    expect(brandFor('https://en.wikipedia.org/wiki/Pact')?.title).toBe('Wikipedia');
  });

  it('never lends a logo to a look-alike domain', () => {
    for (const url of [
      'https://evil-github.com/',
      'https://github.com.evil.example/',
      'https://mail.google.com.evil.example/',
      'https://notgithub.com/',
      'https://youtube.com.au/',
    ]) {
      expect(brandFor(url), url).toBeNull();
    }
  });

  it('returns null for unknown sites and garbage', () => {
    expect(brandFor('https://my-company.internal/')).toBeNull();
    expect(brandFor('not a url')).toBeNull();
    expect(brandFor('')).toBeNull();
  });

  it('exposes usable path data and a #hex colour', () => {
    const b = brandFor('https://github.com');
    expect(b?.path.length).toBeGreaterThan(50);
    expect(b?.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('hexLightness', () => {
  it('orders dark < mid < light', () => {
    expect(hexLightness('#000000')).toBe(0);
    expect(hexLightness('#ffffff')).toBeCloseTo(1, 5);
    expect(hexLightness('#ff0000')).toBeLessThan(hexLightness('#ffff00'));
    expect(hexLightness('#fffc00')).toBeGreaterThan(0.72); // Snapchat yellow → needs the inverted chip
  });
});
