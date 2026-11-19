import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hostMatches,
  isSourceId,
  MUSIC_MATCH_PATTERNS,
  MUSIC_PAGE_HOSTS,
  SOURCE_IDS,
  SOURCES,
  safeArtworkUrl,
  safeHttpsUrl,
  safeTrackUrl,
  sourceForHost,
  sourceForUrl,
  sourceLabel,
} from './sources';

const root = resolve(__dirname, '../../..');

describe('hosts match exactly or as a real subdomain — never by containing the name', () => {
  it('accepts the host itself and its subdomains, in any case', () => {
    expect(hostMatches('scdn.co', 'scdn.co')).toBe(true);
    expect(hostMatches('i.scdn.co', 'scdn.co')).toBe(true);
    expect(hostMatches('a.b.scdn.co', 'scdn.co')).toBe(true);
    expect(hostMatches('I.SCDN.CO', 'scdn.co')).toBe(true);
  });
  it('rejects look-alikes', () => {
    for (const host of [
      'scdn.co.evil.example',
      'evil.example',
      'notscdn.co',
      'xscdn.co',
      'scdn.com',
      'scdn.co.',
      'i.scdn.co.',
      'evil-scdn.co',
      'scdn.co@evil.example',
    ]) {
      expect(hostMatches(host, 'scdn.co'), host).toBe(false);
    }
  });
});

describe('safeHttpsUrl', () => {
  const ok = (u: string, hosts = ['scdn.co']) => safeHttpsUrl(u, hosts);

  it('returns the canonical address for https on an allowed host', () => {
    expect(ok('https://i.scdn.co/image/abc')).toBe('https://i.scdn.co/image/abc');
    expect(ok('https://I.SCDN.CO/image/abc?x=1#top')).toBe('https://i.scdn.co/image/abc?x=1#top');
    expect(ok('https://i.scdn.co:443/image/abc')).toBe('https://i.scdn.co/image/abc');
  });

  it('rejects the trusted name anywhere but the host: path, prefix, subdomain-of-someone-else, credentials', () => {
    for (const bad of [
      'https://evil.example/i.scdn.co/image/abc',
      'https://evil.example/spotify.com',
      'https://scdn.co.evil.example/x',
      'https://i.scdn.co.evil.example/x',
      'https://i.scdn.co@evil.example/x',
      'https://user:pw@i.scdn.co/x',
      'https://i.scdn.co:pw@evil.example/x',
      'https://notscdn.co/x',
      'https://evil.example/?u=https://i.scdn.co/x',
      'https://i.scdn.co./x',
    ]) {
      expect(ok(bad), bad).toBeNull();
    }
  });

  it('rejects other schemes, other ports, relative and malformed addresses, whitespace and control characters', () => {
    const control = String.fromCodePoint(0x01);
    for (const bad of [
      'http://i.scdn.co/x',
      'ftp://i.scdn.co/x',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'blob:https://i.scdn.co/123',
      'file:///etc/passwd',
      '//i.scdn.co/x',
      '/image/abc',
      'i.scdn.co/x',
      'https://i.scdn.co:8443/x',
      'https://i.scdn.co:80/x',
      'https://',
      '',
      ' https://i.scdn.co/x',
      'https://i.scdn.co/x y',
      `https://i.scdn.co/x${control}y`,
      'https://i.scdn.co/x\ny',
      'https://192.168.0.1/x',
      'https://[::1]/x',
      'https://localhost/x',
    ]) {
      expect(ok(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects non-strings and very long addresses', () => {
    for (const bad of [undefined, null, 5, {}, ['https://i.scdn.co/x']]) expect(safeHttpsUrl(bad, ['scdn.co'])).toBeNull();
    expect(ok(`https://i.scdn.co/${'a'.repeat(500)}`)).toBeNull();
    expect(ok(`https://i.scdn.co/${'a'.repeat(400)}`)).not.toBeNull();
  });
});

describe('each player has its own artwork and link hosts', () => {
  it('artwork must come from that player’s image hosts', () => {
    expect(safeArtworkUrl('https://i.scdn.co/image/a', 'spotify')).toBe('https://i.scdn.co/image/a');
    expect(safeArtworkUrl('https://lh3.googleusercontent.com/abc=w544', 'youtube-music')).not.toBeNull();
    expect(safeArtworkUrl('https://i.ytimg.com/vi/x/hq.jpg', 'youtube-music')).not.toBeNull();
    expect(safeArtworkUrl('https://i1.sndcdn.com/artworks-x.jpg', 'soundcloud')).not.toBeNull();
    expect(safeArtworkUrl('https://is1-ssl.mzstatic.com/image/x.jpg', 'apple-music')).not.toBeNull();
    expect(safeArtworkUrl('https://cdn-images.dzcdn.net/images/x.jpg', 'deezer')).not.toBeNull();
    expect(safeArtworkUrl('https://resources.tidal.com/images/x.jpg', 'tidal')).not.toBeNull();
    expect(safeArtworkUrl('https://i.ytimg.com/vi/x/hq.jpg', 'spotify')).toBeNull(); // another player's CDN
    expect(safeArtworkUrl('https://images.weserv.nl/?url=i.scdn.co/x', 'spotify')).toBeNull(); // a proxy that fetches anything
    expect(safeArtworkUrl('https://attacker.example/pixel.gif', 'spotify')).toBeNull();
  });

  it('a track link must be on the player’s own site', () => {
    expect(safeTrackUrl('https://open.spotify.com/track/abc', 'spotify')).toBe('https://open.spotify.com/track/abc');
    expect(safeTrackUrl('https://music.youtube.com/watch?v=abc', 'youtube-music')).not.toBeNull();
    expect(safeTrackUrl('https://soundcloud.com/a/b', 'soundcloud')).not.toBeNull();
    expect(safeTrackUrl('https://m.soundcloud.com/a/b', 'soundcloud')).not.toBeNull();
    expect(safeTrackUrl('https://listen.tidal.com/track/1', 'tidal')).not.toBeNull();
    expect(safeTrackUrl('https://www.youtube.com/watch?v=abc', 'youtube-music')).toBeNull(); // YouTube itself is not a music player here
    expect(safeTrackUrl('https://music.youtube.com/watch?v=abc', 'spotify')).toBeNull();
    expect(safeTrackUrl('https://open.spotify.com.evil.example/track/1', 'spotify')).toBeNull();
    expect(safeTrackUrl('http://open.spotify.com/track/1', 'spotify')).toBeNull();
  });
});

describe('which page is a music player', () => {
  it('knows the six players by their exact page host', () => {
    expect(SOURCE_IDS).toHaveLength(6);
    expect(sourceForHost('open.spotify.com')).toBe('spotify');
    expect(sourceForHost('MUSIC.YOUTUBE.COM')).toBe('youtube-music');
    expect(sourceForHost('www.deezer.com')).toBe('deezer');
    expect(sourceForHost('tidal.com')).toBe('tidal');
  });
  it('anything else — including look-alikes and the ordinary sites of the same companies — is not a player', () => {
    for (const host of [
      'www.youtube.com',
      'youtube.com',
      'www.spotify.com',
      'spotify.com',
      'open.spotify.com.evil.example',
      'evil.example',
      'sub.open.spotify.com',
      '',
    ]) {
      expect(sourceForHost(host), host).toBeNull();
    }
  });
  it('a tab address must be https on a player host', () => {
    expect(sourceForUrl('https://open.spotify.com/album/1')).toBe('spotify');
    expect(sourceForUrl('http://open.spotify.com/album/1')).toBeNull();
    expect(sourceForUrl('https://www.youtube.com/watch?v=1')).toBeNull();
    expect(sourceForUrl('https://evil.example/?https://open.spotify.com/')).toBeNull();
    expect(sourceForUrl(undefined)).toBeNull();
    expect(sourceForUrl('not a url')).toBeNull();
    expect(sourceForUrl(`https://open.spotify.com/${'a'.repeat(3000)}`)).toBeNull();
  });
  it('knows its ids and labels', () => {
    expect(isSourceId('spotify')).toBe(true);
    expect(isSourceId('Spotify')).toBe(false);
    expect(isSourceId('napster')).toBe(false);
    expect(isSourceId(undefined)).toBe(false);
    expect(sourceLabel('youtube-music')).toBe('YouTube Music');
  });
  it('the permission patterns are exactly the player pages — nothing broader', () => {
    expect([...MUSIC_MATCH_PATTERNS].sort()).toEqual(
      [
        'https://open.spotify.com/*',
        'https://music.youtube.com/*',
        'https://soundcloud.com/*',
        'https://music.apple.com/*',
        'https://www.deezer.com/*',
        'https://tidal.com/*',
      ].sort(),
    );
    for (const p of MUSIC_MATCH_PATTERNS) expect(p).toMatch(/^https:\/\/[a-z.]+\/\*$/);
    expect(MUSIC_PAGE_HOSTS).toHaveLength(MUSIC_MATCH_PATTERNS.length);
  });
});

describe('the database and this module hold the same lists', () => {
  const sql = readFileSync(resolve(root, 'supabase/migrations/20261119100000_now_playing.sql'), 'utf8');

  it('np_hosts has exactly the track and artwork hosts of every source', () => {
    const fromSql: Record<string, string[]> = {};
    for (const m of sql.matchAll(/when '(track|artwork):([a-z-]+)' then array\[([^\]]*)\]/g)) {
      fromSql[`${m[1]}:${m[2]}`] = [...(m[3] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
    }
    const fromCode: Record<string, string[]> = {};
    for (const id of SOURCE_IDS) {
      fromCode[`track:${id}`] = [...SOURCES[id].trackHosts];
      fromCode[`artwork:${id}`] = [...SOURCES[id].artworkHosts];
    }
    expect(fromSql).toEqual(fromCode);
  });

  it('the table’s source check lists exactly the known sources', () => {
    const list = /constraint now_playing_source check \(source in \(([^)]*)\)\)/.exec(sql)?.[1] ?? '';
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...SOURCE_IDS]);
  });

  it('the length caps match', () => {
    expect(sql).toContain('between 1 and 150');
    expect(sql).toContain('char_length(artist) <= 150');
    expect(sql).toContain('char_length(album) <= 150');
    expect(sql).toContain('char_length(u) <= 500');
  });
});
