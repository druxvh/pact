import { describe, expect, it } from 'vitest';
import { contextForDb, count, isRef, parseContext, parseEngagement, parseMessageRow, timestamp } from './supabaseRows';

const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '22222222-2222-4222-8222-222222222222';
const NOTE = '44444444-4444-4444-8444-444444444444';
const TRACK = {
  title: 'Night Drive',
  artist: 'The Tests',
  album: 'Fixtures',
  artworkUrl: 'https://i.scdn.co/image/abc',
  trackUrl: null,
  source: 'spotify' as const,
};

describe('timestamps from the server', () => {
  it('keeps the server’s own string (microseconds matter for paging) and normalises the forms Postgres uses', () => {
    expect(timestamp('2026-11-20T10:00:00.123456+00:00')).toBe('2026-11-20T10:00:00.123456+00:00');
    expect(timestamp('2026-11-20T10:00:00Z')).toBe('2026-11-20T10:00:00Z');
    expect(timestamp('2026-11-20 10:00:00+00')).toBe('2026-11-20T10:00:00+00:00');
    expect(timestamp('2026-11-20 10:00:00.5+05:30')).toBe('2026-11-20T10:00:00.5+05:30');
  });
  it('refuses anything else, including things that would be unsafe to hand back to a query', () => {
    for (const bad of ['yesterday', '', '2026-13-45T99:99:99Z', "2026-11-20T10:00:00Z'; drop table x; --", 5, null, undefined, {}, '2026-11-20']) {
      expect(timestamp(bad)).toBeNull();
    }
  });
});

describe('counts', () => {
  it('are whole, non-negative and bounded', () => {
    expect(count(3)).toBe(3);
    expect(count(3.9)).toBe(3);
    expect(count(-2)).toBe(0);
    expect(count(Number.NaN)).toBe(0);
    expect(count(Number.POSITIVE_INFINITY)).toBe(0);
    expect(count('7')).toBe(0);
    expect(count(1e15)).toBe(1_000_000);
    expect(parseEngagement({ likes: 2, comments: 1, liked_by_me: true })).toEqual({ likes: 2, comments: 1, likedByMe: true });
    expect(parseEngagement(null)).toEqual({ likes: 0, comments: 0, likedByMe: false });
    expect(parseEngagement({ liked_by_me: 'true' }).likedByMe).toBe(false);
  });
});

describe('snapshots', () => {
  it('parse only the three allowed parts, cleaned', () => {
    expect(parseContext({ kind: 'note', text: ' hi\nthere ', track: TRACK, extra: '<b>x</b>' })).toEqual({ kind: 'note', text: 'hi there', track: TRACK });
    expect(parseContext({ kind: 'listening' })).toEqual({ kind: 'listening' });
    expect(parseContext({ kind: 'note', track: { ...TRACK, artworkUrl: 'https://evil.example/x.png' } })?.track?.artworkUrl).toBeNull();
    for (const bad of [null, 'x', 5, [], { kind: 'other' }, { text: 'no kind' }]) expect(parseContext(bad)).toBeNull();
  });
  it('are built for the database from the subject’s kind, with the same limits', () => {
    expect(contextForDb('listening', { kind: 'note', text: 'x'.repeat(100), track: TRACK })).toEqual({ kind: 'listening', text: 'x'.repeat(60), track: TRACK });
    expect(contextForDb('note', null)).toEqual({ kind: 'note' });
    expect(contextForDb('note', { kind: 'note', track: { ...TRACK, source: 'napster' as never } })).toEqual({ kind: 'note' });
  });
});

describe('refs and messages', () => {
  it('a ref must be something the database could hold', () => {
    expect(isRef({ ownerId: ALICE, kind: 'note', key: NOTE })).toBe(true);
    expect(isRef({ ownerId: ALICE, kind: 'listening', key: 'spotify|a|b' })).toBe(true);
    expect(isRef({ ownerId: ALICE, kind: 'note', key: 'spotify|a|b' })).toBe(false); // a note's key is its id
    expect(isRef({ ownerId: 'alex', kind: 'note', key: NOTE })).toBe(false);
    expect(isRef({ ownerId: ALICE, kind: 'listening', key: 'k'.repeat(201) })).toBe(false);
    expect(isRef({ ownerId: ALICE, kind: 'listening', key: '' })).toBe(false);
  });
  it('a message must be between two different accounts, one of them mine', () => {
    const row = { id: NOTE, sender_id: ALICE, recipient_id: ME, kind: 'reply', body: 'hi', created_at: '2026-11-20T10:00:00Z' };
    expect(parseMessageRow(row, ME)?.body).toBe('hi');
    expect(parseMessageRow({ ...row, recipient_id: ALICE }, ME)).toBeNull();
    expect(parseMessageRow({ ...row, sender_id: '33333333-3333-4333-8333-333333333333', recipient_id: ALICE }, ME)).toBeNull();
    expect(parseMessageRow({ ...row, sender_id: ME }, ME)).toBeNull(); // to myself
    expect(parseMessageRow({ ...row, kind: 'like', body: 'sneaky' }, ME)?.body).toBe('');
    expect(parseMessageRow({ ...row, read_at: 'soon' }, ME)?.readAt).toBeNull();
  });
});
