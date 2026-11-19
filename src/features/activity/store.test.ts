import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/features/nowplaying/track';
import type { ActivityApi, ActivityEvent } from './api';
import { createDemoServer } from './demo';
import { buildThreads, unreadTotal } from './describe';
import { MemoryActivityServer } from './memoryApi';
import { type ActivitySink, type ActivityStore, createActivityStore, dedupeFeed, FEED_PAGE, mergeFeedHead } from './store';
import { ActivityError, type FeedItem, NO_ENGAGEMENT, refKey, type SubjectRef } from './types';

const uid = () => crypto.randomUUID();
const HOUR = 3_600_000;
const song = (title = 'Night Drive'): Track => ({ title, artist: 'The Tests', album: '', artworkUrl: null, trackUrl: null, source: 'spotify' });
const settle = async (ms = 100) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
const code = async (p: Promise<unknown>) => ((await p.then(() => null).catch((e) => e)) as { code?: string } | null)?.code ?? null;

let server: MemoryActivityServer;
let demoServer: MemoryActivityServer;
let me: string;
let api: ActivityApi;
/** The same API without the spies (for holding a request and then letting the real thing run). */
let raw: ActivityApi;
let demoApi: ActivityApi;
let signedIn = true;
let store: ActivityStore;
let sink: { notice: ReturnType<typeof vi.fn>; resolve: ReturnType<typeof vi.fn>; toast: ReturnType<typeof vi.fn> };
let visible = true;

/** An API whose calls are spied on, and whose `like` / `feed` can be held until the test lets them go. */
function spied(inner: ActivityApi) {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const wrapped = Object.fromEntries(
    Object.entries(inner).map(([k, v]) => {
      if (typeof v !== 'function') return [k, v];
      calls[k] = vi.fn(v as (...a: unknown[]) => unknown);
      return [k, calls[k]];
    }),
  ) as unknown as ActivityApi;
  return { api: wrapped, calls };
}
let calls: Record<string, ReturnType<typeof vi.fn>>;
let demoCalls: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.useFakeTimers();
  server = new MemoryActivityServer();
  me = uid();
  raw = server.api(me);
  const real = spied(raw);
  api = real.api;
  calls = real.calls;
  demoServer = createDemoServer();
  const demo = spied(demoServer.api('local-user'));
  demoApi = demo.api;
  demoCalls = demo.calls;
  signedIn = true;
  visible = true;
  sink = { notice: vi.fn(), resolve: vi.fn(), toast: vi.fn() };
  store = createActivityStore(() => (signedIn ? api : null), {
    demo: () => demoApi,
    names: async () => 'Maya',
    peers: async () => [],
    sink: sink as unknown as ActivitySink,
    visible: () => visible,
  });
});
afterEach(() => {
  store.getState().reset();
  vi.useRealTimers();
});

const noteRef = (ownerId: string, key: string): SubjectRef => ({ ownerId, kind: 'note', key });
/** Another person with a note I can see. */
function otherWithNote(text = 'hello', ageMs = 0) {
  const other = uid();
  const note = server.seedNote(other, text, null, ageMs, 'everyone');
  return { other, note, ref: noteRef(other, note.id) };
}

describe('demo people versus real accounts', () => {
  it('a simulated person’s note comes from the demo API and never touches the real one', async () => {
    store.getState().watchNote('alex');
    await flush();
    expect(store.getState().notes.alex?.text).toContain('Shipping');
    expect(demoCalls.feed).toHaveBeenCalledTimes(1);
    expect(calls.feed).not.toHaveBeenCalled();
    // asking again is free
    store.getState().watchNote('jordan');
    await flush();
    expect(demoCalls.feed).toHaveBeenCalledTimes(1);
  });

  it('a heart on a simulated person goes to the demo API; on a real account, to the real one', async () => {
    const alexNote = store.getState().notes.alex ?? (await demoApi.feed()).find((i) => i.ref.ownerId === 'alex')?.ref;
    const aref = alexNote && 'key' in alexNote ? (alexNote as SubjectRef) : (await demoApi.feed())[0]?.ref;
    expect(aref).toBeDefined();
    await store.getState().toggleLike(aref as SubjectRef, { kind: 'note', text: 'x' });
    expect(demoCalls.like).toHaveBeenCalledTimes(1);
    expect(calls.like).not.toHaveBeenCalled();

    const { ref } = otherWithNote();
    await store.getState().toggleLike(ref, { kind: 'note', text: 'hello' });
    expect(calls.like).toHaveBeenCalledTimes(1);
    expect(demoCalls.like).toHaveBeenCalledTimes(1);
  });

  it('many avatars asking for a real person’s note cause ONE feed request, not one each', async () => {
    const { other } = otherWithNote();
    const stops = [store.getState().watchNote(other), store.getState().watchNote(other), store.getState().watchNote(uid())];
    await flush();
    await store.getState().ensureFeed();
    expect(calls.feed).toHaveBeenCalledTimes(1);
    expect(store.getState().notes[other]).toBeDefined();
    for (const s of stops) s();
  });

  it('a guest has no real activity (and nothing is requested), but simulated people still work', async () => {
    signedIn = false;
    store.getState().watchNote(uid());
    await flush();
    expect(calls.feed).not.toHaveBeenCalled();
    expect(await code(store.getState().toggleLike(noteRef(uid(), 'k'), { kind: 'note' }))).toBe('not_signed_in');
    store.getState().watchNote('riley');
    await flush();
    expect(store.getState().notes.riley).toBeDefined();
  });

  it('sign-out forgets real people but keeps the simulated ones', async () => {
    const { other } = otherWithNote();
    await store.getState().ensureFeed();
    store.getState().watchNote('alex');
    await flush();
    expect(store.getState().notes[other]).toBeDefined();
    store.getState().reset();
    expect(store.getState().notes[other]).toBeUndefined();
    expect(store.getState().feed).toEqual([]);
    expect(store.getState().notes.alex).toBeDefined();
  });
});

describe('hearts are optimistic', () => {
  it('counts at once, and keeps it when the server agrees', async () => {
    const { ref } = otherWithNote();
    await store.getState().ensureFeed();
    expect(store.getState().engagement[refKey(ref)]).toEqual(NO_ENGAGEMENT);
    let release: () => void = () => {};
    const inner = raw.like;
    calls.like?.mockImplementationOnce(
      (...a: Parameters<typeof inner>) =>
        new Promise<void>((resolve) => {
          release = () => void inner(...a).then(resolve);
        }),
    );
    const done = store.getState().toggleLike(ref, { kind: 'note', text: 'hello' });
    await flush();
    expect(store.getState().engagement[refKey(ref)]).toEqual({ likes: 1, likedByMe: true, comments: 0 }); // before the server answered
    release();
    await done;
    expect(store.getState().engagement[refKey(ref)]).toEqual({ likes: 1, likedByMe: true, comments: 0 });
    expect((await api.engagement([ref]))[refKey(ref)]?.likes).toBe(1);
  });

  it('puts the previous state back — and tells the caller — when a like fails', async () => {
    const { ref } = otherWithNote();
    await store.getState().ensureFeed();
    server.failNext = new ActivityError('rate_limited');
    expect(await code(store.getState().toggleLike(ref, { kind: 'note', text: 'hello' }))).toBe('rate_limited');
    expect(store.getState().engagement[refKey(ref)]).toEqual(NO_ENGAGEMENT);
    // and it works again afterwards
    await store.getState().toggleLike(ref, { kind: 'note', text: 'hello' });
    expect(store.getState().engagement[refKey(ref)]?.likedByMe).toBe(true);
  });

  it('a heart on a song that has since changed is refused: it goes back, and the caller can say so', async () => {
    const owner = uid();
    const ref: SubjectRef = { ownerId: owner, kind: 'listening', key: 'spotify|night drive|the tests' };
    server.hearing = () => false; // their Now playing row is no longer fresh
    const err = (await store
      .getState()
      .toggleLike(ref, { kind: 'listening', track: song() })
      .catch((e) => e)) as ActivityError;
    expect(err.code).toBe('not_allowed');
    expect(store.getState().engagement[refKey(ref)]).toEqual(NO_ENGAGEMENT);
  });

  it('puts a heart back when an un-like fails', async () => {
    const { ref } = otherWithNote();
    await store.getState().ensureFeed();
    await store.getState().toggleLike(ref, { kind: 'note', text: 'hello' });
    server.failNext = new ActivityError('network');
    expect(await code(store.getState().toggleLike(ref, { kind: 'note' }))).toBe('network');
    expect(store.getState().engagement[refKey(ref)]).toEqual({ likes: 1, likedByMe: true, comments: 0 });
  });

  it('a burst of clicks becomes at most one request per direction and ends where the last click left it', async () => {
    const { ref } = otherWithNote();
    await store.getState().ensureFeed();
    let release: () => void = () => {};
    const inner = raw.like;
    calls.like?.mockImplementationOnce(
      (...a: Parameters<typeof inner>) =>
        new Promise<void>((resolve) => {
          release = () => void inner(...a).then(resolve);
        }),
    );
    const first = store.getState().toggleLike(ref, { kind: 'note', text: 'hello' }); // like, in flight
    await flush();
    const second = store.getState().toggleLike(ref, { kind: 'note', text: 'hello' }); // un-like while waiting
    const third = store.getState().toggleLike(ref, { kind: 'note', text: 'hello' }); // like again
    await flush();
    expect(store.getState().engagement[refKey(ref)]).toEqual({ likes: 1, likedByMe: true, comments: 0 });
    release();
    await Promise.all([first, second, third]);
    expect(calls.like).toHaveBeenCalledTimes(1); // the wish ended where the first request already was
    expect(calls.unlike).not.toHaveBeenCalled();
    expect((await api.engagement([ref]))[refKey(ref)]).toEqual({ likes: 1, likedByMe: true, comments: 0 });
  });

  it('click, click: the like is sent and then taken back', async () => {
    const { ref } = otherWithNote();
    await store.getState().ensureFeed();
    let release: () => void = () => {};
    const inner = raw.like;
    calls.like?.mockImplementationOnce(
      (...a: Parameters<typeof inner>) =>
        new Promise<void>((resolve) => {
          release = () => void inner(...a).then(resolve);
        }),
    );
    const first = store.getState().toggleLike(ref, { kind: 'note', text: 'hello' });
    await flush();
    const second = store.getState().toggleLike(ref, { kind: 'note', text: 'hello' });
    expect(store.getState().engagement[refKey(ref)]).toEqual({ likes: 0, likedByMe: false, comments: 0 });
    release();
    await Promise.all([first, second]);
    expect(calls.like).toHaveBeenCalledTimes(1);
    expect(calls.unlike).toHaveBeenCalledTimes(1);
    expect((await api.engagement([ref]))[refKey(ref)]).toEqual({ likes: 0, likedByMe: false, comments: 0 });
    expect(store.getState().engagement[refKey(ref)]).toEqual({ likes: 0, likedByMe: false, comments: 0 });
  });

  it('a fetched count never overwrites a heart that is still in flight', async () => {
    const { ref } = otherWithNote();
    await store.getState().ensureFeed();
    let release: () => void = () => {};
    const inner = raw.like;
    calls.like?.mockImplementationOnce(
      (...a: Parameters<typeof inner>) =>
        new Promise<void>((resolve) => {
          release = () => void inner(...a).then(resolve);
        }),
    );
    const p = store.getState().toggleLike(ref, { kind: 'note', text: 'hello' });
    await flush();
    const stop = store.getState().watchEngagement(ref);
    await settle(200); // the batched fetch runs while the like is pending
    expect(store.getState().engagement[refKey(ref)]?.likedByMe).toBe(true);
    release();
    await p;
    stop();
  });

  it('batches engagement lookups: many watchers of two subjects are one request', async () => {
    const a = otherWithNote('a');
    const b = otherWithNote('b');
    const stops = [store.getState().watchEngagement(a.ref), store.getState().watchEngagement(a.ref), store.getState().watchEngagement(b.ref)];
    await settle(200);
    expect(calls.engagement).toHaveBeenCalledTimes(1);
    expect(((calls.engagement?.mock.calls[0]?.[0] ?? []) as SubjectRef[]).map(refKey).sort()).toEqual([refKey(a.ref), refKey(b.ref)].sort());
    for (const s of stops) s();
  });

  it('refetches a subject when a live "engagement" event arrives for it', async () => {
    const { ref } = otherWithNote();
    const stop = store.getState().watchEngagement(ref);
    await settle(200);
    await store.getState().start();
    const third = server.api(uid());
    await third.like(ref, { kind: 'note', text: 'hello' });
    await settle(50);
    expect(store.getState().engagement[refKey(ref)]?.likes).toBe(1);
    stop();
  });
});

describe('the feed', () => {
  it('dedupes: one note per person (the newest), one entry per subject, newest first', () => {
    const mk = (owner: string, key: string, at: string): FeedItem => ({
      kind: 'note',
      ref: noteRef(owner, key),
      at,
      note: { id: key, ownerId: owner, text: key, track: null, createdAt: at, expiresAt: at },
      engagement: NO_ENGAGEMENT,
    });
    const out = dedupeFeed([
      mk('a', 'old', '2026-01-01T00:00:00Z'),
      mk('b', 'b1', '2026-01-02T00:00:00Z'),
      mk('a', 'new', '2026-01-03T00:00:00Z'),
      mk('b', 'b1', '2026-01-02T00:00:00Z'),
    ]);
    expect(out.map((i) => i.ref.key)).toEqual(['new', 'b1']);
  });

  it('merging a fresh first page keeps older loaded items only when the page was full', () => {
    const mk = (n: number): FeedItem => {
      const at = new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
      return {
        kind: 'note',
        ref: noteRef(`o${n}`, `k${n}`),
        at,
        note: { id: `k${n}`, ownerId: `o${n}`, text: '', track: song(), createdAt: at, expiresAt: at },
        engagement: NO_ENGAGEMENT,
      };
    };
    const existing = [mk(9), mk(8), mk(2), mk(1)]; // two pages loaded
    expect(mergeFeedHead(existing, [mk(10), mk(9), mk(8)], true).map((i) => i.ref.key)).toEqual(['k10', 'k9', 'k8', 'k2', 'k1']);
    expect(mergeFeedHead(existing, [mk(10), mk(8)], false).map((i) => i.ref.key)).toEqual(['k10', 'k8']); // k9 was deleted, the rest expired
  });

  it('loads 40 at a time with a `before` cursor and never repeats or skips', async () => {
    for (let i = 0; i < 95; i++) server.seedNote(uid(), `n${i}`, null, (95 - i) * 1000, 'everyone');
    await store.getState().ensureFeed();
    expect(store.getState().feed).toHaveLength(FEED_PAGE);
    expect(store.getState().hasMore).toBe(true);
    expect(store.getState().feedStatus).toBe('ready');
    await store.getState().loadMoreFeed();
    expect(store.getState().feed).toHaveLength(80);
    await store.getState().loadMoreFeed();
    expect(store.getState().feed).toHaveLength(95);
    expect(store.getState().hasMore).toBe(false);
    expect(calls.feed?.mock.calls[1]?.[0]).toMatchObject({ limit: FEED_PAGE, before: store.getState().feed[FEED_PAGE - 1]?.at });
    const texts = store.getState().feed.map((i) => (i.kind === 'note' ? i.note.text : ''));
    expect(new Set(texts).size).toBe(95);
    expect(texts[0]).toBe('n94'); // newest first
    expect(texts.at(-1)).toBe('n0');
    // nothing more: no further request
    await store.getState().loadMoreFeed();
    expect(calls.feed).toHaveBeenCalledTimes(3);
  });

  it('seeds the engagement cache from the feed', async () => {
    const { ref } = otherWithNote();
    server.seedLike(ref, uid());
    server.seedComment(ref, uid(), 'hi');
    await store.getState().ensureFeed();
    expect(store.getState().engagement[refKey(ref)]).toEqual({ likes: 1, likedByMe: false, comments: 1 });
  });

  it('follows a live note: a new note appears, a replaced one is replaced, a deleted one goes', async () => {
    await store.getState().start();
    await store.getState().ensureFeed();
    const other = uid();
    server.seedNote(other, 'first', null, 0, 'everyone');
    await settle(600);
    expect(store.getState().feed.map((i) => (i.kind === 'note' ? i.note.text : ''))).toEqual(['first']);
    server.seedNote(other, 'second', null, 0, 'everyone');
    await settle(600);
    expect(store.getState().feed.map((i) => (i.kind === 'note' ? i.note.text : ''))).toEqual(['second']);
    expect(store.getState().notes[other]?.text).toBe('second');
    server.notes.delete(other);
    server.seedNote(uid(), 'someone else', null, 0, 'everyone'); // any change refreshes the head
    await settle(600);
    expect(store.getState().notes[other]).toBeUndefined();
  });

  it('shows "unavailable" calmly when the migration isn’t applied, and does not keep asking', async () => {
    server.available = false;
    await store.getState().ensureFeed();
    expect(store.getState().feedStatus).toBe('unavailable');
    await store.getState().ensureFeed();
    await store.getState().refreshFeed();
    expect(calls.feed).toHaveBeenCalledTimes(1);
    await store.getState().loadMine();
    expect(store.getState().mine.unavailable).toBe(true);
  });

  it('an error keeps what we had and retries only after a while', async () => {
    otherWithNote();
    await store.getState().ensureFeed();
    expect(store.getState().feed).toHaveLength(1);
    calls.feed?.mockRejectedValueOnce(new ActivityError('network'));
    await store.getState().refreshFeed();
    expect(store.getState().feedStatus).toBe('ready'); // still shows what it has
    expect(store.getState().feed).toHaveLength(1);
  });

  it('a first-load failure is an error; ensureFeed retries after 30 s, not before', async () => {
    calls.feed?.mockRejectedValueOnce(new ActivityError('network'));
    await store.getState().ensureFeed();
    expect(store.getState().feedStatus).toBe('error');
    await store.getState().ensureFeed();
    expect(calls.feed).toHaveBeenCalledTimes(1);
    await settle(31_000);
    await store.getState().ensureFeed();
    expect(calls.feed).toHaveBeenCalledTimes(2);
    expect(store.getState().feedStatus).toBe('ready');
  });
});

describe('expiry', () => {
  it('drops a note from the feed, from avatars and from "my note" at its end time — even if no refresh arrives', async () => {
    const { other } = otherWithNote('mine soon gone');
    await store.getState().postNote({ text: 'my own', track: null });
    await store.getState().ensureFeed();
    await store.getState().start();
    expect(store.getState().notes[other]).toBeDefined();
    expect(store.getState().notes[me]).toBeDefined();
    // the clock passes 24 h; nothing tells us, the sweep does
    vi.setSystemTime(Date.now() + 24 * HOUR + 1000);
    await settle(31_000);
    expect(store.getState().feed).toEqual([]);
    expect(store.getState().notes[other]).toBeUndefined();
    expect(store.getState().notes[me]).toBeUndefined();
    expect(store.getState().mine.note).toBeNull();
  });

  it('simulated people’s notes never expire', async () => {
    store.getState().watchNote('alex');
    await flush();
    await store.getState().start();
    vi.setSystemTime(Date.now() + 48 * HOUR);
    await settle(31_000);
    expect(store.getState().notes.alex).toBeDefined();
  });
});

describe('my note', () => {
  it('posting puts it in my feed, on my avatar and in "mine"; deleting takes it out', async () => {
    await store.getState().postNote({ text: 'hi', track: song() });
    expect(store.getState().mine.note?.text).toBe('hi');
    expect(store.getState().notes[me]?.track?.title).toBe('Night Drive');
    expect(store.getState().feed.map((i) => i.ref.ownerId)).toEqual([me]);
    await store.getState().postNote({ text: 'again', track: null });
    expect(store.getState().feed).toHaveLength(1); // replaced, not added
    const head = store.getState().feed[0];
    expect(head?.kind === 'note' && head.note.text).toBe('again');
    await store.getState().deleteNote();
    expect(store.getState().mine.note).toBeNull();
    expect(store.getState().feed).toEqual([]);
    expect(store.getState().notes[me]).toBeUndefined();
  });

  it('can change who sees notes while posting (the setting is applied first)', async () => {
    await store.getState().loadMine();
    expect(store.getState().mine.visibility).toBe('communities');
    await store.getState().postNote({ text: 'x', track: null, visibility: 'everyone' });
    expect(calls.setNotesVisibility).toHaveBeenCalledWith('everyone');
    expect(store.getState().mine.visibility).toBe('everyone');
    expect(await api.getNotesVisibility()).toBe('everyone');
  });

  it('"nobody" removes the note here too', async () => {
    await store.getState().postNote({ text: 'x', track: null });
    await store.getState().setVisibility('off');
    expect(store.getState().mine.note).toBeNull();
    expect(store.getState().feed).toEqual([]);
    expect(await code(store.getState().postNote({ text: 'y', track: null }))).toBe('not_allowed');
  });

  it('remembers the songs played lately, newest first, without repeats, at most five', () => {
    for (const t of ['a', 'b', 'c', 'd', 'e', 'f']) store.getState().noteRecent(song(t));
    store.getState().noteRecent(song('d'));
    store.getState().noteRecent(song('d'));
    store.getState().noteRecent(null);
    expect(store.getState().recent.map((t) => t.title)).toEqual(['d', 'f', 'e', 'c', 'b']);
  });
});

describe('comments', () => {
  it('loads, shows my comment at once (pending), and replaces it with the saved one', async () => {
    const { ref } = otherWithNote();
    await store.getState().ensureFeed();
    await store.getState().loadComments(ref);
    expect(store.getState().comments[refKey(ref)]).toMatchObject({ items: [], status: 'ready' });
    let release: () => void = () => {};
    const inner = raw.addComment;
    calls.addComment?.mockImplementationOnce(
      (...a: Parameters<typeof inner>) =>
        new Promise((resolve) => {
          release = () => void inner(...a).then(resolve);
        }),
    );
    const p = store.getState().addComment(ref, 'nice one', { kind: 'note', text: 'hello' });
    await flush();
    expect(store.getState().comments[refKey(ref)]?.items.map((c) => [c.body, c.id.startsWith('pending:')])).toEqual([['nice one', true]]);
    expect(store.getState().engagement[refKey(ref)]?.comments).toBe(1);
    release();
    await p;
    const items = store.getState().comments[refKey(ref)]?.items ?? [];
    expect(items.map((c) => [c.body, c.id.startsWith('pending:')])).toEqual([['nice one', false]]);
    expect(store.getState().engagement[refKey(ref)]?.comments).toBe(1);
  });

  it('a failed comment disappears and the count goes back', async () => {
    const { ref } = otherWithNote();
    await store.getState().ensureFeed();
    server.failNext = new ActivityError('rate_limited');
    expect(await code(store.getState().addComment(ref, 'nope', { kind: 'note' }))).toBe('rate_limited');
    expect(store.getState().comments[refKey(ref)]?.items).toEqual([]);
    expect(store.getState().engagement[refKey(ref)]?.comments).toBe(0);
  });

  it('deleting is optimistic and comes back if the server refuses', async () => {
    const { ref, other } = otherWithNote();
    const theirs = server.seedComment(ref, other, 'theirs'); // not mine, not my note → I may not delete it
    await store.getState().ensureFeed();
    await store.getState().loadComments(ref);
    expect(store.getState().comments[refKey(ref)]?.items).toHaveLength(1);
    expect(await code(store.getState().deleteComment(ref, theirs.id))).toBe('not_allowed');
    expect(store.getState().comments[refKey(ref)]?.items).toHaveLength(1); // put back
    expect(store.getState().engagement[refKey(ref)]?.comments).toBe(1);
    await store.getState().addComment(ref, 'mine', { kind: 'note' });
    const mine = store.getState().comments[refKey(ref)]?.items.find((c) => c.body === 'mine');
    await store.getState().deleteComment(ref, mine?.id ?? '');
    expect(store.getState().comments[refKey(ref)]?.items.map((c) => c.body)).toEqual(['theirs']);
  });

  it('pages older comments in, oldest first for display, without repeats', async () => {
    const { ref, other } = otherWithNote();
    for (let i = 0; i < 25; i++) server.seedComment(ref, other, `c${i}`, (25 - i) * 1000);
    await store.getState().loadComments(ref);
    let list = store.getState().comments[refKey(ref)];
    expect(list?.items).toHaveLength(20);
    expect(list?.more).toBe(true);
    expect(list?.items[0]?.body).toBe('c5'); // the 20 newest, shown oldest → newest
    expect(list?.items.at(-1)?.body).toBe('c24');
    await store.getState().loadMoreComments(ref);
    list = store.getState().comments[refKey(ref)];
    expect(list?.items.map((c) => c.body)).toEqual(Array.from({ length: 25 }, (_, i) => `c${i}`));
    expect(list?.more).toBe(false);
  });

  it('comments only exist under notes', async () => {
    const other = uid();
    await store.getState().loadComments({ ownerId: other, kind: 'listening', key: 'k' });
    expect(store.getState().comments[refKey({ ownerId: other, kind: 'listening', key: 'k' })]?.status).toBe('error');
  });
});

describe('messages, threads and unread counts', () => {
  const friend = uid();
  const other = uid();
  const msg = (from: string, to: string, kind: 'like' | 'comment' | 'reply', body = '', context = { kind: 'note' as const, text: 'my note' }) => {
    server.messages.push({
      id: uid(),
      senderId: from,
      recipientId: to,
      kind,
      body,
      context,
      createdAt: new Date(Date.now() + server.messages.length).toISOString(),
      readAt: null,
    });
  };

  it('counts unread per person and in total, and reading a thread zeroes it (here and on the server)', async () => {
    msg(friend, me, 'like');
    msg(friend, me, 'reply', 'hey');
    msg(other, me, 'comment', 'nice');
    msg(me, friend, 'reply', 'thanks'); // mine: never unread
    await store.getState().loadMessages();
    const messages = store.getState().messages;
    expect(unreadTotal(messages, me)).toBe(3);
    const threads = buildThreads(messages, me);
    expect(threads.map((t) => [t.personId, t.unread]).sort()).toEqual(
      [
        [friend, 2],
        [other, 1],
      ].sort(),
    );
    await store.getState().markThreadRead(friend);
    expect(unreadTotal(store.getState().messages, me)).toBe(1);
    expect(calls.markRead).toHaveBeenCalledWith({ with: friend });
    expect(sink.resolve).toHaveBeenCalledWith(`activity:${friend}:`);
    expect((await api.messages({ with: friend })).filter((m) => m.recipientId === me).every((m) => m.readAt !== null)).toBe(true);
  });

  it('a live message from someone else is stored once and announced once, in words', async () => {
    await store.getState().start();
    const note = await api.postNote({ text: 'my note', track: null });
    const friendApi = server.api(friend);
    await friendApi.like(noteRef(me, note.id), { kind: 'note', text: 'my note' });
    await settle(50);
    expect(store.getState().messages).toHaveLength(1);
    expect(sink.notice).toHaveBeenCalledTimes(1);
    expect(sink.notice.mock.calls[0]?.[0]).toMatchObject({ title: 'Maya liked your note', body: '“my note”', sub: `a:${friend}` });
    expect(sink.notice.mock.calls[0]?.[0].key).toMatch(new RegExp(`^activity:${friend}:`));
    expect(sink.toast).not.toHaveBeenCalled(); // a heart is quiet
    // the same message delivered again (a reconnect, a refetch) changes nothing
    await store.getState().loadMessages();
    expect(store.getState().messages).toHaveLength(1);
    expect(sink.notice).toHaveBeenCalledTimes(1);
  });

  it('a comment or a private reply says what was written, and tells you with a toast', async () => {
    await store.getState().start();
    const note = await api.postNote({ text: 'my note', track: null });
    const friendApi = server.api(friend);
    await friendApi.addComment(noteRef(me, note.id), 'great one', { kind: 'note', text: 'my note' });
    await settle(50);
    expect(sink.notice.mock.calls[0]?.[0]).toMatchObject({ title: 'Maya commented: great one' });
    expect(sink.toast).toHaveBeenCalledTimes(1);
    await settle(9000);
    await friendApi.sendReply(me, 'see you', null);
    await settle(50);
    expect(sink.notice.mock.calls[1]?.[0]).toMatchObject({ title: 'Maya replied: see you', body: 'A private message' });
  });

  it('what arrives while the thread is open and on screen is read as it arrives — no bell entry', async () => {
    await store.getState().start();
    await api.postNote({ text: 'x', track: null });
    store.getState().setViewing(friend);
    await server.api(friend).sendReply(me, 'hello', null);
    await settle(50);
    expect(sink.notice).not.toHaveBeenCalled();
    expect(unreadTotal(store.getState().messages, me)).toBe(0);
    expect(store.getState().messages).toHaveLength(1);
    // closed: it counts again
    store.getState().setViewing(null);
    await server.api(friend).sendReply(me, 'again', null);
    await settle(50);
    expect(sink.notice).toHaveBeenCalledTimes(1);
    expect(unreadTotal(store.getState().messages, me)).toBe(1);
  });

  it('a hidden page does not count as looking', async () => {
    await store.getState().start();
    store.getState().setViewing(friend);
    visible = false;
    await server.api(friend).sendReply(me, 'hello', null);
    await settle(50);
    expect(sink.notice).toHaveBeenCalledTimes(1);
  });

  it('a reply I send lands in the thread and is not "unread"', async () => {
    const sent = await store.getState().sendReply(friend, 'hello there', { kind: 'note', text: 'x' });
    expect(sent.senderId).toBe(me);
    expect(store.getState().messages.map((m) => m.id)).toEqual([sent.id]);
    expect(unreadTotal(store.getState().messages, me)).toBe(0);
  });

  it('loads one thread (and older pages of it) without duplicating', async () => {
    for (let i = 0; i < 130; i++) msg(friend, me, 'reply', `m${i}`);
    msg(other, me, 'reply', 'elsewhere');
    const added = await store.getState().loadThread(friend);
    expect(added).toBe(100);
    const oldest = store
      .getState()
      .messages.filter((m) => m.senderId === friend)
      .at(-1);
    const older = await store.getState().loadThread(friend, oldest?.createdAt);
    expect(older).toBe(30);
    expect(store.getState().messages.filter((m) => m.senderId === friend)).toHaveLength(130);
    expect(store.getState().messages.some((m) => m.senderId === other)).toBe(false);
  });
});

describe('simulated people never reach the database', () => {
  it('no thread request, read mark or lookup is made for an id that is not an account', async () => {
    expect(await store.getState().loadThread('alex')).toBe(0);
    await store.getState().markThreadRead('alex');
    store.getState().setViewing('alex');
    await settle(50);
    expect(calls.messages).not.toHaveBeenCalled();
    expect(calls.markRead).not.toHaveBeenCalled();
    // …and their hearts and comments go to the demo API only
    await store.getState().loadComments({ ownerId: 'alex', kind: 'note', key: 'x' });
    expect(calls.comments).not.toHaveBeenCalled();
  });
});

describe('accounts', () => {
  it('an answer that arrives after sign-out is thrown away', async () => {
    otherWithNote();
    let release: () => void = () => {};
    const inner = raw.feed;
    calls.feed?.mockImplementationOnce(
      (...a: Parameters<typeof inner>) =>
        new Promise((resolve) => {
          release = () => void inner(...a).then(resolve);
        }),
    );
    const p = store.getState().ensureFeed();
    await flush();
    store.getState().reset();
    signedIn = false;
    release();
    await p;
    expect(store.getState().feed).toEqual([]);
    expect(store.getState().feedStatus).toBe('idle');
  });

  it('start is idempotent: one subscription however often it is called', async () => {
    await store.getState().start();
    await store.getState().start();
    expect(calls.subscribe).toHaveBeenCalledTimes(1);
    store.getState().reset();
    expect(server.subs.size).toBe(0);
  });

  it('a note-changed event for me reloads my note (another device posted it)', async () => {
    await store.getState().start();
    const other = server.api(me); // the same account on another device
    await other.postNote({ text: 'from my phone', track: null });
    await settle(600);
    expect(store.getState().mine.note?.text).toBe('from my phone');
  });
});

describe('hostile data stays data', () => {
  it('names and notices are cut, not interpreted', async () => {
    const hostile = createActivityStore(() => api, {
      names: async () => '<img src=x onerror=alert(1)>'.repeat(5),
      sink: sink as unknown as ActivitySink,
    });
    await hostile.getState().start();
    const note = await api.postNote({ text: 'x', track: null });
    await server.api(uid()).like(noteRef(me, note.id), { kind: 'note', text: '<script>alert(1)</script>' });
    await settle(50);
    const n = sink.notice.mock.calls[0]?.[0] as { title: string; body: string };
    expect(n.title.length).toBeLessThan(80);
    expect(n.title).toContain('<img');
    expect(n.body).toContain('<script>'); // still just characters: the bell renders text
    hostile.getState().reset();
  });
});

describe('events', () => {
  it('ignores unknown shapes without throwing', async () => {
    await store.getState().start();
    for (const s of server.subs) s.cb({ type: 'nope' } as unknown as ActivityEvent);
    await settle(10);
    expect(store.getState().feed).toEqual([]);
  });
});
