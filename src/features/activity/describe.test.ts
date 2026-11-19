import { describe, expect, it } from 'vitest';
import type { Track } from '@/features/nowplaying/track';
import {
  buildThreads,
  contextLine,
  contextOfNote,
  contextOfSong,
  counterpart,
  explainError,
  heartFailure,
  isUnreadForMe,
  noticeFor,
  previewOf,
  refOfListening,
  refOfNote,
  snippet,
  songLine,
  threadFromSub,
  threadLink,
  timeLeft,
  unreadTotal,
} from './describe';
import { ActivityError, type ActivityMessage, trackKey } from './types';

const ME = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const song: Track = { title: 'Night Drive', artist: 'The Tests', album: '', artworkUrl: 'https://i.scdn.co/image/abc', trackUrl: null, source: 'spotify' };

const msg = (over: Partial<ActivityMessage> & Pick<ActivityMessage, 'senderId' | 'recipientId' | 'kind'>, n = 0): ActivityMessage => ({
  id: `m${n}`,
  body: '',
  context: null,
  createdAt: new Date(Date.UTC(2026, 10, 19, 10, 0, n)).toISOString(),
  readAt: null,
  ...over,
});

describe('what a like or comment carries', () => {
  it('a note’s snapshot is its text and song, cleaned', () => {
    const ctx = contextOfNote({ text: `hi${cp(0x202e)}  there`, track: song });
    expect(ctx).toEqual({ kind: 'note', text: 'hi there', track: song });
  });
  it('a song-only note has no text key; a bad track is dropped', () => {
    expect(contextOfNote({ text: '', track: song })).toEqual({ kind: 'note', track: song });
    expect(contextOfNote({ text: 'x', track: { ...song, source: 'napster' } as unknown as Track })).toEqual({ kind: 'note', text: 'x' });
  });
  it('a live song’s snapshot is the song', () => {
    expect(contextOfSong(song)).toEqual({ kind: 'listening', track: song });
  });
  it('subjects: a note by its id, a live song by its key', () => {
    expect(refOfNote({ id: 'n1', ownerId: A })).toEqual({ ownerId: A, kind: 'note', key: 'n1' });
    expect(refOfListening(A, song)).toEqual({ ownerId: A, kind: 'listening', key: trackKey(song) });
  });
});

describe('text helpers', () => {
  it('snippet cuts with an ellipsis and never splits an emoji', () => {
    expect(snippet('short', 10)).toBe('short');
    expect(snippet('abcdefghij', 5)).toBe('abcd…');
    expect(snippet('😀😀😀😀', 3)).toBe('😀😀…');
    expect(snippet(`a${cp(0x202e)}b\n\nc`, 10)).toBe('a b c');
  });
  it('timeLeft counts down in words', () => {
    const now = Date.parse('2026-11-19T10:00:00Z');
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(timeLeft(at(23 * 3_600_000 + 5 * 60_000), now)).toBe('23h left');
    expect(timeLeft(at(2 * 3_600_000 + 30 * 60_000), now)).toBe('2h 30m left');
    expect(timeLeft(at(45 * 60_000), now)).toBe('45m left');
    expect(timeLeft(at(20_000), now)).toBe('Less than a minute left');
    expect(timeLeft(at(0), now)).toBe('Expired');
    expect(timeLeft('nope', now)).toBe('Expired');
  });
  it('songLine and contextLine', () => {
    expect(songLine(song)).toBe('Night Drive · The Tests');
    expect(songLine({ title: 'Solo', artist: '' })).toBe('Solo');
    expect(contextLine({ kind: 'note', text: 'words', track: song })).toBe('words');
    expect(contextLine({ kind: 'note', track: song })).toBe('Night Drive · The Tests');
    expect(contextLine(null)).toBe('');
  });
});

describe('how a message reads in the bell', () => {
  it('a heart on a note, a heart on a song', () => {
    expect(noticeFor({ kind: 'like', body: '', context: { kind: 'note', text: 'my note' } }, 'Maya')).toEqual({
      title: 'Maya liked your note',
      body: '“my note”',
    });
    expect(noticeFor({ kind: 'like', body: '', context: { kind: 'listening', track: song } }, 'Maya')).toEqual({
      title: 'Maya liked your song',
      body: '“Night Drive · The Tests”',
    });
  });
  it('a comment and a reply say what was written', () => {
    expect(noticeFor({ kind: 'comment', body: 'great one', context: { kind: 'note', text: 'my note' } }, 'Maya')).toEqual({
      title: 'Maya commented: great one',
      body: 'On your note “my note”',
    });
    expect(noticeFor({ kind: 'reply', body: 'see you', context: null }, 'Maya')).toEqual({ title: 'Maya replied: see you', body: 'A private message' });
  });
  it('long text is cut, and hostile names are only ever text', () => {
    const n = noticeFor({ kind: 'comment', body: 'x'.repeat(300), context: null }, '<b>Eve</b>'.repeat(10));
    expect(n.title.length).toBeLessThan(140);
    expect(n.title).toContain('<b>Eve</b>');
    expect(noticeFor({ kind: 'like', body: '', context: null }, '')).toEqual({ title: 'Someone liked your note', body: '' });
  });
});

describe('threads and unread counts', () => {
  const messages = [
    msg({ senderId: A, recipientId: ME, kind: 'like', context: { kind: 'note', text: 'n' } }, 1),
    msg({ senderId: A, recipientId: ME, kind: 'reply', body: 'hey' }, 2),
    msg({ senderId: ME, recipientId: A, kind: 'reply', body: 'hi back' }, 3),
    msg({ senderId: B, recipientId: ME, kind: 'comment', body: 'nice', readAt: '2026-11-19T11:00:00Z' }, 4),
    msg({ senderId: B, recipientId: ME, kind: 'like', context: { kind: 'listening', track: song } }, 5),
  ];
  it('the other person, and what counts as unread', () => {
    expect(counterpart(messages[0] as ActivityMessage, ME)).toBe(A);
    expect(counterpart(messages[2] as ActivityMessage, ME)).toBe(A);
    expect(isUnreadForMe(messages[0] as ActivityMessage, ME)).toBe(true);
    expect(isUnreadForMe(messages[2] as ActivityMessage, ME)).toBe(false); // mine
    expect(isUnreadForMe(messages[3] as ActivityMessage, ME)).toBe(false); // read
  });
  it('one thread per person, most recent first, with unread counts', () => {
    const t = buildThreads(messages, ME);
    expect(t.map((x) => [x.personId, x.unread, x.last.id])).toEqual([
      [B, 1, 'm5'],
      [A, 2, 'm3'],
    ]);
    expect(unreadTotal(messages, ME)).toBe(3);
    expect(buildThreads([], ME)).toEqual([]);
  });
  it('previews read naturally', () => {
    expect(previewOf(messages[0] as ActivityMessage, ME)).toBe('❤ liked your note');
    expect(previewOf(messages[4] as ActivityMessage, ME)).toBe('❤ liked your song');
    expect(previewOf(messages[2] as ActivityMessage, ME)).toBe('You: hi back');
    expect(previewOf(messages[1] as ActivityMessage, ME)).toBe('hey');
    expect(previewOf(msg({ senderId: ME, recipientId: A, kind: 'like', context: { kind: 'listening' } }), ME)).toBe('You liked their song');
  });
  it('the link to a thread round-trips, and other subs are not threads', () => {
    expect(threadFromSub(threadLink(A))).toBe(A);
    expect(threadFromSub('c:abc:def')).toBeNull();
    expect(threadFromSub(null)).toBeNull();
    expect(threadFromSub('a:')).toBeNull();
  });
});

describe('errors in words', () => {
  it('every code has a sentence, and nothing leaks the raw message', () => {
    for (const code of ['unavailable', 'not_signed_in', 'not_allowed', 'rate_limited', 'invalid', 'network'] as const) {
      const text = explainError(new ActivityError(code, 'select * from secrets'));
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain('secrets');
    }
    expect(explainError(new Error('boom'))).toBe('Something went wrong. Try again.');
    expect(explainError(null)).toBe('Something went wrong. Try again.');
  });
});

describe('a heart that did not go through', () => {
  it('on a live song, "not allowed" means the song just changed', () => {
    expect(heartFailure(new ActivityError('not_allowed'), 'listening').title).toBe('That song just changed');
  });
  it('anything else is the usual explanation', () => {
    expect(heartFailure(new ActivityError('not_allowed'), 'note').title).toBe('Couldn’t update your heart');
    expect(heartFailure(new ActivityError('rate_limited'), 'listening').description).toContain('a lot');
    expect(heartFailure(new ActivityError('network'), 'note').description).toContain('connection');
  });
});
