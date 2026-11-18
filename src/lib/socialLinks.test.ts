import { describe, expect, it } from 'vitest';
import { linkLabel, MAX_LINKS, normalizeLink, sanitizeLinks } from './socialLinks';

const ok = (kind: Parameters<typeof normalizeLink>[0], input: string) => {
  const r = normalizeLink(kind, input);
  if (!r.ok) throw new Error(r.error);
  return r.url;
};

describe('normalizeLink', () => {
  it('builds addresses from handles', () => {
    expect(ok('instagram', '@alice')).toBe('https://instagram.com/alice');
    expect(ok('x', 'alice_dev')).toBe('https://x.com/alice_dev');
    expect(ok('snapchat', 'alice')).toBe('https://snapchat.com/add/alice');
    expect(ok('youtube', '@alicetv')).toBe('https://youtube.com/@alicetv');
    expect(ok('github', 'alice')).toBe('https://github.com/alice');
  });
  it('treats names with dots as handles, but a bare platform address as an address', () => {
    expect(ok('instagram', 'sam.okafor')).toBe('https://instagram.com/sam.okafor');
    expect(ok('instagram', '@sam.okafor_')).toBe('https://instagram.com/sam.okafor_');
    expect(ok('tiktok', 'sam.okafor')).toBe('https://tiktok.com/@sam.okafor');
    expect(ok('instagram', 'instagram.com')).toBe('https://instagram.com/');
    expect(ok('x', 'twitter.com')).toBe('https://twitter.com/');
    expect(normalizeLink('instagram', 'sam.okafor/extra').ok).toBe(false); // not a handle, and not Instagram's address either
  });
  it('accepts addresses with or without the scheme, upgrades http, drops the fragment', () => {
    expect(ok('instagram', 'instagram.com/alice')).toBe('https://instagram.com/alice');
    expect(ok('facebook', 'http://www.facebook.com/alice#top')).toBe('https://www.facebook.com/alice');
    expect(ok('website', 'alice.dev')).toBe('https://alice.dev/');
    expect(ok('pinterest', 'https://pin.it/abc')).toBe('https://pin.it/abc');
  });
  it('refuses links to the wrong place, other schemes, credentials and junk', () => {
    expect(normalizeLink('instagram', 'https://evil.example/instagram.com/a').ok).toBe(false);
    expect(normalizeLink('instagram', 'https://instagram.com.evil.example/a').ok).toBe(false);
    expect(normalizeLink('github', 'https://notgithub.com/a').ok).toBe(false);
    expect(normalizeLink('website', 'javascript:alert(1)').ok).toBe(false);
    expect(normalizeLink('website', 'ftp://alice.dev').ok).toBe(false);
    expect(normalizeLink('website', 'https://user:pw@alice.dev').ok).toBe(false);
    expect(normalizeLink('website', 'https://alice.dev:8080').ok).toBe(false);
    expect(normalizeLink('website', 'localhost').ok).toBe(false);
    expect(normalizeLink('x', '').ok).toBe(false);
    expect(normalizeLink('website', `https://alice.dev/${'a'.repeat(300)}`).ok).toBe(false);
  });
  it('Discord needs an invite link, not a bare handle', () => {
    expect(normalizeLink('discord', 'alice').ok).toBe(false);
    expect(ok('discord', 'discord.gg/abc123')).toBe('https://discord.gg/abc123');
  });
});

describe('sanitizeLinks', () => {
  it('keeps valid ones, drops the rest, removes duplicates and caps at five', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ kind: 'website', url: `https://site${i}.dev` }));
    expect(sanitizeLinks(many)).toHaveLength(MAX_LINKS);
    expect(
      sanitizeLinks([
        { kind: 'x', url: 'https://x.com/a' },
        { kind: 'x', url: 'https://x.com/a' },
        { kind: 'nope', url: 'https://a.dev' },
        { kind: 'x', url: 'https://evil.io' },
        null,
        4,
      ]),
    ).toEqual([{ kind: 'x', url: 'https://x.com/a' }]);
    expect(sanitizeLinks('nope')).toEqual([]);
    expect(sanitizeLinks(undefined)).toEqual([]);
  });
});

describe('linkLabel', () => {
  it('shows a handle for social links and the host for websites', () => {
    expect(linkLabel({ kind: 'instagram', url: 'https://instagram.com/alice' })).toBe('@alice');
    expect(linkLabel({ kind: 'website', url: 'https://www.alice.dev/blog' })).toBe('alice.dev');
  });
});
