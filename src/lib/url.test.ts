import { describe, expect, it } from 'vitest';
import { hostnameOf, normalizeUrl, resolveInput } from '@/lib/url';

describe('resolveInput (omnibox heuristic)', () => {
  it('treats bare domains as URLs — the old regex needed two dots, so github.com was searched', () => {
    expect(resolveInput('github.com')).toEqual({ kind: 'url', url: 'https://github.com' });
    expect(resolveInput('  linear.app  ')).toEqual({ kind: 'url', url: 'https://linear.app' });
    expect(resolveInput('example.co.uk/path?x=1')).toEqual({ kind: 'url', url: 'https://example.co.uk/path?x=1' });
  });

  it('keeps explicit schemes and internal pages', () => {
    expect(resolveInput('https://x.dev/a?b=1')).toEqual({ kind: 'url', url: 'https://x.dev/a?b=1' });
    expect(resolveInput('chrome://settings')).toEqual({ kind: 'url', url: 'chrome://settings' });
    expect(resolveInput('about:blank')).toEqual({ kind: 'url', url: 'about:blank' });
  });

  it('uses http for localhost and IPs', () => {
    expect(resolveInput('localhost:3000')).toEqual({ kind: 'url', url: 'http://localhost:3000' });
    expect(resolveInput('192.168.1.1:8080/admin')).toEqual({ kind: 'url', url: 'http://192.168.1.1:8080/admin' });
  });

  it('searches for anything with spaces or no real TLD', () => {
    expect(resolveInput('cat food')).toEqual({ kind: 'search', query: 'cat food' });
    expect(resolveInput('github.com foo')).toEqual({ kind: 'search', query: 'github.com foo' });
    expect(resolveInput('weather')).toEqual({ kind: 'search', query: 'weather' });
    expect(resolveInput('what is 2+2')).toEqual({ kind: 'search', query: 'what is 2+2' });
  });

  it('does not mistake file names for domains', () => {
    expect(resolveInput('node.js').kind).toBe('search');
    expect(resolveInput('index.ts').kind).toBe('search');
    expect(resolveInput('readme.md').kind).toBe('search');
  });

  it('handles empty input', () => {
    expect(resolveInput('')).toEqual({ kind: 'search', query: '' });
  });
});

describe('url helpers', () => {
  it('hostnameOf strips www', () => {
    expect(hostnameOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(hostnameOf('not a url')).toBe('not a url');
  });
  it('normalizeUrl returns canonical https URLs or null', () => {
    expect(normalizeUrl('github.com')).toBe('https://github.com/');
    expect(normalizeUrl('http://localhost:5173')).toBe('http://localhost:5173/');
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('nodots')).toBeNull();
  });
});
