import { describe, expect, it } from 'vitest';
import {
  addressesArePublic,
  checkUrl,
  decodeEntities,
  isPrivateIPv4,
  isPrivateIPv6,
  metaTags,
  normalizeUrl,
  parsePage,
} from '../../../supabase/functions/link-preview/lib';

describe('SSRF guard: addresses', () => {
  it('refuses every private / special IPv4 range, including the cloud metadata address', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '192.0.0.8',
      '198.18.0.1',
    ]) {
      expect(isPrivateIPv4(ip), ip).toBe(true);
    }
  });
  it('allows ordinary public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34', '100.63.255.255']) expect(isPrivateIPv4(ip), ip).toBe(false);
  });
  it('refuses malformed addresses rather than guessing', () => {
    for (const ip of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'a.b.c.d', '1.2.3.-4']) expect(isPrivateIPv4(ip), ip).toBe(true);
  });
  it('refuses private IPv6, including IPv4 hidden inside IPv6', () => {
    for (const ip of [
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '[::1]',
      '64:ff9b::1',
      '2001:db8::1',
    ]) {
      expect(isPrivateIPv6(ip), ip).toBe(true);
    }
  });
  it('allows public IPv6', () => {
    for (const ip of ['2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8']) expect(isPrivateIPv6(ip), ip).toBe(false);
  });
  it('after DNS, one private answer is enough to refuse, and no answers is a refusal', () => {
    expect(addressesArePublic(['8.8.8.8', '2606:4700:4700::1111'])).toBe(true);
    expect(addressesArePublic(['8.8.8.8', '10.0.0.1'])).toBe(false);
    expect(addressesArePublic([])).toBe(false);
  });
});

describe('SSRF guard: URLs', () => {
  it('accepts normal public pages', () => {
    for (const u of ['https://example.com/a?b=1#c', 'http://example.com', 'https://sub.example.co.uk:443/x']) expect(checkUrl(u).ok, u).toBe(true);
  });
  it('refuses other schemes, credentials, odd ports and internal names', () => {
    const bad = [
      'file:///etc/passwd',
      'ftp://example.com',
      'javascript:alert(1)',
      'data:text/html,hi',
      'https://user:pw@example.com',
      'https://example.com:8080',
      'https://example.com:22',
      'http://localhost/',
      'http://app.localhost',
      'http://printer.local',
      'http://db.internal',
      'http://intranet',
      'http://127.0.0.1',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://2130706433/',
      'not a url',
      '',
    ];
    for (const u of bad) expect(checkUrl(u).ok, u).toBe(false);
  });
  it('treats a numeric-only host (decimal/hex/octal tricks) as internal because the URL parser normalises it', () => {
    expect(checkUrl('http://2130706433/').ok).toBe(false); // 127.0.0.1
    expect(checkUrl('http://0x7f.0.0.1/').ok).toBe(false);
    expect(checkUrl('http://0177.0.0.1/').ok).toBe(false);
  });
  it('normalises urls for caching', () => {
    expect(normalizeUrl('https://EXAMPLE.com/a#frag')).toBe('https://example.com/a');
  });
});

describe('reading a page', () => {
  const html = `<!doctype html><html><head><title>Fallback &amp; title</title>
    <meta property="og:title" content="The &quot;real&quot; title &#x1F600;">
    <meta name='description' content='plain description'>
    <meta property="og:description" content="OG description">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:site_name" content="Example News">
    <meta property="og:title" content="duplicate ignored"></head><body>hi</body></html>`;
  it('prefers Open Graph, decodes entities, resolves relative image URLs and keeps the first of duplicates', () => {
    expect(parsePage(html, 'https://example.com/post/1')).toEqual({
      title: 'The "real" title 😀',
      description: 'OG description',
      site: 'Example News',
      image: 'https://example.com/img/cover.png',
    });
  });
  it('falls back to <title>, the description meta and the hostname', () => {
    const p = parsePage('<title>Only a title</title><meta name="description" content="d">', 'https://www.example.org/x');
    expect(p).toEqual({ title: 'Only a title', description: 'd', site: 'example.org', image: null });
  });
  it('clips long text and survives junk', () => {
    expect(parsePage(`<meta property="og:title" content="${'x'.repeat(500)}">`, 'https://a.com').title?.length).toBeLessThanOrEqual(140);
    expect(parsePage('', 'https://a.com')).toEqual({ title: null, description: null, site: 'a.com', image: null });
    expect(parsePage('<meta property="og:image" content="http://[bad">', 'https://a.com').image).toBeNull();
  });
  it('decodes entities safely (no surrogate halves, no huge code points)', () => {
    expect(decodeEntities('a&#55357;b&#99999999;c&amp;&unknown;')).toBe('abc&&unknown;');
    expect([...metaTags('<meta name="a" content="1"><meta name="A" content="2">').entries()]).toEqual([['a', '1']]);
  });
});
