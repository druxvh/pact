import { describe, expect, it } from 'vitest';
import { parseTitle } from './title';

describe('parseTitle', () => {
  it('reads the title and drops the site suffix', () => {
    expect(parseTitle('<html><head><title>Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film - YouTube</title>')).toBe(
      'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film',
    );
  });
  it('decodes entities and a leading notification count', () => {
    expect(parseTitle('<title>(3) Tom &amp; Jerry &#39;s &quot;best&quot; &#x1F600; - YouTube</title>')).toBe('Tom & Jerry \'s "best" 😀');
  });
  it('is not fooled by a missing, empty or generic title', () => {
    expect(parseTitle('<html></html>')).toBeNull();
    expect(parseTitle('<title></title>')).toBeNull();
    expect(parseTitle('<title>YouTube</title>')).toBeNull();
  });
  it('survives absurd numeric entities', () => {
    expect(parseTitle('<title>x&#99999999999;y - YouTube</title>')).toContain('x');
  });
});
