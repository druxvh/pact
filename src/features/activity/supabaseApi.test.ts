import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_ENGAGEMENT, refKey, type SubjectRef } from './types';

/**
 * The Supabase data layer for Activity, against a fake client: what it asks the database for, how it cleans what comes back
 * (rows are hostile input — a stranger typed them), how refusals become `ActivityError` codes, what happens when the migration
 * isn't applied, and the Realtime subscription's lifecycle. The rules themselves are tested against a real database in
 * supabase/tests/activity.mjs.
 */

type Result = { data: unknown; error: unknown };
type Op = [string, unknown[]];
type Call = { table?: string; fn?: string; args?: unknown; ops: Op[] };

const calls: Call[] = [];
let respond: (call: Call) => Result = () => ({ data: null, error: null });

/** A query builder that records every chained call and answers when awaited. */
const builder = (call: Call): object => {
  const b: object = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === 'then') return (res: (v: Result) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(res, rej);
        return (...args: unknown[]) => {
          call.ops.push([prop, args]);
          return b;
        };
      },
    },
  );
  return b;
};

type Handler = { type: string; filter: { event: string; schema: string; table: string; filter?: string }; cb: (payload: unknown) => void };
type FakeChannel = {
  name: string;
  handlers: Handler[];
  subscribed: boolean;
  on: (type: string, filter: Handler['filter'], cb: Handler['cb']) => FakeChannel;
  subscribe: () => FakeChannel;
};
const channels: FakeChannel[] = [];
const removed: FakeChannel[] = [];

const fake = {
  from: (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    return builder(call);
  },
  rpc: (fn: string, args: unknown) => {
    const call: Call = { fn, args, ops: [] };
    calls.push(call);
    return builder(call);
  },
  channel: (name: string) => {
    const ch: FakeChannel = {
      name,
      handlers: [],
      subscribed: false,
      on(type, filter, cb) {
        ch.handlers.push({ type, filter, cb });
        return ch;
      },
      subscribe() {
        ch.subscribed = true;
        return ch;
      },
    };
    channels.push(ch);
    return ch;
  },
  removeChannel: async (ch: FakeChannel) => {
    removed.push(ch);
    return 'ok';
  },
};
vi.mock('@/lib/supabase/client', () => ({ supabase: fake }));

const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '22222222-2222-4222-8222-222222222222';
const BOB = '33333333-3333-4333-8333-333333333333';
const NOTE = '44444444-4444-4444-8444-444444444444';
const NOTE2 = '55555555-5555-4555-8555-555555555555';
const MSG = '66666666-6666-4666-8666-666666666666';
const CMT = '77777777-7777-4777-8777-777777777777';

const ok = (data: unknown): Result => ({ data, error: null });
const err = (code: string, message: string, extra: Record<string, unknown> = {}): Result => ({ data: null, error: { code, message, ...extra } });

const load = async (me = ME) => {
  vi.resetModules();
  const { createSupabaseActivityApi } = await import('./supabaseApi');
  return createSupabaseActivityApi(me);
};

const opsOf = (call: Call | undefined) => Object.fromEntries((call?.ops ?? []).map(([name, args]) => [name, args]));
const last = () => calls[calls.length - 1];
const opArg = <T>(call: Call | undefined, op: string, index = 0): T => (opsOf(call)[op] ?? [])[index] as T;
const argsOf = <T>(call: Call | undefined): T => (call?.args ?? {}) as T;

const TRACK_ROW = {
  track_title: 'Night Drive',
  track_artist: 'The Tests',
  track_album: 'Fixtures',
  track_artwork_url: 'https://i.scdn.co/image/abc',
  track_url: 'https://open.spotify.com/track/abc',
  track_source: 'spotify',
};
const noteRow = (over: Record<string, unknown> = {}) => ({
  id: NOTE,
  user_id: ALICE,
  body: 'Studying for finals',
  track_title: null,
  track_artist: null,
  track_album: null,
  track_artwork_url: null,
  track_url: null,
  track_source: null,
  created_at: '2026-11-20T10:00:00.123456+00:00',
  expires_at: '2026-11-21T10:00:00.123456+00:00',
  ...over,
});
const messageRow = (over: Record<string, unknown> = {}) => ({
  id: MSG,
  sender_id: ALICE,
  recipient_id: ME,
  kind: 'reply',
  body: 'hello',
  context: null,
  created_at: '2026-11-20T10:00:00+00:00',
  read_at: null,
  ...over,
});
const commentRow = (over: Record<string, unknown> = {}) => ({
  id: CMT,
  owner_id: ALICE,
  subject_key: NOTE,
  author_id: BOB,
  body: 'nice',
  created_at: '2026-11-20T10:05:00+00:00',
  ...over,
});
const noteRef: SubjectRef = { ownerId: ALICE, kind: 'note', key: NOTE };
const songRef: SubjectRef = { ownerId: ALICE, kind: 'listening', key: 'spotify|night drive|the tests' };
const TRACK = {
  title: 'Night Drive',
  artist: 'The Tests',
  album: 'Fixtures',
  artworkUrl: 'https://i.scdn.co/image/abc',
  trackUrl: null,
  source: 'spotify' as const,
};

const BIDI = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);

beforeEach(() => {
  calls.length = 0;
  channels.length = 0;
  removed.length = 0;
  respond = () => ok(null);
});

describe('my note', () => {
  it('reads my one row and cleans it', async () => {
    respond = () => ok(noteRow({ body: `  hi${BIDI}there\n  friend  `, ...TRACK_ROW }));
    const api = await load();
    const n = await api.getMyNote();
    expect(calls[0]?.table).toBe('status_notes');
    expect(opsOf(calls[0]).eq).toEqual(['user_id', ME]);
    expect(n?.text).toBe('hi there friend');
    expect(n?.track).toEqual({
      title: 'Night Drive',
      artist: 'The Tests',
      album: 'Fixtures',
      artworkUrl: 'https://i.scdn.co/image/abc',
      trackUrl: 'https://open.spotify.com/track/abc',
      source: 'spotify',
    });
    expect(n?.createdAt).toBe('2026-11-20T10:00:00.123456+00:00'); // the server's own string, microseconds intact
    expect(n?.expiresAt).toBe('2026-11-21T10:00:00.123456+00:00');
  });

  it('no row (none, or it expired — the database no longer returns it) is null', async () => {
    respond = () => ok(null);
    expect(await (await load()).getMyNote()).toBeNull();
  });

  it('hostile rows: an image on a host nobody allowed loses the image (the note stays); an unknown service loses the song; nothing left means no note', async () => {
    const api = await load();
    respond = () => ok(noteRow({ ...TRACK_ROW, track_artwork_url: 'https://evil.example/pixel.png', track_url: 'javascript:alert(1)' }));
    const a = await api.getMyNote();
    expect(a?.track?.artworkUrl).toBeNull();
    expect(a?.track?.trackUrl).toBeNull();
    respond = () => ok(noteRow({ ...TRACK_ROW, track_source: 'napster' }));
    expect((await api.getMyNote())?.track).toBeNull();
    respond = () => ok(noteRow({ body: '   ', ...{ track_title: null } }));
    expect(await api.getMyNote()).toBeNull();
    respond = () => ok(noteRow({ id: 'not-an-id' }));
    expect(await api.getMyNote()).toBeNull();
    respond = () => ok(noteRow({ user_id: '<img src=x>' }));
    expect(await api.getMyNote()).toBeNull();
    respond = () => ok(noteRow({ created_at: 'yesterday' }));
    expect(await api.getMyNote()).toBeNull();
    respond = () => ok('a string');
    expect(await api.getMyNote()).toBeNull();
  });

  it('over-long text from a misbehaving server is cut to 60 characters', async () => {
    respond = () => ok(noteRow({ body: 'x'.repeat(500) }));
    expect((await (await load()).getMyNote())?.text).toHaveLength(60);
  });

  it('posting upserts the one row with EVERY column, so a text-only note drops an earlier song', async () => {
    respond = () => ok(noteRow({ body: 'second' }));
    const api = await load();
    const n = await api.postNote({ text: '  second ', track: null });
    const ops = opsOf(calls[0]);
    expect(calls[0]?.table).toBe('status_notes');
    expect(ops.upsert).toEqual([
      {
        user_id: ME,
        body: 'second',
        track_title: null,
        track_artist: null,
        track_album: null,
        track_artwork_url: null,
        track_url: null,
        track_source: null,
      },
      { onConflict: 'user_id' },
    ]);
    expect(ops.single).toBeDefined();
    expect(n.text).toBe('second');
  });

  it('a song-only note sends the song; text and song are cleaned before they leave', async () => {
    respond = () => ok(noteRow({ body: '', ...TRACK_ROW }));
    const api = await load();
    await api.postNote({
      text: `${'a'.repeat(100)}`,
      track: { ...TRACK, title: `Night${BIDI} Drive`, artworkUrl: 'https://evil.example/x.png', trackUrl: 'https://open.spotify.com/track/abc' },
    });
    const row = (opsOf(calls[0]).upsert?.[0] ?? {}) as Record<string, unknown>;
    expect(row.body).toHaveLength(60);
    expect(row.track_title).toBe('Night Drive');
    expect(row.track_artwork_url).toBeNull(); // not on the player's own host: never sent
    expect(row.track_url).toBe('https://open.spotify.com/track/abc');
    expect(row.track_source).toBe('spotify');
  });

  it('needs words or a song — nothing is sent otherwise', async () => {
    const api = await load();
    await expect(api.postNote({ text: '   ', track: null })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.postNote({ text: '', track: { ...TRACK, source: 'napster' as never } })).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(0);
  });

  it('a reply the app can’t read is reported, not shown', async () => {
    respond = () => ok({ id: 'x' });
    await expect((await load()).postNote({ text: 'hi', track: null })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('deleting removes my row', async () => {
    const api = await load();
    await api.deleteMyNote();
    expect(calls[0]?.table).toBe('status_notes');
    expect(opsOf(calls[0]).delete).toBeDefined();
    expect(opsOf(calls[0]).eq).toEqual(['user_id', ME]);
  });
});

describe('the notes setting', () => {
  it('reads it from my profile; an unknown value falls back to the default', async () => {
    const api = await load();
    respond = () => ok({ notes_visibility: 'everyone' });
    expect(await api.getNotesVisibility()).toBe('everyone');
    expect(calls[0]?.table).toBe('profiles');
    expect(opsOf(calls[0]).select).toEqual(['notes_visibility']);
    respond = () => ok({ notes_visibility: 'friends-only' });
    expect(await api.getNotesVisibility()).toBe('communities');
    respond = () => ok(null);
    expect(await api.getNotesVisibility()).toBe('communities');
  });

  it('rejects with `unavailable` when the database has no such column yet (migration not applied)', async () => {
    respond = () => err('42703', 'column profiles.notes_visibility does not exist');
    await expect((await load()).getNotesVisibility()).rejects.toMatchObject({ code: 'unavailable' });
    respond = () => err('PGRST204', "Could not find the 'notes_visibility' column of 'profiles' in the schema cache");
    await expect((await load()).setNotesVisibility('off')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('writes only the three values, to my own profile', async () => {
    const api = await load();
    await api.setNotesVisibility('off');
    expect(opsOf(calls[0]).update).toEqual([{ notes_visibility: 'off' }]);
    expect(opsOf(calls[0]).eq).toEqual(['id', ME]);
    await expect(api.setNotesVisibility('friends' as never)).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(1);
  });
});

describe('the feed', () => {
  const feedRow = (over: Record<string, unknown> = {}) => ({ ...noteRow(), likes: 3, comments: 2, liked_by_me: true, ...over });

  it('asks for a page, clamped to 1–50 (30 by default), and maps notes with their counts', async () => {
    respond = () => ok([feedRow(), feedRow({ id: NOTE2, user_id: BOB, body: 'second', likes: 0, comments: 0, liked_by_me: false })]);
    const api = await load();
    const items = await api.feed();
    expect(calls[0]?.fn).toBe('activity_feed');
    expect(calls[0]?.args).toEqual({ p_limit: 30, p_before: null });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: 'note',
      ref: { ownerId: ALICE, kind: 'note', key: NOTE },
      at: '2026-11-20T10:00:00.123456+00:00',
      engagement: { likes: 3, likedByMe: true, comments: 2 },
    });
    expect(items[1]?.engagement).toEqual(NO_ENGAGEMENT);
    for (const [asked, sent] of [
      [1000, 50],
      [0, 1],
      [-4, 1],
      [12.9, 12],
      [Number.NaN, 30],
    ] as const) {
      await api.feed({ limit: asked });
      expect(argsOf<{ p_limit: number }>(last()).p_limit).toBe(sent);
    }
  });

  it('pages by `before`, passing the server’s own timestamp through untouched; garbage is refused, not ignored', async () => {
    respond = () => ok([]);
    const api = await load();
    await api.feed({ before: '2026-11-20T10:00:00.123456+00:00' });
    expect(last()?.args).toEqual({ p_limit: 30, p_before: '2026-11-20T10:00:00.123456+00:00' });
    await api.feed({ before: '2026-11-20 10:00:00+00' });
    expect(argsOf<{ p_before: string }>(last()).p_before).toBe('2026-11-20T10:00:00+00:00');
    const n = calls.length;
    await expect(api.feed({ before: "'; drop table notes; --" })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.feed({ before: 'yesterday' })).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(n);
  });

  it('drops hostile rows, de-duplicates, and bounds the counts', async () => {
    respond = () =>
      ok([
        feedRow({ id: 'not-a-uuid' }),
        feedRow({ body: '', track_title: null }),
        feedRow({ likes: -5, comments: 'lots', liked_by_me: 'yes' }),
        feedRow(), // the same note again
        feedRow({ id: NOTE2, user_id: BOB, likes: 1e12 }),
        null,
        'x',
        { id: NOTE },
      ]);
    const items = await (await load()).feed();
    expect(items.map((i) => i.ref.key)).toEqual([NOTE, NOTE2]);
    expect(items[0]?.engagement).toEqual({ likes: 0, likedByMe: false, comments: 0 });
    expect(items[1]?.engagement.likes).toBe(1_000_000);
  });

  it('anything but an array is an empty feed', async () => {
    respond = () => ok({ not: 'an array' });
    expect(await (await load()).feed()).toEqual([]);
  });
});

describe('engagement', () => {
  const eRow = (ref: SubjectRef, over: Record<string, unknown> = {}) => ({
    owner_id: ref.ownerId,
    kind: ref.kind,
    subject_key: ref.key,
    likes: 2,
    comments: 1,
    liked_by_me: true,
    ...over,
  });

  it('asks about the valid subjects once each, and answers keyed by refKey — with zeros for what the database left out', async () => {
    respond = () => ok([eRow(noteRef)]);
    const api = await load();
    const out = await api.engagement([
      noteRef,
      noteRef,
      songRef,
      { ownerId: 'x', kind: 'note', key: NOTE },
      { ownerId: ALICE, kind: 'note', key: 'not-a-uuid' },
      { ownerId: ALICE, kind: 'listening', key: '' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe('activity_engagement');
    expect(calls[0]?.args).toEqual({
      p_refs: [
        { owner_id: ALICE, kind: 'note', subject_key: NOTE },
        { owner_id: ALICE, kind: 'listening', subject_key: songRef.key },
      ],
    });
    expect(out[refKey(noteRef)]).toEqual({ likes: 2, likedByMe: true, comments: 1 });
    expect(out[refKey(songRef)]).toEqual(NO_ENGAGEMENT); // not returned: not visible, or nothing yet
    expect(Object.keys(out)).toHaveLength(2);
  });

  it('ignores rows for subjects nobody asked about, and cleans the numbers', async () => {
    respond = () => ok([eRow(noteRef, { likes: -3, comments: 7.9 }), eRow({ ownerId: BOB, kind: 'note', key: NOTE2 }), { owner_id: 5 }, null]);
    const out = await (await load()).engagement([noteRef]);
    expect(Object.keys(out)).toEqual([refKey(noteRef)]);
    expect(out[refKey(noteRef)]).toEqual({ likes: 0, likedByMe: true, comments: 7 });
  });

  it('many subjects go in batches of at most 100 (and at most 300 in all)', async () => {
    respond = () => ok([]);
    const refs: SubjectRef[] = Array.from({ length: 450 }, (_, i) => ({ ownerId: ALICE, kind: 'listening', key: `song ${i}` }));
    const out = await (await load()).engagement(refs);
    expect(calls.map((c) => (c.args as { p_refs: unknown[] }).p_refs.length)).toEqual([100, 100, 100]);
    expect(Object.keys(out)).toHaveLength(300);
  });

  it('nothing to ask means no request', async () => {
    expect(await (await load()).engagement([])).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('a refusal or a missing function is an error, not zeros', async () => {
    respond = () => err('PGRST202', 'Could not find the function public.activity_engagement(p_refs) in the schema cache');
    await expect((await load()).engagement([noteRef])).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('hearts', () => {
  it('a heart on a note inserts the like; the kind comes from the subject, the snapshot is cleaned', async () => {
    const api = await load();
    await api.like(noteRef, { kind: 'listening', text: `hi${BIDI}${'x'.repeat(100)}`, track: { ...TRACK, artworkUrl: 'https://evil.example/x.png' } });
    expect(calls[0]?.table).toBe('activity_likes');
    const row = opsOf(calls[0]).insert?.[0] as {
      owner_id: string;
      kind: string;
      subject_key: string;
      context: { kind: string; text: string; track: { artworkUrl: string | null } };
    };
    expect([row.owner_id, row.kind, row.subject_key]).toEqual([ALICE, 'note', NOTE]);
    expect(row.context.kind).toBe('note'); // not "listening"
    expect(row.context.text).toHaveLength(60);
    expect(row.context.text).not.toContain(BIDI);
    expect(row.context.track.artworkUrl).toBeNull();
  });

  it('a heart on a song sends the song', async () => {
    await (await load()).like(songRef, { kind: 'listening', track: TRACK });
    const row = opsOf(calls[0]).insert?.[0] as { kind: string; subject_key: string; context: unknown };
    expect([row.kind, row.subject_key]).toEqual(['listening', songRef.key]);
    expect(row.context).toEqual({ kind: 'listening', track: TRACK });
  });

  it('hearting twice is a no-op (the database refuses the duplicate)', async () => {
    respond = () => err('23505', 'duplicate key value violates unique constraint "activity_likes_once"');
    await expect((await load()).like(noteRef, { kind: 'note' })).resolves.toBeUndefined();
  });

  it('other refusals map to codes: not allowed, rate limited, invalid, unavailable, network', async () => {
    const api = await load();
    const cases: Array<[Result, string]> = [
      [err('42501', 'new row violates row-level security policy for table "activity_likes"'), 'not_allowed'],
      [err('P0001', 'rate_limited', { hint: 'Too many — wait a while.' }), 'rate_limited'],
      [err('23514', 'new row for relation "activity_likes" violates check constraint "activity_likes_context"'), 'invalid'],
      [err('42P01', 'relation "public.activity_likes" does not exist'), 'unavailable'],
      [{ data: null, error: { message: 'TypeError: Failed to fetch' } }, 'network'],
    ];
    for (const [r, code] of cases) {
      respond = () => r;
      await expect(api.like(noteRef, { kind: 'note' })).rejects.toMatchObject({ code });
    }
  });

  it('never sends a heart for yourself or for something that isn’t a subject', async () => {
    const api = await load();
    await expect(api.like({ ...noteRef, ownerId: ME }, { kind: 'note' })).rejects.toMatchObject({ code: 'not_allowed' });
    await expect(api.like({ ownerId: ALICE, kind: 'note', key: 'nope' }, { kind: 'note' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.like({ ownerId: ALICE, kind: 'comment' as never, key: NOTE }, { kind: 'note' })).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(0);
  });

  it('taking a heart back deletes only my own row for that subject', async () => {
    await (await load()).unlike(songRef);
    expect(calls[0]?.table).toBe('activity_likes');
    expect(calls[0]?.ops.filter(([n]) => n === 'eq').map(([, a]) => a)).toEqual([
      ['actor_id', ME],
      ['owner_id', ALICE],
      ['kind', 'listening'],
      ['subject_key', songRef.key],
    ]);
  });
});

describe('comments', () => {
  it('lists a note’s comments newest first with a limit, and pages with `before`', async () => {
    respond = () => ok([commentRow(), commentRow({ id: '88888888-8888-4888-8888-888888888888', body: 'older' })]);
    const api = await load();
    const list = await api.comments(noteRef, { limit: 500, before: '2026-11-20T10:05:00+00:00' });
    const names = calls[0]?.ops.map(([n]) => n);
    expect(calls[0]?.table).toBe('activity_comments');
    expect(names).toEqual(['select', 'eq', 'eq', 'order', 'limit', 'lt']);
    expect(opsOf(calls[0]).order).toEqual(['created_at', { ascending: false }]);
    expect(opsOf(calls[0]).limit).toEqual([100]);
    expect(opsOf(calls[0]).lt).toEqual(['created_at', '2026-11-20T10:05:00+00:00']);
    expect(list.map((c) => c.body)).toEqual(['nice', 'older']);
    expect(list[0]).toEqual({ id: CMT, ref: noteRef, authorId: BOB, body: 'nice', createdAt: '2026-11-20T10:05:00+00:00' });
  });

  it('cleans bodies and drops rows that are broken or that claim another note', async () => {
    respond = () =>
      ok([
        commentRow({ body: `<b>hi</b>${BIDI}\nthere${ZWSP}` }),
        commentRow({ id: 'x' }),
        commentRow({ body: '   ' }),
        commentRow({ author_id: 'nobody' }),
        commentRow({ subject_key: NOTE2 }),
        commentRow({ owner_id: BOB }),
        commentRow({ body: 'y'.repeat(1000), id: '99999999-9999-4999-8999-999999999999' }),
      ]);
    const list = await (await load()).comments(noteRef);
    expect(list).toHaveLength(2);
    expect(list[0]?.body).toBe('<b>hi</b> there'); // inert text; only ever rendered as text
    expect(list[1]?.body).toHaveLength(200);
  });

  it('comments only live under notes: a song (or a bad ref) is an empty list, with no request', async () => {
    const api = await load();
    expect(await api.comments(songRef)).toEqual([]);
    expect(await api.comments({ ownerId: 'x', kind: 'note', key: NOTE })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('adding sends only the words (the database snapshots the note itself) and returns the cleaned comment', async () => {
    respond = () => ok(commentRow({ author_id: ME, body: 'great' }));
    const api = await load();
    const c = await api.addComment(noteRef, '  great  ', { kind: 'note', text: 'stale context the server ignores' });
    expect(opsOf(calls[0]).insert).toEqual([{ owner_id: ALICE, subject_key: NOTE, body: 'great' }]);
    expect(c.body).toBe('great');
    expect(c.ref).toEqual(noteRef);
  });

  it('refuses blank text, a song, and over-long text is cut to 200', async () => {
    respond = () => ok(commentRow({ author_id: ME }));
    const api = await load();
    await expect(api.addComment(noteRef, '   ', { kind: 'note' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.addComment(songRef, 'on a song', { kind: 'listening' })).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(0);
    await api.addComment(noteRef, 'z'.repeat(900), { kind: 'note' });
    expect(opArg<{ body: string }>(calls[0], 'insert').body).toHaveLength(200);
  });

  it('maps refusals (not allowed to see the note, rate limited)', async () => {
    const api = await load();
    respond = () => err('42501', 'new row violates row-level security policy for table "activity_comments"');
    await expect(api.addComment(noteRef, 'hi', { kind: 'note' })).rejects.toMatchObject({ code: 'not_allowed' });
    respond = () => err('P0001', 'rate_limited');
    await expect(api.addComment(noteRef, 'hi', { kind: 'note' })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('deleting asks for one id (the database lets only the author or the note’s owner delete)', async () => {
    const api = await load();
    await api.deleteComment(CMT);
    expect(opsOf(calls[0]).delete).toBeDefined();
    expect(opsOf(calls[0]).eq).toEqual(['id', CMT]);
    await expect(api.deleteComment('1 or 1=1')).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(1);
  });
});

describe('activity messages', () => {
  it('lists what I am party to, newest first, bounded, and pages with `before`', async () => {
    respond = () => ok([messageRow()]);
    const api = await load();
    const list = await api.messages({ limit: 9999, before: '2026-11-21T00:00:00+00:00' });
    expect(calls[0]?.table).toBe('activity_messages');
    expect(opsOf(calls[0]).order).toEqual(['created_at', { ascending: false }]);
    expect(opsOf(calls[0]).limit).toEqual([100]);
    expect(opsOf(calls[0]).lt).toEqual(['created_at', '2026-11-21T00:00:00+00:00']);
    expect(opsOf(calls[0]).or).toBeUndefined();
    expect(list).toEqual([
      { id: MSG, senderId: ALICE, recipientId: ME, kind: 'reply', body: 'hello', context: null, createdAt: '2026-11-20T10:00:00+00:00', readAt: null },
    ]);
  });

  it('`with` asks for the thread with that person, both directions', async () => {
    respond = () => ok([messageRow(), messageRow({ id: '12121212-1212-4212-8212-121212121212', sender_id: ME, recipient_id: ALICE, body: 'my reply' })]);
    const list = await (await load()).messages({ with: ALICE });
    expect(opsOf(calls[0]).or).toEqual([`and(sender_id.eq.${ME},recipient_id.eq.${ALICE}),and(sender_id.eq.${ALICE},recipient_id.eq.${ME})`]);
    expect(list).toHaveLength(2);
  });

  it('a person without an account (a demo friend) has no real thread: empty, and nothing sent', async () => {
    const api = await load();
    expect(await api.messages({ with: 'alex' })).toEqual([]);
    expect(await api.messages({ with: 'x),or(true' })).toEqual([]); // nothing can be smuggled into the filter
    expect(calls).toHaveLength(0);
  });

  it('cleans every field of every row and drops what isn’t a message between me and someone else', async () => {
    respond = () =>
      ok([
        messageRow({
          body: `hi${BIDI}\nthere`,
          context: { kind: 'note', text: `a${ZWSP}b`, track: { ...TRACK, artworkUrl: 'https://evil.example/x.png' }, html: '<script>alert(1)</script>' },
        }),
        messageRow({
          id: '13131313-1313-4313-8313-131313131313',
          kind: 'like',
          body: 'smuggled text',
          context: { kind: 'listening', track: TRACK },
          read_at: '2026-11-20T11:00:00+00:00',
        }),
        messageRow({ id: '14141414-1414-4414-8414-141414141414', sender_id: ALICE, recipient_id: BOB }), // not mine
        messageRow({ id: '15151515-1515-4515-8515-151515151515', sender_id: ME, recipient_id: ME }), // to myself
        messageRow({ id: '16161616-1616-4616-8616-161616161616', kind: 'shout' }),
        messageRow({ id: '17171717-1717-4717-8717-171717171717', body: '   ' }), // an empty reply
        messageRow({ id: '18181818-1818-4818-8818-181818181818', created_at: 'garbage' }),
        messageRow({ id: 'x' }),
        messageRow({ id: '19191919-1919-4919-8919-191919191919', body: 'q'.repeat(2000), context: 'not an object' }),
        null,
      ]);
    const list = await (await load()).messages();
    expect(list.map((m) => m.kind)).toEqual(['reply', 'like', 'reply']);
    expect(list[0]?.body).toBe('hi there');
    expect(list[0]?.context).toEqual({ kind: 'note', text: 'a b', track: { ...TRACK, artworkUrl: null } });
    expect(JSON.stringify(list[0])).not.toContain('script');
    expect(list[1]?.body).toBe(''); // a like carries no text, whatever the server says
    expect(list[1]?.readAt).toBe('2026-11-20T11:00:00+00:00');
    expect(list[1]?.context).toEqual({ kind: 'listening', track: TRACK });
    expect(list[2]?.body).toHaveLength(500);
    expect(list[2]?.context).toBeNull();
  });

  it('with `with`, a row from a different thread is not shown', async () => {
    respond = () => ok([messageRow(), messageRow({ id: '20202020-2020-4020-8020-202020202020', sender_id: BOB })]);
    const list = await (await load()).messages({ with: ALICE });
    expect(list.map((m) => m.senderId)).toEqual([ALICE]);
  });

  it('errors are mapped', async () => {
    respond = () => err('42P01', 'relation "public.activity_messages" does not exist');
    await expect((await load()).messages()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('replying and marking read', () => {
  it('a reply inserts to the person with the cleaned text and snapshot — and returns the stored message', async () => {
    respond = () => ok(messageRow({ sender_id: ME, recipient_id: ALICE, body: 'nice one', context: { kind: 'listening', track: TRACK } }));
    const api = await load();
    const m = await api.sendReply(ALICE, `  nice${BIDI} one `, { kind: 'listening', track: { ...TRACK, trackUrl: 'javascript:alert(1)' } });
    expect(opsOf(calls[0]).insert).toEqual([{ recipient_id: ALICE, body: 'nice one', context: { kind: 'listening', track: TRACK } }]);
    expect(m).toMatchObject({ senderId: ME, recipientId: ALICE, kind: 'reply', body: 'nice one' });
  });

  it('a reply without a snapshot sends none', async () => {
    respond = () => ok(messageRow({ sender_id: ME, recipient_id: ALICE }));
    await (await load()).sendReply(ALICE, 'hi', null);
    expect(opArg<{ context: unknown }>(calls[0], 'insert').context).toBeNull();
  });

  it('refuses locally what can never work: no account, yourself, blank, too long is cut at 500', async () => {
    respond = () => ok(messageRow({ sender_id: ME, recipient_id: ALICE }));
    const api = await load();
    await expect(api.sendReply('alex', 'hi', null)).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.sendReply(ME, 'hi', null)).rejects.toMatchObject({ code: 'not_allowed' });
    await expect(api.sendReply(ALICE, ' \n ', null)).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(0);
    await api.sendReply(ALICE, 'w'.repeat(2000), null);
    expect(opArg<{ body: string }>(calls[0], 'insert').body).toHaveLength(500);
  });

  it('maps the database’s answers: nobody I may write to, rate limited', async () => {
    const api = await load();
    respond = () => err('42501', 'new row violates row-level security policy for table "activity_messages"');
    await expect(api.sendReply(ALICE, 'hi', null)).rejects.toMatchObject({ code: 'not_allowed' });
    respond = () => err('P0001', 'rate_limited');
    await expect(api.sendReply(ALICE, 'hi', null)).rejects.toMatchObject({ code: 'rate_limited' });
    respond = () => ok({ id: 'garbage' });
    await expect(api.sendReply(ALICE, 'hi', null)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('marking ids read updates only unread rows addressed to me', async () => {
    await (await load()).markRead({ ids: [MSG, 'nope', "1'; --"] });
    const ops = opsOf(calls[0]);
    expect(calls[0]?.table).toBe('activity_messages');
    expect(Object.keys(ops).includes('update')).toBe(true);
    expect(opArg<{ read_at: string }>(calls[0], 'update').read_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(calls[0]?.ops.filter(([n]) => n === 'eq').map(([, a]) => a)).toEqual([['recipient_id', ME]]);
    expect(ops.is).toEqual(['read_at', null]);
    expect(ops.in).toEqual(['id', [MSG]]);
  });

  it('marking a thread read updates what that person sent me', async () => {
    await (await load()).markRead({ with: ALICE });
    expect(calls[0]?.ops.filter(([n]) => n === 'eq').map(([, a]) => a)).toEqual([
      ['recipient_id', ME],
      ['sender_id', ALICE],
    ]);
  });

  it('nothing valid to mark means no request; a refusal is mapped', async () => {
    const api = await load();
    await api.markRead({ ids: [] });
    await api.markRead({ ids: ['x'] });
    await api.markRead({ with: 'alex' });
    expect(calls).toHaveLength(0);
    respond = () => err('42501', 'permission denied for table activity_messages');
    await expect(api.markRead({ ids: [MSG] })).rejects.toMatchObject({ code: 'not_allowed' });
  });
});

describe('error mapping', () => {
  it('turns what the database says into a code the UI can act on', async () => {
    const { toActivityError } = await import('./supabaseApi');
    const code = (e: { code?: string; message?: string; status?: number }) => toActivityError(e).code;
    expect(code({ code: 'P0001', message: 'rate_limited' })).toBe('rate_limited');
    expect(code({ status: 429, message: 'Too Many Requests' })).toBe('rate_limited');
    expect(code({ code: '42501', message: 'new row violates row-level security policy' })).toBe('not_allowed');
    expect(code({ code: '42501', message: 'permission denied for table status_notes' })).toBe('not_allowed');
    expect(code({ code: 'P0001', message: 'immutable_column' })).toBe('not_allowed');
    expect(code({ status: 403, message: 'forbidden' })).toBe('not_allowed');
    expect(code({ code: '23514', message: 'violates check constraint "status_notes_body_length"' })).toBe('invalid');
    expect(code({ code: '23502', message: 'null value in column "body"' })).toBe('invalid');
    expect(code({ code: '22P02', message: 'invalid input syntax for type uuid' })).toBe('invalid');
    expect(code({ code: '42P01', message: 'relation "status_notes" does not exist' })).toBe('unavailable');
    expect(code({ code: '42883', message: 'function activity_feed does not exist' })).toBe('unavailable');
    expect(code({ code: 'PGRST202', message: 'Could not find the function' })).toBe('unavailable');
    expect(code({ code: 'PGRST205', message: "Could not find the table 'public.status_notes' in the schema cache" })).toBe('unavailable');
    expect(code({ code: 'PGRST301', message: 'JWT expired' })).toBe('not_signed_in');
    expect(code({ status: 401, message: 'Unauthorized' })).toBe('not_signed_in');
    expect(code({ message: 'Failed to fetch' })).toBe('network');
    expect(code({ message: 'NetworkError when attempting to fetch resource.' })).toBe('network');
    expect(code({ message: 'something nobody has seen before' })).toBe('unavailable');
    expect(toActivityError({ message: 'x' })).toBeInstanceOf(Error);
  });
});

describe('without a configured backend', () => {
  it('every call rejects with `unavailable`, and subscribing is a harmless no-op', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/client', () => ({ supabase: null }));
    const { createSupabaseActivityApi } = await import('./supabaseApi');
    const api = createSupabaseActivityApi(ME);
    for (const run of [
      () => api.getMyNote(),
      () => api.postNote({ text: 'x', track: null }),
      () => api.deleteMyNote(),
      () => api.getNotesVisibility(),
      () => api.setNotesVisibility('off'),
      () => api.feed(),
      () => api.engagement([noteRef]),
      () => api.like(noteRef, { kind: 'note' }),
      () => api.unlike(noteRef),
      () => api.comments(noteRef),
      () => api.addComment(noteRef, 'x', { kind: 'note' }),
      () => api.deleteComment(CMT),
      () => api.messages(),
      () => api.sendReply(ALICE, 'x', null),
      () => api.markRead({ ids: [MSG] }),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: 'unavailable' });
    }
    const off = api.subscribe(() => {});
    expect(typeof off).toBe('function');
    off();
    vi.doMock('@/lib/supabase/client', () => ({ supabase: fake }));
  });
});

describe('Realtime', () => {
  const handlerFor = (ch: FakeChannel | undefined, table: string) => ch?.handlers.find((h) => h.filter.table === table);

  it('subscribes once, to my messages, to notes, and to hearts on my things — filtered by my id', async () => {
    const api = await load();
    api.subscribe(() => {});
    expect(channels).toHaveLength(1);
    const ch = channels[0];
    expect(ch?.subscribed).toBe(true);
    expect(ch?.handlers.map((h) => [h.type, h.filter.event, h.filter.table, h.filter.filter])).toEqual([
      ['postgres_changes', 'INSERT', 'activity_messages', `recipient_id=eq.${ME}`],
      ['postgres_changes', '*', 'status_notes', undefined],
      ['postgres_changes', 'INSERT', 'activity_likes', `owner_id=eq.${ME}`],
    ]);
    expect(ch?.handlers.every((h) => h.filter.schema === 'public')).toBe(true);
  });

  it('a new message for me becomes a `message` event, cleaned', async () => {
    const events: unknown[] = [];
    (await load()).subscribe((e) => events.push(e));
    const cb = handlerFor(channels[0], 'activity_messages')?.cb;
    cb?.({
      eventType: 'INSERT',
      new: messageRow({ body: `hey${BIDI}\nyou`, context: { kind: 'note', text: 'x', track: { ...TRACK, artworkUrl: 'https://evil.example/p.png' } } }),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message',
      message: { id: MSG, senderId: ALICE, recipientId: ME, body: 'hey you', context: { kind: 'note', text: 'x', track: { artworkUrl: null } } },
    });
  });

  it('hostile message events are dropped: someone else’s, malformed, empty', async () => {
    const events: unknown[] = [];
    (await load()).subscribe((e) => events.push(e));
    const cb = handlerFor(channels[0], 'activity_messages')?.cb;
    cb?.({ eventType: 'INSERT', new: messageRow({ sender_id: ME, recipient_id: ALICE }) }); // my own reply (another device): not "new for me"
    cb?.({ eventType: 'INSERT', new: messageRow({ sender_id: BOB, recipient_id: ALICE }) });
    cb?.({ eventType: 'INSERT', new: { id: 'x' } });
    cb?.({ eventType: 'INSERT', new: null });
    cb?.({ eventType: 'INSERT' });
    expect(events).toEqual([]);
  });

  it('note changes tell the UI whose note moved — inserts, updates and the removal that carries only an id', async () => {
    const events: unknown[] = [];
    (await load()).subscribe((e) => events.push(e));
    const cb = handlerFor(channels[0], 'status_notes')?.cb;
    cb?.({ eventType: 'INSERT', new: noteRow() });
    cb?.({ eventType: 'UPDATE', new: noteRow({ user_id: BOB }) });
    cb?.({ eventType: 'DELETE', old: { user_id: ALICE } });
    cb?.({ eventType: 'DELETE', old: {} });
    cb?.({ eventType: 'INSERT', new: { user_id: '<script>' } });
    expect(events).toEqual([
      { type: 'note', ownerId: ALICE },
      { type: 'note', ownerId: BOB },
      { type: 'note', ownerId: ALICE },
    ]);
  });

  it('a heart on one of my things becomes an `engagement` event for that subject', async () => {
    const events: unknown[] = [];
    (await load()).subscribe((e) => events.push(e));
    const cb = handlerFor(channels[0], 'activity_likes')?.cb;
    cb?.({ eventType: 'INSERT', new: { owner_id: ME, kind: 'note', subject_key: NOTE, actor_id: BOB } });
    cb?.({ eventType: 'INSERT', new: { owner_id: ME, kind: 'listening', subject_key: 'spotify|a|b' } });
    cb?.({ eventType: 'INSERT', new: { owner_id: ALICE, kind: 'note', subject_key: NOTE } }); // not on mine
    cb?.({ eventType: 'INSERT', new: { owner_id: ME, kind: 'note', subject_key: 'not-a-uuid' } });
    cb?.({ eventType: 'INSERT', new: null });
    expect(events).toEqual([
      { type: 'engagement', ref: { ownerId: ME, kind: 'note', key: NOTE } },
      { type: 'engagement', ref: { ownerId: ME, kind: 'listening', key: 'spotify|a|b' } },
    ]);
  });

  it('unsubscribing removes the channel once, and nothing is delivered afterwards', async () => {
    const events: unknown[] = [];
    const off = (await load()).subscribe((e) => events.push(e));
    const cb = handlerFor(channels[0], 'status_notes')?.cb;
    off();
    off();
    expect(removed).toEqual([channels[0]]);
    cb?.({ eventType: 'INSERT', new: noteRow() });
    expect(events).toEqual([]);
  });

  it('each subscription is its own channel; one listener throwing does not break the others', async () => {
    const api = await load();
    const seen: unknown[] = [];
    api.subscribe(() => {
      throw new Error('a listener bug');
    });
    api.subscribe((e) => seen.push(e));
    expect(new Set(channels.map((c) => c.name)).size).toBe(2);
    for (const ch of channels) handlerFor(ch, 'status_notes')?.cb({ eventType: 'INSERT', new: noteRow() });
    expect(seen).toHaveLength(1);
  });

  it('a person id that is not a UUID (a dev harness) subscribes to nothing — the id goes into a filter string', async () => {
    const api = await load('me');
    const off = api.subscribe(() => {});
    off();
    expect(channels).toHaveLength(0);
  });
});

describe('one API per person', () => {
  it('is cached per signed-in user and replaced when the user changes', async () => {
    vi.resetModules();
    const { activityApiFor } = await import('./supabaseApi');
    const a = activityApiFor(ME);
    expect(activityApiFor(ME)).toBe(a);
    const b = activityApiFor(ALICE);
    expect(b).not.toBe(a);
    expect(b.me).toBe(ALICE);
  });
});
