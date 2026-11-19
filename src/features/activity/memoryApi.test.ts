import { describe, expect, it } from 'vitest';
import type { Track } from '@/features/nowplaying/track';
import type { ActivityEvent } from './api';
import { MemoryActivityServer } from './memoryApi';
import { COMMENT_MAX, MESSAGE_MAX, NO_ENGAGEMENT, NOTE_MAX, NOTE_TTL_HOURS, refKey, type SubjectRef } from './types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const HOUR = 3_600_000;

const song = (over: Partial<Track> = {}): Track => ({
  title: 'Night Drive',
  artist: 'The Tests',
  album: '',
  artworkUrl: 'https://i.scdn.co/image/abc',
  trackUrl: 'https://open.spotify.com/track/abc',
  source: 'spotify',
  ...over,
});
const cp = (...codes: number[]) => String.fromCodePoint(...codes);

function setup() {
  const server = new MemoryActivityServer();
  let t = Date.parse('2026-11-19T10:00:00Z');
  server.now = () => t;
  return {
    server,
    a: server.api(A),
    b: server.api(B),
    c: server.api(C),
    advance: (ms: number) => {
      t += ms;
    },
  };
}
const noteRef = (ownerId: string, key: string): SubjectRef => ({ ownerId, kind: 'note', key });
const code = async (p: Promise<unknown>) => ((await p.then(() => null).catch((e) => e)) as { code?: string } | null)?.code ?? null;

describe('notes', () => {
  it('lives 24 hours: visible until then, gone at the end', async () => {
    const { a, b, advance } = setup();
    const n = await a.postNote({ text: 'hello', track: null });
    expect(Date.parse(n.expiresAt) - Date.parse(n.createdAt)).toBe(NOTE_TTL_HOURS * HOUR);
    expect(await a.getMyNote()).toMatchObject({ id: n.id });
    expect((await b.feed()).map((i) => i.kind === 'note' && i.note.id)).toEqual([n.id]);
    advance(24 * HOUR - 1000);
    expect(await a.getMyNote()).not.toBeNull();
    advance(2000);
    expect(await a.getMyNote()).toBeNull();
    expect(await b.feed()).toEqual([]);
  });

  it('posting again replaces it with a new note (new id, fresh 24 hours)', async () => {
    const { a, advance } = setup();
    const one = await a.postNote({ text: 'one', track: null });
    advance(5 * HOUR);
    const two = await a.postNote({ text: 'two', track: null });
    expect(two.id).not.toBe(one.id);
    expect(Date.parse(two.expiresAt) - Date.parse(two.createdAt)).toBe(24 * HOUR);
    expect((await a.getMyNote())?.text).toBe('two');
  });

  it('caps text at 60 characters, cleans it, and needs words or a song', async () => {
    const { a } = setup();
    expect(await code(a.postNote({ text: 'x'.repeat(NOTE_MAX + 1), track: null }))).toBe('invalid');
    expect((await a.postNote({ text: 'x'.repeat(NOTE_MAX), track: null })).text).toHaveLength(NOTE_MAX);
    expect(await code(a.postNote({ text: '   ', track: null }))).toBe('invalid');
    const withSong = await a.postNote({ text: '', track: song() });
    expect(withSong.text).toBe('');
    expect(withSong.track?.title).toBe('Night Drive');
    const messy = await a.postNote({ text: `hi${cp(0x202e)}\n\tthere  `, track: null });
    expect(messy.text).toBe('hi there');
  });

  it('re-checks the song: a hostile artwork address never gets stored', async () => {
    const { a } = setup();
    const n = await a.postNote({ text: 'x', track: song({ artworkUrl: 'https://attacker.example/p.gif', trackUrl: 'javascript:alert(1)' }) });
    expect(n.track?.artworkUrl).toBeNull();
    expect(n.track?.trackUrl).toBeNull();
  });

  it('needs the setting to be on: "off" refuses, and turning it off deletes the note', async () => {
    const { a, b, server } = setup();
    await a.setNotesVisibility('off');
    expect(await code(a.postNote({ text: 'x', track: null }))).toBe('not_allowed');
    await a.setNotesVisibility('communities');
    await a.postNote({ text: 'x', track: null });
    await a.setNotesVisibility('off');
    expect(await a.getMyNote()).toBeNull();
    expect(await b.feed()).toEqual([]);
    expect(server.notes.has(A)).toBe(false);
  });

  it('defaults to "my communities"', async () => {
    const { a } = setup();
    expect(await a.getNotesVisibility()).toBe('communities');
  });

  it('can be deleted', async () => {
    const { a } = setup();
    await a.postNote({ text: 'x', track: null });
    await a.deleteMyNote();
    expect(await a.getMyNote()).toBeNull();
  });

  it('rejects everything as "unavailable" when the migration is missing', async () => {
    const { a, server } = setup();
    server.available = false;
    expect(await code(a.getMyNote())).toBe('unavailable');
    expect(await code(a.feed())).toBe('unavailable');
    expect(await code(a.getNotesVisibility())).toBe('unavailable');
    expect(await code(a.postNote({ text: 'x', track: null }))).toBe('unavailable');
  });
});

describe('who sees what', () => {
  it('"communities" needs a shared community, "everyone" does not, "off" shows nobody', async () => {
    const { a, b, c, server } = setup();
    server.shares = (viewer, owner) => !(viewer === C || owner === C);
    await a.postNote({ text: 'mine', track: null });
    expect(await b.feed()).toHaveLength(1);
    expect(await c.feed()).toHaveLength(0); // no shared community
    await a.setNotesVisibility('everyone');
    await a.postNote({ text: 'mine', track: null });
    expect(await c.feed()).toHaveLength(1);
  });

  it('your own note is always in your feed', async () => {
    const { a, server } = setup();
    server.visibility.set(A, 'communities');
    server.shares = () => false;
    await a.postNote({ text: 'mine', track: null });
    expect(await a.feed()).toHaveLength(1);
  });
});

describe('the feed', () => {
  it('is newest first, pages with `before`, and honours the limit', async () => {
    const { server, b } = setup();
    for (let i = 0; i < 5; i++) {
      server.seedNote(`${i}${i}${i}${i}${i}${i}${i}${i}-0000-4000-8000-000000000000`, `n${i}`, null, (5 - i) * 60_000, 'everyone');
    }
    const first = await b.feed({ limit: 2 });
    expect(first.map((i) => i.kind === 'note' && i.note.text)).toEqual(['n4', 'n3']);
    const next = await b.feed({ limit: 2, before: first.at(-1)?.at });
    expect(next.map((i) => i.kind === 'note' && i.note.text)).toEqual(['n2', 'n1']);
    const last = await b.feed({ limit: 2, before: next.at(-1)?.at });
    expect(last.map((i) => i.kind === 'note' && i.note.text)).toEqual(['n0']);
  });
});

describe('hearts', () => {
  it('a like counts, shows as mine, and notifies the owner once with the snapshot', async () => {
    const { a, b, server } = setup();
    const n = await a.postNote({ text: 'my note', track: song() });
    const ref = noteRef(A, n.id);
    await b.like(ref, { kind: 'note', text: 'my note', track: song() });
    expect((await b.engagement([ref]))[refKey(ref)]).toEqual({ likes: 1, likedByMe: true, comments: 0 });
    expect((await a.engagement([ref]))[refKey(ref)]).toEqual({ likes: 1, likedByMe: false, comments: 0 });
    const inbox = await a.messages();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ senderId: B, recipientId: A, kind: 'like', body: '', readAt: null });
    expect(inbox[0]?.context).toMatchObject({ kind: 'note', text: 'my note', track: { title: 'Night Drive' } });
    expect(server.messages).toHaveLength(1);
  });

  it('liking twice is a no-op, and a re-like after an un-like does not notify again', async () => {
    const { a, b } = setup();
    const n = await a.postNote({ text: 'x', track: null });
    const ref = noteRef(A, n.id);
    await b.like(ref, { kind: 'note', text: 'x' });
    await b.like(ref, { kind: 'note', text: 'x' });
    expect((await b.engagement([ref]))[refKey(ref)]?.likes).toBe(1);
    await b.unlike(ref);
    expect((await b.engagement([ref]))[refKey(ref)]).toEqual({ likes: 0, likedByMe: false, comments: 0 });
    await b.like(ref, { kind: 'note', text: 'x' });
    expect((await b.engagement([ref]))[refKey(ref)]?.likes).toBe(1);
    expect(await a.messages()).toHaveLength(1);
  });

  it('you cannot like your own note or song', async () => {
    const { a } = setup();
    const n = await a.postNote({ text: 'x', track: null });
    expect(await code(a.like(noteRef(A, n.id), { kind: 'note' }))).toBe('not_allowed');
    expect(await code(a.like({ ownerId: A, kind: 'listening', key: 'k' }, { kind: 'listening', track: song() }))).toBe('not_allowed');
  });

  it('refuses a note that has expired, was replaced, or that you may not see', async () => {
    const { a, b, c, advance, server } = setup();
    server.shares = (viewer) => viewer !== C;
    const n = await a.postNote({ text: 'x', track: null });
    expect(await code(c.like(noteRef(A, n.id), { kind: 'note' }))).toBe('not_allowed'); // not shared with C
    const replaced = await a.postNote({ text: 'y', track: null });
    expect(await code(b.like(noteRef(A, n.id), { kind: 'note' }))).toBe('not_allowed'); // the old posting is gone
    advance(25 * HOUR);
    expect(await code(b.like(noteRef(A, replaced.id), { kind: 'note' }))).toBe('not_allowed'); // expired
    expect((await b.engagement([noteRef(A, replaced.id)]))[refKey(noteRef(A, replaced.id))]).toEqual(NO_ENGAGEMENT);
  });

  it('a heart on a live song works the same way (keyed by the song)', async () => {
    const { a, b } = setup();
    const ref: SubjectRef = { ownerId: A, kind: 'listening', key: 'spotify|night drive|the tests' };
    await b.like(ref, { kind: 'listening', track: song() });
    expect((await a.engagement([ref]))[refKey(ref)]?.likes).toBe(1);
    expect((await a.messages())[0]?.context).toMatchObject({ kind: 'listening', track: { title: 'Night Drive' } });
  });

  it('cleans the snapshot: hostile text and addresses never reach the owner', async () => {
    const { a, b } = setup();
    const n = await a.postNote({ text: 'x', track: null });
    await b.like(noteRef(A, n.id), {
      kind: 'note',
      text: `<b>hi</b>${cp(0x202e)} ${'y'.repeat(200)}`,
      track: song({ artworkUrl: 'https://attacker.example/p.gif' }),
    });
    const ctx = (await a.messages())[0]?.context;
    expect(ctx?.text?.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(ctx?.text).not.toContain(cp(0x202e));
    expect(ctx?.track?.artworkUrl).toBeNull();
  });
});

describe('comments', () => {
  it('are public under a note, newest first, notify the owner, and count', async () => {
    const { a, b, c } = setup();
    const n = await a.postNote({ text: 'x', track: null });
    const ref = noteRef(A, n.id);
    await b.addComment(ref, 'first', { kind: 'note', text: 'x' });
    await c.addComment(ref, 'second', { kind: 'note', text: 'x' });
    expect((await c.comments(ref)).map((x) => x.body)).toEqual(['second', 'first']);
    expect((await a.engagement([ref]))[refKey(ref)]?.comments).toBe(2);
    const inbox = (await a.messages()).filter((m) => m.kind === 'comment');
    expect(inbox.map((m) => m.body).sort()).toEqual(['first', 'second']);
    expect(inbox[0]?.context).toMatchObject({ kind: 'note', text: 'x' });
  });

  it('the owner commenting on their own note notifies nobody', async () => {
    const { a } = setup();
    const n = await a.postNote({ text: 'x', track: null });
    await a.addComment(noteRef(A, n.id), 'self', { kind: 'note' });
    expect(await a.messages()).toHaveLength(0);
  });

  it('are capped at 200 characters and cannot be empty', async () => {
    const { a, b } = setup();
    const n = await a.postNote({ text: 'x', track: null });
    const ref = noteRef(A, n.id);
    expect(await code(b.addComment(ref, 'c'.repeat(COMMENT_MAX + 1), { kind: 'note' }))).toBe('invalid');
    expect(await code(b.addComment(ref, '  ', { kind: 'note' }))).toBe('invalid');
    expect((await b.addComment(ref, 'c'.repeat(COMMENT_MAX), { kind: 'note' })).body).toHaveLength(COMMENT_MAX);
  });

  it('exist only under notes', async () => {
    const { b } = setup();
    const ref: SubjectRef = { ownerId: A, kind: 'listening', key: 'k' };
    expect(await code(b.addComment(ref, 'hi', { kind: 'listening' }))).toBe('invalid');
    expect(await code(b.comments(ref))).toBe('invalid');
  });

  it('pages with `before`', async () => {
    const { a, b, advance } = setup();
    const n = await a.postNote({ text: 'x', track: null });
    const ref = noteRef(A, n.id);
    for (let i = 0; i < 5; i++) {
      advance(1000);
      await b.addComment(ref, `c${i}`, { kind: 'note' });
    }
    const first = await b.comments(ref, { limit: 2 });
    expect(first.map((c) => c.body)).toEqual(['c4', 'c3']);
    expect((await b.comments(ref, { limit: 2, before: first.at(-1)?.createdAt })).map((c) => c.body)).toEqual(['c2', 'c1']);
  });

  it('you delete yours, the note’s owner deletes any, nobody else deletes', async () => {
    const { a, b, c } = setup();
    const n = await a.postNote({ text: 'x', track: null });
    const ref = noteRef(A, n.id);
    const mine = await b.addComment(ref, 'b', { kind: 'note' });
    const theirs = await c.addComment(ref, 'c', { kind: 'note' });
    expect(await code(b.deleteComment(theirs.id))).toBe('not_allowed');
    await b.deleteComment(mine.id);
    await a.deleteComment(theirs.id); // my note: I may remove anyone's
    expect(await a.comments(ref)).toEqual([]);
  });
});

describe('the small inbox', () => {
  it('a reply is capped at 500 characters, needs text, and not to yourself', async () => {
    const { a, b } = setup();
    await a.postNote({ text: 'x', track: null });
    expect(await code(b.sendReply(A, 'r'.repeat(MESSAGE_MAX + 1), null))).toBe('invalid');
    expect(await code(b.sendReply(A, ' ', null))).toBe('invalid');
    expect(await code(b.sendReply(B, 'hi', null))).toBe('invalid');
    expect((await b.sendReply(A, 'r'.repeat(MESSAGE_MAX), null)).body).toHaveLength(MESSAGE_MAX);
  });

  it('is allowed to people whose notes you can see, or who already wrote to you — not to strangers', async () => {
    const { a, b, c, server } = setup();
    server.shares = (viewer, owner) => !((viewer === C && owner === A) || (viewer === A && owner === C));
    expect(await code(c.sendReply(A, 'hi', null))).toBe('not_allowed'); // no shared community
    await a.sendReply(B, 'hello', null); // A may write to B
    expect((await b.sendReply(A, 'thanks', null)).kind).toBe('reply');
    server.visibility.set(A, 'off');
    server.visibility.set(C, 'off');
    await code(a.sendReply(C, 'hi', null));
    expect(await code(c.sendReply(A, 'hello?', null))).toBe('not_allowed');
  });

  it('lists the thread both ways, newest first, `with` one person', async () => {
    const { a, b, c } = setup();
    await a.sendReply(B, 'one', null);
    await b.sendReply(A, 'two', null);
    await c.sendReply(A, 'other', null);
    expect((await a.messages({ with: B })).map((m) => m.body)).toEqual(['two', 'one']);
    expect(await a.messages()).toHaveLength(3);
    expect((await b.messages()).map((m) => m.body)).toEqual(['two', 'one']);
    expect((await a.messages({ limit: 1 })).map((m) => m.body)).toEqual(['other']);
  });

  it('marking read only touches what is addressed to you', async () => {
    const { a, b } = setup();
    await a.sendReply(B, 'to b', null);
    await b.sendReply(A, 'to a', null);
    await b.markRead({ with: A }); // I only read what A wrote to me
    const bView = await b.messages();
    expect(bView.find((m) => m.body === 'to b')?.readAt).not.toBeNull();
    expect(bView.find((m) => m.body === 'to a')?.readAt).toBeNull(); // I wrote it, "read" isn't mine to set
    await a.markRead({ ids: bView.map((m) => m.id) });
    expect((await a.messages()).find((m) => m.body === 'to a')?.readAt).not.toBeNull();
    // asking to mark something addressed to someone else changes nothing
    const later = await a.sendReply(B, 'to b again', null);
    await a.markRead({ ids: [later.id] });
    await a.markRead({ with: B });
    expect((await b.messages()).find((m) => m.id === later.id)?.readAt).toBeNull();
  });
});

describe('live events', () => {
  it('a message reaches only its recipient; a note change reaches those who may see it; a like reaches those who can see the note', async () => {
    const { a, b, c, server } = setup();
    const got: Record<string, ActivityEvent[]> = { a: [], b: [], c: [] };
    a.subscribe((e) => got.a?.push(e));
    b.subscribe((e) => got.b?.push(e));
    const offC = c.subscribe((e) => got.c?.push(e));
    server.shares = (viewer) => viewer !== C;
    const n = await a.postNote({ text: 'x', track: null });
    expect(got.b?.map((e) => e.type)).toEqual(['note']);
    expect(got.c).toEqual([]); // C can't see A's notes
    await b.like(noteRef(A, n.id), { kind: 'note', text: 'x' });
    expect(got.a?.map((e) => e.type)).toContain('message');
    expect(got.b?.map((e) => e.type)).not.toContain('message');
    offC();
    await a.deleteMyNote();
    expect(got.c).toEqual([]); // and it never heard about the like either: it can't see the note
  });
});
