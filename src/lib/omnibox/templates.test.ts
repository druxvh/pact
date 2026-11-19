import { describe, expect, it } from 'vitest';
import {
  aliasFormatProblem,
  expandSnippet,
  expandUrlTemplate,
  hasPlaceholder,
  isValidAlias,
  normalizeAlias,
  placeholdersIn,
  safeWebUrl,
  shortTemplate,
  snippetPreview,
  templateHome,
  urlTemplateProblem,
  usesClipboard,
} from '@/lib/omnibox/templates';

describe('aliases', () => {
  it('normalises what was typed: trimmed, lower-case, no leading !', () => {
    expect(normalizeAlias('  !GH ')).toBe('gh');
    expect(normalizeAlias('My-Alias')).toBe('my-alias');
  });

  it('accepts lowercase letters, digits and inner dashes up to 24 characters', () => {
    for (const ok of ['gh', 't', 'a1', 'my-repo', 'x'.repeat(24), '2fa']) expect(isValidAlias(ok), ok).toBe(true);
  });

  it('refuses everything else, with a reason', () => {
    for (const bad of ['', 'Has Space', 'under_score', '-lead', 'trail-', 'dot.dot', 'ünï', 'x'.repeat(25), '!bang', 'a/b']) {
      expect(isValidAlias(bad), bad).toBe(false);
      expect(aliasFormatProblem(bad), bad).toEqual(expect.any(String));
    }
  });
});

describe('placeholders', () => {
  it('finds the names a template uses', () => {
    expect(placeholdersIn('https://x.com/{query}/{Clipboard}/{query}')).toEqual(['query', 'clipboard']);
    expect(placeholdersIn('no braces')).toEqual([]);
    expect(hasPlaceholder('https://x.com/?q={query}', 'query')).toBe(true);
    expect(hasPlaceholder('https://x.com/', 'query')).toBe(false);
    expect(usesClipboard('paste: {clipboard}')).toBe(true);
  });
});

describe('URL templates', () => {
  it('encodes {query} and {clipboard} and leaves the rest alone', () => {
    expect(expandUrlTemplate('https://github.com/search?q={query}', { query: 'react hooks & more' })).toBe(
      'https://github.com/search?q=react%20hooks%20%26%20more',
    );
    expect(expandUrlTemplate('https://x.com/{clipboard}', { clipboard: ' a/b?c ' })).toBe('https://x.com/a%2Fb%3Fc');
    expect(expandUrlTemplate('https://x.com/?a={query}&b={other}', { query: '' })).toBe('https://x.com/?a=&b={other}');
  });

  it('never expands what was inserted: a query that looks like a placeholder stays text', () => {
    expect(expandUrlTemplate('https://x.com/?q={query}&c={clipboard}', { query: '{clipboard}', clipboard: 'secret' })).toBe(
      'https://x.com/?q=%7Bclipboard%7D&c=secret',
    );
  });

  it('survives text that cannot be encoded (a lone surrogate)', () => {
    expect(() => expandUrlTemplate('https://x.com/{query}', { query: 'ok\ud83d' })).not.toThrow();
  });

  it('truncates a huge clipboard so the address stays sane', () => {
    expect(expandUrlTemplate('https://x.com/{clipboard}', { clipboard: 'a'.repeat(9000) }).length).toBeLessThan(1600);
  });

  describe('urlTemplateProblem', () => {
    it('accepts http(s) addresses with or without placeholders', () => {
      for (const ok of [
        'https://example.com',
        'http://example.com/a',
        'https://example.com/?q={query}',
        'https://{query}.example.com/',
        'HTTPS://Example.com/{clipboard}',
      ])
        expect(urlTemplateProblem(ok), ok).toBeNull();
    });

    it('rejects every other scheme, including ones a placeholder could smuggle in', () => {
      for (const bad of [
        'javascript:alert(1)',
        'data:text/html,<script>1</script>',
        'chrome://settings',
        'chrome-extension://abc/x.html',
        'file:///etc/passwd',
        'ftp://example.com',
        'vbscript:x',
        '{query}://evil.example',
        '{query}',
        'example.com',
        '//example.com',
        ' javascript:1',
      ])
        expect(urlTemplateProblem(bad), bad).toEqual(expect.any(String));
    });

    it('rejects empty, unknown placeholders, stray braces, credentials, absurd length and non-URLs', () => {
      expect(urlTemplateProblem('')).toMatch(/Enter a web address/);
      expect(urlTemplateProblem('https://x.com/{nope}')).toMatch(/Unknown placeholder \{nope\}/);
      expect(urlTemplateProblem('https://x.com/{}')).toMatch(/Unknown placeholder/);
      expect(urlTemplateProblem('https://x.com/{query')).toMatch(/stray/);
      expect(urlTemplateProblem('https://user:pw@x.com/')).toMatch(/username/);
      expect(urlTemplateProblem(`https://x.com/${'a'.repeat(2100)}`)).toMatch(/too long/);
      expect(urlTemplateProblem('https://')).toEqual(expect.any(String));
    });
  });

  it('safeWebUrl is the last gate before anything is opened', () => {
    expect(safeWebUrl('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(safeWebUrl('javascript:alert(1)')).toBeNull();
    expect(safeWebUrl('data:text/plain,hi')).toBeNull();
    expect(safeWebUrl('not a url')).toBeNull();
  });

  it('finds a template’s home and a short display form', () => {
    expect(templateHome('https://github.com/search?q={query}')).toBe('https://github.com/');
    expect(templateHome('http://localhost:3000/x/{query}')).toBe('http://localhost:3000/');
    expect(templateHome('nope')).toBe('');
    expect(shortTemplate('https://www.github.com/search?q={query}')).toBe('github.com/search?q={query}');
    expect(shortTemplate('https://example.com/')).toBe('example.com');
  });
});

describe('snippets', () => {
  const now = new Date(2026, 10, 17, 9, 5);
  const opts = { now, locale: 'en-US' };

  it('fills {date}, {time}, {datetime} and {clipboard}', () => {
    expect(expandSnippet('Sent on {date}', opts)).toBe('Sent on Nov 17, 2026');
    expect(expandSnippet('At {time}', opts)).toMatch(/^At 9:05\sAM$/);
    expect(expandSnippet('{datetime}', opts)).toMatch(/^Nov 17, 2026.*9:05\sAM$/);
    expect(expandSnippet('Hi {Clipboard}!', { ...opts, clipboard: 'Ada' })).toBe('Hi Ada!');
  });

  it('leaves other braces alone — code and JSON are fine', () => {
    expect(expandSnippet('function f() { return {a: 1}; } {name}', opts)).toBe('function f() { return {a: 1}; } {name}');
  });

  it('does not expand placeholders inside the clipboard text', () => {
    expect(expandSnippet('{clipboard}', { ...opts, clipboard: '{date}' })).toBe('{date}');
  });

  it('falls back to the default locale for one the browser does not know', () => {
    expect(() => expandSnippet('{date}', { now, locale: 'xx-NOPE-!!' })).not.toThrow();
  });

  it('previews on one line, with {clipboard} left as it is', () => {
    expect(snippetPreview('Dear {clipboard},\n\n   thanks   on {date}', now, 'en-US')).toBe('Dear {clipboard}, thanks on Nov 17, 2026');
    const long = snippetPreview('word '.repeat(60), now, 'en-US', 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });
});
