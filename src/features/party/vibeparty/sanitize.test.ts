import { describe, expect, it } from 'vitest';
import { LIMITS, parseYouTubeId, watchUrlFor } from './protocol';
import {
  cleanEmoji,
  cleanName,
  cleanRoom,
  cleanText,
  parseAppMessage,
  parseClientMessage,
  parseContentMessage,
  parseRelayUrl,
  parseServerMessage,
} from './sanitize';

// Invisible characters are built from code points so this source never contains them literally.
const NUL = String.fromCodePoint(0x00);
const ZWSP = String.fromCodePoint(0x200b);
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const ZWJ = String.fromCodePoint(0x200d);

const VID = 'dQw4w9WgXcQ';

describe('text cleaning', () => {
  it('strips control, zero-width and bidi-override characters and collapses whitespace', () => {
    expect(cleanText(`  hi${NUL} there${ZWSP}${RLO}  you\n\n ok `, 100)).toBe('hi there you ok');
    expect(cleanName(`${RLO}evilcorp`)).toBe('evilcorp'); // a bidi override can make a name lie about itself
  });

  it('truncates by code point so an emoji is never cut in half', () => {
    const out = cleanText(`${'a'.repeat(23)}🔥🔥🔥`, LIMITS.name);
    expect(Array.from(out)).toHaveLength(LIMITS.name);
    expect(out.endsWith('🔥')).toBe(true);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/); // no lone high surrogate
  });

  it('falls back to "guest" and ignores non-strings', () => {
    expect(cleanName('   ')).toBe('guest');
    expect(cleanName(42)).toBe('guest');
    expect(cleanText({}, 10)).toBe('');
  });
});

describe('room codes & emoji', () => {
  it('normalises codes and rejects junk', () => {
    expect(cleanRoom('  Amber Lofi K7Q2X9DM ')).toBe('amber-lofi-k7q2x9dm');
    expect(cleanRoom('ab')).toBeNull();
    expect(cleanRoom('<script>')).toBe('script'); // brackets stripped, still a valid (harmless) slug
    expect(cleanRoom(null)).toBeNull();
  });

  it('accepts real emoji (incl. skin tones, ZWJ sequences, variation selectors) and nothing else', () => {
    for (const ok of ['🔥', '❤️', '👍🏽', `👨${ZWJ}👩${ZWJ}👧`, '🫡']) expect(cleanEmoji(ok)).toBe(ok);
    for (const bad of ['', 'a', '<b>', '🔥a', '🔥'.repeat(10), 5, null]) expect(cleanEmoji(bad)).toBeNull();
  });
});

describe('YouTube ids', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${VID}`, VID],
    [`https://www.youtube.com/watch?v=${VID}&t=42s&list=PL123`, VID],
    [`https://youtu.be/${VID}?si=abc`, VID],
    [`https://m.youtube.com/watch?v=${VID}`, VID],
    [`https://music.youtube.com/watch?v=${VID}`, VID],
    [`https://www.youtube.com/shorts/${VID}`, VID],
    [`https://www.youtube.com/embed/${VID}`, VID],
    [`https://www.youtube.com/live/${VID}?feature=share`, VID],
    [VID, VID],
  ])('parses %s', (input, expected) => {
    expect(parseYouTubeId(input)).toBe(expected);
  });

  it.each([
    'https://evil.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQx', // 12 characters
    'not a url',
    '',
  ])('rejects %s', (input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });
});

describe('content-script messages', () => {
  it('accepts well-formed messages and cleans their fields', () => {
    expect(parseContentMessage({ type: 'vibeparty:join', room: 'Friday Vibes', name: '  Sam ' })).toEqual({
      type: 'vibeparty:join',
      room: 'friday-vibes',
      name: 'Sam',
    });
    expect(parseContentMessage({ type: 'vibeparty:media', ev: 'seek', mediaTime: 12.5, playing: true, videoId: VID })).toEqual({
      type: 'vibeparty:media',
      ev: 'seek',
      mediaTime: 12.5,
      playing: true,
      videoId: VID,
    });
    expect(parseContentMessage({ type: 'vibeparty:chat', text: '  hello\u0000  world ' })).toEqual({ type: 'vibeparty:chat', text: 'hello world' });
  });

  it('canonicalises queue URLs and refuses anything that is not a YouTube video', () => {
    const ok = parseContentMessage({ type: 'vibeparty:queue:add', url: `https://youtu.be/${VID}?si=tracking`, title: ' Song ' });
    expect(ok).toEqual({ type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'Song' });
    for (const url of ['javascript:alert(1)', 'https://evil.com/x', 'data:text/html,hi', 42]) {
      expect(parseContentMessage({ type: 'vibeparty:queue:add', url, title: 'x' })).toBeNull();
    }
  });

  it('rejects malformed, hostile or unknown messages without throwing', () => {
    const bad: unknown[] = [
      null,
      'string',
      [],
      {},
      { type: 5 },
      { type: 'vibeparty:nope' },
      { type: 'vibeparty:join', room: '!!', name: 'x' },
      { type: 'vibeparty:media', ev: 'state', mediaTime: 1, playing: true, videoId: null }, // the dead heartbeat event
      { type: 'vibeparty:media', ev: 'play', mediaTime: Number.NaN, playing: true, videoId: null },
      { type: 'vibeparty:media', ev: 'play', mediaTime: -1, playing: true, videoId: null },
      { type: 'vibeparty:media', ev: 'play', mediaTime: 1e12, playing: true, videoId: null },
      { type: 'vibeparty:chat', text: '   ' },
      { type: 'vibeparty:reaction', emoji: '<img src=x onerror=1>', messageId: null },
      { type: 'vibeparty:queue:vote', id: '../../etc' },
    ];
    for (const m of bad) expect(parseContentMessage(m)).toBeNull();
  });

  it('drops an invalid videoId rather than forwarding it', () => {
    const m = parseContentMessage({ type: 'vibeparty:media', ev: 'play', mediaTime: 1, playing: true, videoId: 'x'.repeat(40) });
    expect(m).toMatchObject({ videoId: null });
  });

  it('parses app messages', () => {
    expect(parseAppMessage({ type: 'vibeparty:app-status' })).toEqual({ type: 'vibeparty:app-status' });
    expect(parseAppMessage({ type: 'vibeparty:open', room: 'amber-lofi-k7q2x9dm', name: 'A' })).toMatchObject({ room: 'amber-lofi-k7q2x9dm' });
    expect(parseAppMessage({ type: 'vibeparty:open', room: '', name: 'A' })).toBeNull();
    expect(parseAppMessage({ type: 'vibeparty:join', room: 'abcd' })).toBeNull();
  });
});

describe('relay messages (untrusted)', () => {
  const peer = { id: 'peer-1', name: 'Alex' };

  it('rebuilds queue URLs from the video id and drops invalid items', () => {
    const msg = parseServerMessage({
      t: 'queue',
      room: 'friday-vibes',
      items: [
        { id: 'q1', videoId: VID, url: 'https://evil.example/phish', title: 'Good', addedBy: 'p', addedByName: 'A', voters: ['p', 'p', 'q'], createdAt: 5 },
        { id: 'q2', videoId: 'bad', url: 'x', title: 't', addedBy: 'p', addedByName: 'A', voters: [], createdAt: 5 },
        { id: 'q1', videoId: VID, title: 'dup id', addedBy: 'p', createdAt: 6 },
        'garbage',
      ],
    });
    expect(msg).toEqual({
      t: 'queue',
      room: 'friday-vibes',
      items: [{ id: 'q1', videoId: VID, url: watchUrlFor(VID), title: 'Good', addedBy: 'p', addedByName: 'A', voters: ['p', 'q'], createdAt: 5 }],
    });
  });

  it('cleans chat text and rejects empty/invalid messages', () => {
    const ok = parseServerMessage({ t: 'chat', room: 'friday-vibes', message: { id: 'm1', peerId: 'p', name: `${RLO}Bob`, text: 'hi\u0000!', at: 1 } });
    expect(ok).toEqual({ t: 'chat', room: 'friday-vibes', message: { id: 'm1', peerId: 'p', name: 'Bob', text: 'hi !', at: 1 } });
    expect(parseServerMessage({ t: 'chat', room: 'friday-vibes', message: { id: 'm1', peerId: 'p', text: '', at: 1 } })).toBeNull();
    expect(parseServerMessage({ t: 'chat', room: 'nope!', message: {} })).toBeNull();
  });

  it('validates state, presence caps and media snapshots', () => {
    const state = parseServerMessage({
      t: 'state',
      room: 'friday-vibes',
      peers: [peer, peer, { id: 'bad id!', name: 'x' }, ...Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, name: `n${i}` }))],
      queue: [],
      chat: [],
      media: { playing: true, mediaTime: 12, videoId: VID, controllerPeerId: 'peer-1', reason: 'advance' },
    });
    expect(state?.t).toBe('state');
    if (state?.t === 'state') {
      expect(state.peers.length).toBe(LIMITS.peersPerRoom);
      expect(new Set(state.peers.map((p) => p.id)).size).toBe(state.peers.length); // de-duplicated
      expect(state.media).toEqual({ playing: true, mediaTime: 12, videoId: VID, controllerPeerId: 'peer-1', reason: 'advance' });
    }
    expect(parseServerMessage({ t: 'media', room: 'friday-vibes', from: null, media: { playing: 'yes', mediaTime: 1 } })).toBeNull();
    expect(parseServerMessage({ t: 'media', room: 'friday-vibes', from: null, media: { playing: true, mediaTime: Number.POSITIVE_INFINITY } })).toBeNull();
  });

  it('handles pong/error and unknown types', () => {
    expect(parseServerMessage({ t: 'pong', ts: 123 })).toEqual({ t: 'pong', ts: 123 });
    expect(parseServerMessage({ t: 'pong' })).toBeNull();
    expect(parseServerMessage({ t: 'error', code: 'room_full', message: 'Full' })).toEqual({ t: 'error', code: 'room_full', message: 'Full' });
    expect(parseServerMessage({ t: 'hax' })).toBeNull();
    expect(parseServerMessage('{"t":"pong"}')).toBeNull();
  });

  it('client messages (as seen by the relay) are validated too', () => {
    expect(parseClientMessage({ t: 'ping', ts: 5 })).toEqual({ t: 'ping', ts: 5 });
    expect(parseClientMessage({ t: 'join', room: 'friday-vibes', peerId: 'abc-123', name: 'Z' })).toMatchObject({ t: 'join' });
    expect(parseClientMessage({ t: 'join', room: 'friday-vibes', peerId: 'has space', name: 'Z' })).toBeNull();
    expect(parseClientMessage({ t: 'queue:add', room: 'friday-vibes', peerId: 'p', id: 'i', url: 'javascript:1', title: 't' })).toBeNull();
    expect(parseClientMessage({ t: 'chat', room: 'friday-vibes', peerId: 'p', id: 'i', text: 'hey', at: 1 })).toMatchObject({ t: 'chat', text: 'hey' });
  });
});

describe('relay URL', () => {
  it('requires TLS except for a relay on this machine', () => {
    expect(parseRelayUrl('wss://relay.example.com/party')).toBe('wss://relay.example.com/party');
    expect(parseRelayUrl('ws://localhost:8787')).toBe('ws://localhost:8787/');
    expect(parseRelayUrl('ws://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/');
    for (const bad of ['ws://relay.example.com', 'http://localhost:8787', 'https://relay.example.com', 'relay.example.com', '', undefined, 42]) {
      expect(parseRelayUrl(bad)).toBeNull();
    }
  });
});
