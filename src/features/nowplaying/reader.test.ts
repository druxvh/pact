import { afterEach, describe, expect, it } from 'vitest';
import { pickArtwork, readSnapshot, trackLink } from './reader';

afterEach(() => {
  document.body.innerHTML = '';
});

const BASE = 'https://open.spotify.com/album/1';

describe('pickArtwork', () => {
  it('takes the largest cover up to 640x640', () => {
    const list = [
      { src: 'https://i.scdn.co/image/64', sizes: '64x64' },
      { src: 'https://i.scdn.co/image/300', sizes: '300x300' },
      { src: 'https://i.scdn.co/image/640', sizes: '640x640' },
      { src: 'https://i.scdn.co/image/3000', sizes: '3000x3000' },
    ];
    expect(pickArtwork(list, BASE)).toBe('https://i.scdn.co/image/640');
  });
  it('when every cover is bigger than that, the smallest of them', () => {
    expect(
      pickArtwork(
        [
          { src: 'https://i.scdn.co/a', sizes: '3000x3000' },
          { src: 'https://i.scdn.co/b', sizes: '1200x1200' },
        ],
        BASE,
      ),
    ).toBe('https://i.scdn.co/b');
  });
  it('with no sizes given, the last one listed; none at all is empty', () => {
    expect(pickArtwork([{ src: 'https://i.scdn.co/a' }, { src: 'https://i.scdn.co/b' }], BASE)).toBe('https://i.scdn.co/b');
    expect(pickArtwork([], BASE)).toBe('');
    expect(pickArtwork(null, BASE)).toBe('');
    expect(pickArtwork([{ src: '' }, { src: 5 }], BASE)).toBe('');
  });
  it('resolves a relative address against the page (it is allow-listed later, so a wrong host is dropped there)', () => {
    expect(pickArtwork([{ src: '/img/a.jpg', sizes: '300x300' }], BASE)).toBe('https://open.spotify.com/img/a.jpg');
  });
});

describe('trackLink', () => {
  it('spotify: the track link in the player bar', () => {
    document.body.innerHTML = '<div data-testid="now-playing-widget"><a href="/track/abc123">Song</a></div>';
    expect(trackLink('spotify', document, BASE)).toBe('https://open.spotify.com/track/abc123');
  });
  it('soundcloud: the title link in the playback bar', () => {
    document.body.innerHTML = '<a class="playbackSoundBadge__titleLink" href="/artist/song">Song</a>';
    expect(trackLink('soundcloud', document, 'https://soundcloud.com/')).toBe('https://soundcloud.com/artist/song');
  });
  it('youtube music: the song’s own address on the player page, rebuilt from its id only — not on any other page', () => {
    expect(trackLink('youtube-music', document, 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM&si=x')).toBe(
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(trackLink('youtube-music', document, 'https://music.youtube.com/search?q=x')).toBe('');
    expect(trackLink('youtube-music', document, 'https://music.youtube.com/watch?v=<script>')).toBe('');
  });
  it('a player we know no selector for has no link', () => {
    expect(trackLink('tidal', document, 'https://tidal.com/browse')).toBe('');
    expect(trackLink('spotify', document, BASE)).toBe('');
  });
});

describe('readSnapshot', () => {
  const meta = { title: 'Night Drive', artist: 'The Tests', album: 'Fixtures', artwork: [{ src: 'https://i.scdn.co/image/300', sizes: '300x300' }] };
  const read = (mediaSession: Parameters<typeof readSnapshot>[0]['mediaSession']) =>
    readSnapshot({ mediaSession, doc: document, href: BASE, source: 'spotify' });

  it('reads title, artist, album and cover from the Media Session, and trusts "playing" / "paused"', () => {
    expect(read({ metadata: meta, playbackState: 'playing' })).toMatchObject({
      playing: true,
      title: 'Night Drive',
      artist: 'The Tests',
      album: 'Fixtures',
      artwork: 'https://i.scdn.co/image/300',
    });
    expect(read({ metadata: meta, playbackState: 'paused' }).playing).toBe(false);
  });
  it('with no playback state, it looks at the media elements', () => {
    expect(read({ metadata: meta, playbackState: 'none' }).playing).toBe(false);
    const audio = document.createElement('audio');
    Object.defineProperties(audio, { paused: { value: false }, ended: { value: false }, readyState: { value: 4 } });
    document.body.append(audio);
    expect(read({ metadata: meta, playbackState: 'none' }).playing).toBe(true);
    expect(read({ metadata: meta }).playing).toBe(true);
  });
  it('no metadata means no track (an empty title), whatever else is going on', () => {
    expect(read({ metadata: null, playbackState: 'playing' })).toEqual({ playing: true, title: '', artist: '', album: '', artwork: '', link: '' });
    expect(readSnapshot({ mediaSession: undefined, doc: document, href: BASE, source: 'spotify' }).title).toBe('');
  });
  it('non-string fields from a strange page are empty strings, not exceptions', () => {
    const s = read({ metadata: { title: 5, artist: null, album: {}, artwork: [{ src: 7 }] } as never, playbackState: 'playing' });
    expect(s).toMatchObject({ title: '', artist: '', album: '', artwork: '' });
  });
  it('reads nothing but the Media Session, the media elements and the one link — no page address or title in the result', () => {
    document.title = 'Secret banking page';
    expect(JSON.stringify(read({ metadata: meta, playbackState: 'playing' }))).not.toContain('Secret');
    expect(Object.keys(read({ metadata: meta, playbackState: 'playing' })).sort()).toEqual(['album', 'artist', 'artwork', 'link', 'playing', 'title']);
  });
});
