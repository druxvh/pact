import { MotionConfig } from 'motion/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProfileCard } from '@/components/ProfileCard';
import { MemoryServer } from '@/features/community/memoryApi';
import { setCommunityApiForTesting } from '@/features/community/useCommunityStore';
import { setNowPlayingApiForTesting } from '@/features/nowplaying/hooks';
import { MemoryNowPlayingServer } from '@/features/nowplaying/memoryApi';
import { PersonAvatar } from '@/features/nowplaying/PersonAvatar';
import { coverBackground, TrackArt } from '@/features/nowplaying/TrackArt';
import type { Track } from '@/features/nowplaying/track';
import { useAuthStore } from '@/store/useAuthStore';
import { click, mount, run, type as typeInto } from '@/test/render';
import { ActivityFeed } from './ActivityFeed';
import { ActivitySettings } from './ActivitySettings';
import { ActivityThread, ActivityThreadList } from './ActivityThreads';
import { HeartButton } from './HeartButton';
import { setActivityApiForTesting, useActivityStore } from './hooks';
import { MemoryActivityServer } from './memoryApi';
import { NoteComposerHost } from './NoteComposer';
import { bubbleText, NoteBubble, NoteContent } from './NoteView';
import { usePeopleStore } from './people';
import { type Note, refKey, type SubjectRef } from './types';
import { useNoteComposer } from './ui';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const song = (over: Partial<Track> = {}): Track => ({
  title: 'Night Drive',
  artist: 'The Tests',
  album: '',
  artworkUrl: 'https://i.scdn.co/image/abc',
  trackUrl: 'https://open.spotify.com/track/abc',
  source: 'spotify',
  ...over,
});
const wait = (ms = 150) => run(() => new Promise<void>((r) => setTimeout(r, ms)));

let server: MemoryActivityServer;
let unmount: (() => Promise<void>) | null = null;
const show = async (node: Parameters<typeof mount>[0]) => {
  const m = await mount(node);
  unmount = m.unmount;
  return m.container;
};
/** What a dialog or popover put into the document body, outside the mount point. */
const bodyText = () => document.body.textContent ?? '';

beforeEach(() => {
  server = new MemoryActivityServer();
  setActivityApiForTesting(server.api(ME));
  // nothing here may reach a real server: the people and the music are in memory too
  setCommunityApiForTesting(new MemoryServer().api(ME));
  setNowPlayingApiForTesting(new MemoryNowPlayingServer().api(ME));
  useAuthStore.setState({ status: 'signedIn', user: { id: ME, email: null, provider: null, name: null } });
  useActivityStore.getState().reset();
  usePeopleStore.setState({ people: { [OTHER]: { name: 'Maya' } } });
});
afterEach(async () => {
  await unmount?.();
  unmount = null;
  document.body.innerHTML = '';
  useNoteComposer.setState({ open: false });
  useActivityStore.getState().reset();
  setActivityApiForTesting(null);
  setCommunityApiForTesting(null);
  setNowPlayingApiForTesting(null);
  useAuthStore.setState({ status: 'guest', user: null });
});

const otherNote = (text = 'hello', track: Track | null = null) => {
  const n = server.seedNote(OTHER, text, track, 60_000, 'everyone');
  return { note: n, ref: { ownerId: OTHER, kind: 'note', key: n.id } as SubjectRef };
};

describe('the cover', () => {
  it('is never a blank box: a generated cover (the player’s colour + a note) shows with no picture, and after a failed load', async () => {
    const none = await show(createElement(TrackArt, { track: song({ artworkUrl: null }), size: 84 }));
    expect(none.querySelector('img')).toBeNull();
    expect(none.querySelector('svg')).not.toBeNull();
    expect(coverBackground(song({ artworkUrl: null }))).toContain('oklch');
    await unmount?.();

    const c = await show(createElement(TrackArt, { track: song(), size: 84 }));
    // while the picture loads, the generated cover is under it
    expect(c.querySelector('img')).not.toBeNull();
    expect(c.querySelector('svg')).not.toBeNull();
    await run(() => void c.querySelector('img')?.dispatchEvent(new Event('error')));
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('svg')).not.toBeNull();
  });

  it('once the picture has loaded the glyph goes (a style that blends pictures must not show it through)', async () => {
    const c = await show(createElement(TrackArt, { track: song(), size: 84 }));
    await run(() => void c.querySelector('img')?.dispatchEvent(new Event('load')));
    expect(c.querySelector('img')).not.toBeNull();
    expect(c.querySelector('svg')).toBeNull();
  });

  it('each player has its own colour, and a hostile picture address never becomes an <img>', async () => {
    const hues = new Set<string>();
    for (const source of ['spotify', 'youtube-music', 'soundcloud', 'apple-music', 'deezer', 'tidal'] as const) {
      hues.add(/linear-gradient\(135deg, oklch\(0\.62 0\.16 ([\d.]+)\)/.exec(coverBackground(song({ artworkUrl: null, source, title: 'Same' })))?.[1] ?? '');
    }
    expect(hues.size).toBe(6);
    const bad = await show(createElement(TrackArt, { track: song({ artworkUrl: 'https://attacker.example/pixel.gif' }) }));
    expect(bad.querySelector('img')).toBeNull();
    expect(bad.innerHTML).not.toContain('attacker.example');
  });
});

describe('hearts', () => {
  const press = async (c: HTMLElement) => click(c.querySelector('button') as HTMLButtonElement);

  it('say what they are, whether you gave one, and how many — and flip at once', async () => {
    const { ref } = otherNote();
    server.seedLike(ref, uidOther());
    const c = await show(createElement(HeartButton, { subject: ref, context: { kind: 'note', text: 'hello' }, what: 'Maya’s note' }));
    await wait();
    const b = () => c.querySelector('button') as HTMLButtonElement;
    expect(b().getAttribute('aria-pressed')).toBe('false');
    expect(b().getAttribute('aria-label')).toBe('Like Maya’s note, 1 heart');
    expect(b().textContent).toBe('1');
    await press(c);
    expect(b().getAttribute('aria-pressed')).toBe('true');
    expect(b().getAttribute('aria-label')).toBe('Like Maya’s note, 2 hearts');
    expect(b().textContent).toBe('2');
    expect(c.querySelector('[data-burst]')).not.toBeNull(); // the burst plays when a heart is given
    await wait();
    expect((await server.api(ME).engagement([ref]))[refKey(ref)]).toEqual({ likes: 2, likedByMe: true, comments: 0 });
    await press(c);
    expect(b().getAttribute('aria-pressed')).toBe('false');
    expect(b().textContent).toBe('1');
  });

  it('are a number, not a button, on your own things', async () => {
    const n = await server.api(ME).postNote({ text: 'mine', track: null });
    const ref: SubjectRef = { ownerId: ME, kind: 'note', key: n.id };
    server.seedLike(ref, OTHER);
    const c = await show(createElement(HeartButton, { subject: ref, context: { kind: 'note', text: 'mine' }, what: 'your note' }));
    await wait();
    expect(c.querySelector('button')).toBeNull();
    expect(c.textContent).toContain('1');
    expect(c.textContent).toContain('hearts'.slice(0, 5)); // "heart" for screen readers
  });

  it('go back, and tell you, when the server refuses', async () => {
    const { ref } = otherNote();
    const c = await show(createElement(HeartButton, { subject: ref, context: { kind: 'note', text: 'hello' }, what: 'Maya’s note' }));
    await wait();
    server.failNext = new (await import('./types')).ActivityError('rate_limited');
    await press(c);
    await wait();
    const b = c.querySelector('button') as HTMLButtonElement;
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.textContent).toBe('');
  });

  it('do not play the burst when animations are off', async () => {
    const { ref } = otherNote();
    const c = await show(
      createElement(
        MotionConfig,
        { reducedMotion: 'always' },
        createElement(HeartButton, { subject: ref, context: { kind: 'note', text: 'hello' }, what: 'Maya’s note' }),
      ),
    );
    await wait();
    await press(c);
    expect(c.querySelector('.act-heart')?.getAttribute('data-motion')).toBe('off');
  });
});
let otherSeq = 0;
const uidOther = () => `99999999-9999-4999-8999-${String(++otherSeq).padStart(12, '0')}`;

describe('the note bubble', () => {
  const note = (over: Partial<Note> = {}): Note => ({
    id: 'n1',
    ownerId: OTHER,
    text: 'hello there',
    track: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...over,
  });

  it('shows the note as plain text, with the whole thing for screen readers, and is decoration when it is not interactive', async () => {
    const c = await show(createElement(NoteBubble, { note: note({ text: '<img src=x onerror=alert(1)>' }) }));
    expect(c.querySelectorAll('img')).toHaveLength(0);
    expect(c.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(c.querySelector('button')).toBeNull();
    expect(c.querySelector('.sr-only')?.textContent).toBe('Note: ');
    expect(c.firstElementChild?.getAttribute('title')).toBe('<img src=x onerror=alert(1)>');
  });

  it('can be a button (it opens the card), named by the note', async () => {
    const c = await show(createElement(NoteBubble, { note: note(), interactive: true }));
    const b = c.querySelector('button') as HTMLButtonElement;
    expect(b.getAttribute('aria-label')).toBe('Note: hello there');
  });

  it('a song-only note shows the song title with a music note; a note with nothing shows nothing', async () => {
    expect(bubbleText(note({ text: '', track: song() }))).toBe('Night Drive');
    const c = await show(createElement(NoteBubble, { note: note({ text: '', track: song() }) }));
    expect(c.querySelector('svg')).not.toBeNull();
    await unmount?.();
    const empty = await show(createElement(NoteBubble, { note: note({ text: '   ' }) }));
    expect(empty.innerHTML).toBe('');
  });

  it('strips invisible and bidi characters from another person’s text', async () => {
    const c = await show(createElement(NoteBubble, { note: note({ text: `ab${cp(0x202e)}cd${cp(0x200b)}ef` }) }));
    expect(c.textContent).not.toContain(cp(0x202e));
    expect(c.textContent).not.toContain(cp(0x200b));
  });

  it('is cut to 60 characters even if a bad server sent more', async () => {
    const c = await show(createElement(NoteContent, { note: note({ text: 'x'.repeat(500) }) }));
    expect(c.textContent?.length).toBe(60);
  });
});

describe('avatars and cards with notes', () => {
  it('PersonAvatar is unchanged unless a note is asked for — and then shows the simulated friends’ notes only', async () => {
    const plain = await show(createElement(PersonAvatar, { userId: 'alex', name: 'Alex' }));
    expect(plain.querySelector('.act-bubble')).toBeNull();
    await unmount?.();
    const c = await show(
      createElement(
        'div',
        null,
        createElement(PersonAvatar, { userId: 'alex', name: 'Alex', note: 'bubble' }),
        createElement(PersonAvatar, { userId: 'sam', name: 'Sam', note: 'bubble' }),
      ),
    );
    await wait();
    expect(c.querySelectorAll('.act-bubble')).toHaveLength(1);
    expect(c.querySelector('.act-bubble')?.textContent).toContain('Shipping the new onboarding today');
  });

  it('a real person’s note shows once the feed is loaded, as a tappable bubble in "tap" mode', async () => {
    otherNote('real note');
    const c = await show(createElement(PersonAvatar, { userId: OTHER, name: 'Maya', note: 'tap' }));
    await wait();
    const bubble = c.querySelector('button.act-bubble');
    expect(bubble?.getAttribute('aria-label')).toBe('Note: real note');
  });

  it('the profile card of a person with a note shows it, with its song’s cover, a heart and a reply; without a userId it is exactly what it was', async () => {
    const { ref } = otherNote('card note', song({ artworkUrl: 'https://i.scdn.co/image/xyz' }));
    server.seedLike(ref, uidOther());
    useActivityStore.getState().watchNote(OTHER);
    await wait();
    const c = await show(createElement(ProfileCard, { person: { name: 'Maya', userId: OTHER, listening: song({ title: 'Live Song' }) } }));
    await wait();
    const row = c.querySelector('[data-testid="note-row"]') as HTMLElement;
    expect(row.textContent).toContain('card note');
    expect(row.textContent).toContain('Night Drive');
    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://i.scdn.co/image/xyz');
    expect(row.querySelector('button[aria-pressed]')?.getAttribute('aria-label')).toBe('Like Maya’s note, 1 heart');
    expect(c.textContent).toContain('Reply');
    expect(c.textContent).toContain('Live Song'); // the live song too, with its own heart
    expect(c.querySelectorAll('button[aria-pressed]')).toHaveLength(2);
    await unmount?.();

    const plain = await show(createElement(ProfileCard, { person: { name: 'Zed' } }));
    expect(plain.querySelectorAll('p')).toHaveLength(1);
    expect(plain.querySelector('button')).toBeNull();
  });

  it('the same song in the note and in "listening now" is one row, not two', async () => {
    const { ref } = otherNote('x', song());
    void ref;
    useActivityStore.getState().watchNote(OTHER);
    await wait();
    const c = await show(createElement(ProfileCard, { person: { name: 'Maya', userId: OTHER, listening: song() } }));
    await wait();
    expect(c.querySelectorAll('button[aria-pressed]')).toHaveLength(1);
    expect(c.textContent).not.toContain('Listening now');
  });

  it('your own card has "Edit note" (or "Add a note"), and no heart to press on your own note', async () => {
    const c = await show(createElement(ProfileCard, { person: { name: 'Me', userId: ME } }));
    await wait();
    expect(c.textContent).toContain('Add a note');
    await unmount?.();
    await server.api(ME).postNote({ text: 'my note', track: null });
    await useActivityStore.getState().loadMine();
    const c2 = await show(createElement(ProfileCard, { person: { name: 'Me', userId: ME } }));
    await wait();
    expect(c2.textContent).toContain('Edit note');
    expect(c2.querySelector('button[aria-pressed]')).toBeNull();
  });

  it('hostile text and addresses in a card are text and nothing else', async () => {
    otherNote(
      `<script>alert(1)</script>${cp(0x202e)}`,
      song({ title: '<b>bold</b>', artworkUrl: 'https://attacker.example/p.gif', trackUrl: 'javascript:alert(1)' }),
    );
    useActivityStore.getState().watchNote(OTHER);
    await wait();
    const c = await show(createElement(ProfileCard, { person: { name: 'Maya', userId: OTHER } }));
    await wait();
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('b')).toBeNull();
    expect(c.textContent).toContain('<script>alert(1)</script>');
    expect(c.textContent).toContain('<b>bold</b>');
    expect(c.innerHTML).not.toContain('attacker.example');
    expect(c.innerHTML).not.toContain('javascript:');
    expect(c.querySelector('a')).toBeNull();
  });
});

describe('the Home feed', () => {
  it('shows a skeleton while loading, then the cards, newest first', async () => {
    otherNote('first note');
    const real = server.api(ME);
    setActivityApiForTesting({ ...real, feed: (o) => new Promise((r) => setTimeout(() => r(real.feed(o)), 150)) });
    const c = await show(createElement(ActivityFeed));
    expect(c.querySelector('[aria-label="Loading activity"]')).not.toBeNull();
    await wait(250);
    expect(c.querySelector('[aria-label="Loading activity"]')).toBeNull();
    expect(c.querySelector('article')?.getAttribute('aria-label')).toBe('Maya’s note');
    expect(c.textContent).toContain('first note');
    expect(c.textContent).toContain('Add note');
  });

  it('is calm when there is nothing: "Nothing yet — add a note"', async () => {
    const c = await show(createElement(ActivityFeed));
    await wait(250);
    expect(c.textContent).toContain('Nothing yet — add a note');
    expect(c.querySelector('article')).toBeNull();
  });

  it('says so, quietly, when the database update is missing', async () => {
    server.available = false;
    const c = await show(createElement(ActivityFeed));
    await wait(250);
    expect(c.textContent).toContain('aren’t available on this server yet');
    expect(c.textContent).not.toContain('Add note');
  });

  it('a card has a heart, comments (with a count) and a private reply; comments open inline and take new ones', async () => {
    const { ref } = otherNote('note with comments');
    server.seedComment(ref, uidOther(), 'first!');
    const c = await show(createElement(ActivityFeed));
    await wait(300);
    const toggle = c.querySelector('button[aria-expanded][aria-label^="Comments on"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe('Comments on Maya’s note, 1');
    await click(toggle);
    await wait();
    expect(c.querySelector('ul[aria-label="Comments"]')?.textContent).toContain('first!');
    const input = c.querySelector('input[placeholder="Add a comment…"]') as HTMLInputElement;
    expect(input.maxLength).toBe(200);
    await typeInto(input, 'nice one');
    await run(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await wait();
    expect(c.querySelector('ul[aria-label="Comments"]')?.textContent).toContain('nice one');
    expect(toggle.getAttribute('aria-label')).toBe('Comments on Maya’s note, 2');
    expect((await server.api(OTHER).messages()).some((m) => m.kind === 'comment' && m.body === 'nice one')).toBe(true);
    expect(c.textContent).toContain('Reply privately');
  });

  it('a private reply is capped at 500 characters and goes to their inbox', async () => {
    otherNote('reply to me');
    const c = await show(createElement(ActivityFeed));
    await wait(300);
    const open = [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('Reply privately')) as HTMLButtonElement;
    await click(open);
    const field = c.querySelector('textarea') as HTMLTextAreaElement;
    expect(field.maxLength).toBe(500);
    await typeInto(field, 'thanks for the note');
    await click([...c.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Send') as HTMLButtonElement);
    await wait();
    const inbox = await server.api(OTHER).messages();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'reply', body: 'thanks for the note', senderId: ME });
  });

  it('"Load more" brings the next 40, and goes away at the end', async () => {
    const ids = Array.from({ length: 45 }, () => uidOther());
    ids.forEach((id, i) => void server.seedNote(id, `note ${i}`, null, (50 - i) * 1000, 'everyone'));
    usePeopleStore.setState({ people: Object.fromEntries(ids.map((id) => [id, { name: 'Someone I know' }])) });
    const c = await show(createElement(ActivityFeed));
    await wait(400);
    expect(c.querySelectorAll('article')).toHaveLength(40);
    const more = [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('Load more')) as HTMLButtonElement;
    await click(more);
    await wait(300);
    expect(c.querySelectorAll('article')).toHaveLength(45);
    expect([...c.querySelectorAll('button')].some((b) => b.textContent?.includes('Load more'))).toBe(false);
  }, 30_000);

  it('leaves out notes from people we can’t name (a stranger’s profile isn’t readable) instead of showing "Unknown"', async () => {
    const STRANGER = '55555555-5555-4555-8555-555555555555';
    server.seedNote(STRANGER, 'from a stranger', null, 1000, 'everyone');
    otherNote('from someone I can name');
    const c = await show(createElement(ActivityFeed));
    await wait(400);
    expect(c.textContent).toContain('from someone I can name');
    expect(c.textContent).not.toContain('from a stranger');
    expect(c.textContent).not.toContain('Someone');
    expect(c.querySelectorAll('article')).toHaveLength(1);
  });

  it('when nobody in the feed can be named, it is the calm empty state, not a list of unknowns', async () => {
    server.seedNote('55555555-5555-4555-8555-555555555555', 'from a stranger', null, 1000, 'everyone');
    const c = await show(createElement(ActivityFeed));
    await wait(400);
    expect(c.querySelector('article')).toBeNull();
    expect(c.textContent).toContain('Nothing yet — add a note');
  });

  it('your own note says "(you)" and how long it has left', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { id: ME, email: null, provider: null, name: null } });
    await server.api(ME).postNote({ text: 'mine', track: null });
    await useActivityStore.getState().loadMine();
    const c = await show(createElement(ActivityFeed));
    await wait(300);
    expect(c.textContent).toContain('(you)');
    expect(c.textContent).toContain('23h left');
    expect(c.textContent).toContain('Edit note');
  });
});

describe('the note composer', () => {
  const open = async () => {
    const c = await show(createElement(NoteComposerHost));
    await run(() => useNoteComposer.setState({ open: true }));
    await wait();
    return c;
  };
  const field = () => document.body.querySelector('input[placeholder="Heads down until 3, then pizza"]') as HTMLInputElement;

  it('counts characters live, stops at 60, and shows how long a note lives', async () => {
    await open();
    expect(field().maxLength).toBe(60);
    await typeInto(field(), 'hello');
    expect(bodyText()).toContain('5/60');
    expect(bodyText()).toContain('Visible for 24 hours');
    expect(bodyText()).toContain('Who can see it');
  });

  it('shares the note with its song (from what is played lately) and the chosen audience', async () => {
    useActivityStore.getState().noteRecent(song({ title: 'Recent Song' }));
    await open();
    await typeInto(field(), 'hi there');
    const choice = [...document.body.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent?.includes('Recent Song')) as HTMLButtonElement;
    await click(choice);
    expect(choice.getAttribute('aria-pressed')).toBe('true');
    await click([...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Share note') as HTMLButtonElement);
    await wait();
    const mine = await server.api(ME).getMyNote();
    expect(mine?.text).toBe('hi there');
    expect(mine?.track?.title).toBe('Recent Song');
    expect(useNoteComposer.getState().open).toBe(false);
  });

  it('cannot share nothing, and cannot share while the audience is "Nobody"', async () => {
    await open();
    const share = () => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Share note') as HTMLButtonElement;
    expect(share().disabled).toBe(true);
    await typeInto(field(), 'something');
    expect(share().disabled).toBe(false);
  });

  it('explains calmly when notes aren’t available on this server yet', async () => {
    server.available = false;
    await open();
    expect(bodyText()).toContain('Notes aren’t available on this server yet');
    expect(field()).toBeNull();
  });

  it('starts from the current note, and can delete it', async () => {
    await server.api(ME).postNote({ text: 'old note', track: null });
    await useActivityStore.getState().loadMine();
    await open();
    expect(field().value).toBe('old note');
    expect(bodyText()).toContain('Your current note has');
    expect(bodyText()).toContain('Delete note');
  });
});

describe('Settings', () => {
  it('shows who sees notes and the current note', async () => {
    await server.api(ME).postNote({ text: 'settings note', track: null });
    const c = await show(createElement(ActivitySettings));
    await wait();
    expect(c.textContent).toContain('Who can see my notes');
    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(c.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('My communities');
    expect(c.textContent).toContain('settings note');
    expect(c.textContent).toContain('Edit note');
  });

  it('explains — and disables the controls — when the database update is missing', async () => {
    server.available = false;
    const c = await show(createElement(ActivitySettings));
    await wait();
    expect(c.textContent).toContain('aren’t available on this server yet');
    expect([...c.querySelectorAll('button')].find((b) => b.textContent?.includes('Add note'))?.hasAttribute('disabled')).toBe(true);
  });
});

describe('threads in Direct messages', () => {
  const dispatch = async () => {
    // Maya likes my song and replies about my note; she commented too.
    const note = await server.api(ME).postNote({ text: 'my note', track: song({ title: 'Pinned Song' }) });
    const other = server.api(OTHER);
    const ref: SubjectRef = { ownerId: ME, kind: 'note', key: note.id };
    await other.like(ref, { kind: 'note', text: 'my note', track: song({ title: 'Pinned Song' }) });
    await other.like({ ownerId: ME, kind: 'listening', key: 'k' }, { kind: 'listening', track: song({ title: 'Live One' }) });
    await other.addComment(ref, 'love it', { kind: 'note', text: 'my note' });
    await other.sendReply(ME, 'see you later', { kind: 'note', text: 'my note' });
    await useActivityStore.getState().loadMessages();
  };

  it('the list has one entry per person, with an unread count and the last message', async () => {
    await dispatch();
    const c = await show(createElement(ActivityThreadList, { activeId: null, onSelect: () => {}, search: '' }));
    const rows = c.querySelectorAll('li button');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Maya');
    expect(rows[0]?.textContent).toContain('see you later');
    expect(rows[0]?.textContent).toContain('4 unread');
    expect(c.textContent).toContain('Notes & songs');
  });

  it('shows nothing at all with no messages, and the search filters by name', async () => {
    const empty = await show(createElement(ActivityThreadList, { activeId: null, onSelect: () => {}, search: '' }));
    expect(empty.innerHTML).toBe('');
    await unmount?.();
    await dispatch();
    const c = await show(createElement(ActivityThreadList, { activeId: null, onSelect: () => {}, search: 'zzz' }));
    expect(c.innerHTML).toBe('');
  });

  it('a thread shows each message with a card of what it was about — the liked song’s cover and title, the quoted note, the heart — and marks it read', async () => {
    await dispatch();
    expect(useActivityStore.getState().messages.filter((m) => !m.readAt)).toHaveLength(4);
    const c = await show(createElement(ActivityThread, { personId: OTHER }));
    await wait(300);
    const text = c.textContent ?? '';
    expect(text).toContain('Maya liked your note');
    expect(text).toContain('Maya liked your song');
    expect(text).toContain('Pinned Song');
    expect(text).toContain('Live One');
    expect(text).toContain('love it');
    expect(text).toContain('see you later');
    expect(text).toContain('Likes, comments and private replies about notes and songs');
    expect(c.querySelectorAll('[data-context="note"]').length).toBeGreaterThanOrEqual(2);
    expect(c.querySelectorAll('[data-track-art]').length).toBeGreaterThanOrEqual(2);
    expect(c.querySelector('svg.fill-current')).not.toBeNull(); // the heart marker
    expect(useActivityStore.getState().messages.filter((m) => !m.readAt)).toHaveLength(0);
  });

  it('sends a reply from the thread', async () => {
    await dispatch();
    const c = await show(createElement(ActivityThread, { personId: OTHER }));
    await wait(300);
    const box = c.querySelector('textarea') as HTMLTextAreaElement;
    expect(box.maxLength).toBe(500);
    await typeInto(box, 'on my way');
    await click(c.querySelector('button[type="submit"]') as HTMLButtonElement);
    await wait();
    expect((await server.api(OTHER).messages({ with: ME })).some((m) => m.body === 'on my way')).toBe(true);
    expect(c.textContent).toContain('on my way');
  });

  it('hostile text in a message is just text', async () => {
    await server.api(ME).postNote({ text: 'x', track: null });
    server.messages.push({
      id: 'm-bad',
      senderId: OTHER,
      recipientId: ME,
      kind: 'reply',
      body: '<img src=x onerror=alert(1)>',
      context: {
        kind: 'listening',
        track: song({ title: '<b>t</b>', artworkUrl: 'https://attacker.example/p.gif', trackUrl: 'javascript:alert(1)' }),
        text: '<script>x</script>',
      },
      createdAt: new Date().toISOString(),
      readAt: null,
    });
    await useActivityStore.getState().loadMessages();
    const c = await show(createElement(ActivityThread, { personId: OTHER }));
    await wait(200);
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('b')).toBeNull();
    expect(c.querySelectorAll('img').length).toBe(0);
    expect(c.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(c.innerHTML).not.toContain('attacker.example');
    expect(c.querySelector('a')).toBeNull();
  });
});
