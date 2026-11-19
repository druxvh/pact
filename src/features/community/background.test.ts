import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotificationStore } from '@/store/useNotificationStore';
import { MemoryServer } from './memoryApi';
import {
  type CommunityNotice,
  channelKey,
  communityKey,
  communityLink,
  communityLinkFromSub,
  describeMessage,
  mentionKey,
  mentionsUser,
  type NotificationSink,
  totalCommunityUnread,
} from './notifications';
import { createCommunityPrefsStore } from './prefs';
import { communityUnread, createCommunityStore } from './store';
import { createTitleBadge, stripBadge, withBadge } from './titleBadge';

const flush = () => new Promise((r) => setTimeout(r, 0));
let n = 0;

const setVisibility = (state: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });

describe('community activity, app-wide (unread, notifications, mute)', () => {
  let server: MemoryServer;
  let alice: string;
  let bob: string;
  let carol: string;
  let cid: string;
  let general: string;
  let memes: string;
  let C: ReturnType<typeof createCommunityStore>;
  let prefs: ReturnType<typeof createCommunityPrefsStore>;
  let upserts: CommunityNotice[];
  let resolved: string[];
  let toasts: Array<{ title: string; body: string; sub: string }>;
  const sink: NotificationSink = {
    upsert: (x) => void upserts.push(x),
    resolve: (p) => void resolved.push(p),
    toast: (t) => void toasts.push(t),
  };
  const post = (who: string, body: string, channelId = general, replyTo: string | null = null) =>
    server.api(who).sendMessage({ communityId: cid, channelId, body, attachments: [], replyTo });

  beforeEach(async () => {
    localStorage.clear();
    setVisibility('visible');
    upserts = [];
    resolved = [];
    toasts = [];
    server = new MemoryServer();
    alice = server.addUser('alice', 'Alice A');
    bob = server.addUser('bob', 'Bob B');
    carol = server.addUser('carol', 'Carol C');
    cid = await server.api(alice).createCommunity({ name: 'Pact Club', description: '', hue: 200 });
    const inv = await server.api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
    await server.api(bob).joinCommunity(inv.code);
    await server.api(carol).joinCommunity(inv.code);
    general = (await server.api(alice).listChannels(cid))[0]?.id as string;
    memes = (await server.api(alice).createChannel(cid, 'memes', '')).id;
    prefs = createCommunityPrefsStore(`test-prefs-${n++}`);
    // carol never opens the Chat tab: only the app-wide feed runs
    C = createCommunityStore(() => server.api(carol), { prefs, sink });
    await C.getState().startActivity();
  });

  afterEach(() => {
    C.getState().reset();
    setVisibility('visible');
  });

  describe('the subscription', () => {
    it('is one subscription however often it is started, survives the Communities view closing, and stops on demand', async () => {
      expect(server.activitySubs.size).toBe(1);
      await C.getState().startActivity();
      await C.getState().startActivity();
      await C.getState().init(); // the view opening: no second channel
      expect(server.activitySubs.size).toBe(1);
      C.getState().dispose(); // the view closing: the feed keeps running
      expect(server.activitySubs.size).toBe(1);
      expect(C.getState().activityOn).toBe(true);
      C.getState().stopActivity();
      expect(server.activitySubs.size).toBe(0);
      expect(C.getState().activityOn).toBe(false);
      await C.getState().startActivity(); // and can be started again
      expect(server.activitySubs.size).toBe(1);
    });

    it('reset (sign-out or another account) stops it and forgets everything', async () => {
      await post(alice, 'hello');
      await vi.waitFor(() => expect(communityUnread(C.getState().unread, cid)).toBe(1));
      C.getState().reset();
      expect(server.activitySubs.size).toBe(0);
      expect(C.getState().unread).toEqual({});
      expect(C.getState().communities).toEqual([]);
      expect(C.getState().ready).toBe(false);
      // a different account starts clean: no duplicate subscription, nothing inherited
      const bobStore = createCommunityStore(() => server.api(bob), { prefs, sink });
      await bobStore.getState().startActivity();
      expect(server.activitySubs.size).toBe(1); // bob's own — carol's is gone, nothing doubled up
      bobStore.getState().reset();
      expect(server.activitySubs.size).toBe(0);
    });

    it('an answer that arrives after an account switch is dropped, not shown to the next account', async () => {
      await post(alice, 'unread for carol');
      C.getState().reset();
      const base = server.api(carol);
      const slow = Object.create(base, {
        unreadCounts: {
          value: async () => {
            const rows = await base.unreadCounts();
            await new Promise((r) => setTimeout(r, 15));
            return rows;
          },
        },
      });
      const store = createCommunityStore(() => slow, { prefs, sink });
      const pending = store.getState().refreshUnread();
      store.getState().reset(); // the account switched while the request was in flight
      await pending;
      expect(store.getState().unread).toEqual({});
    });

    it('unread counts are there from the start, before any view loaded anything', async () => {
      await post(alice, 'while you were away');
      C.getState().reset();
      const fresh = createCommunityStore(() => server.api(carol), { prefs, sink });
      await fresh.getState().startActivity();
      expect(communityUnread(fresh.getState().unread, cid)).toBe(1);
      fresh.getState().reset();
    });
  });

  describe('notifications', () => {
    it('a message in a channel you are not looking at raises unread and one quiet entry per channel that keeps counting', async () => {
      await post(alice, 'first one');
      await vi.waitFor(() => expect(upserts).toHaveLength(1));
      expect(C.getState().unread[general]?.count).toBe(1);
      expect(upserts[0]).toEqual({
        key: channelKey(cid, general),
        title: 'Pact Club · #general',
        body: 'Alice A: first one',
        sub: communityLink(cid, general),
      });
      await post(bob, 'second one');
      await vi.waitFor(() => expect(upserts).toHaveLength(2));
      expect(upserts[1]).toMatchObject({ key: channelKey(cid, general), body: '2 new messages — Bob B: second one' }); // same key → replaces the entry
      await post(alice, 'in another channel', memes);
      await vi.waitFor(() => expect(upserts).toHaveLength(3));
      expect(upserts[2]).toMatchObject({ key: channelKey(cid, memes), title: 'Pact Club · #memes' });
      expect(toasts).toEqual([]); // ordinary messages never toast
    });

    it('describes attachments and GIFs sensibly', () => {
      expect(describeMessage('Ana', 'see you at 5', false)).toBe('Ana: see you at 5');
      expect(describeMessage('Ana', '', true)).toBe('Ana sent an attachment');
      expect(describeMessage('Ana', 'https://media.giphy.com/media/abc/giphy.gif', false)).toBe('Ana sent a GIF');
      expect(describeMessage('Ana', `${'x'.repeat(200)}`, false)).toHaveLength('Ana: '.length + 90);
      expect(describeMessage('Ana', 'a\n\n  b', false)).toBe('Ana: a b');
    });

    it('your own messages never notify, for you or from another device', async () => {
      await post(carol, 'my own words');
      await flush();
      expect(upserts).toEqual([]);
      expect(C.getState().unread).toEqual({});
    });

    it('a reply to you or an @mention of your @username gets its own entry and a toast; nothing else toasts', async () => {
      const mine = await post(carol, 'my message');
      await post(alice, 'unrelated');
      await vi.waitFor(() => expect(upserts).toHaveLength(1));
      expect(toasts).toEqual([]);

      const reply = await post(alice, 'agreed!', general, mine.id);
      await vi.waitFor(() => expect(toasts).toHaveLength(1));
      expect(toasts[0]).toEqual({ title: 'Alice A replied to you', body: '#general · Pact Club: agreed!', sub: communityLink(cid, general) });
      expect(upserts.some((u) => u.key === mentionKey(cid, general, reply.id))).toBe(true);

      await post(bob, 'a reply to somebody else', general, (await post(alice, 'alice says')).id);
      await flush();
      await flush();
      expect(toasts).toHaveLength(1);
    });

    it('mentions: case-insensitive, whole usernames only, throttled to one toast per channel in a burst (but each gets its entry)', async () => {
      await post(bob, 'hey @CAROL are you there?');
      await vi.waitFor(() => expect(toasts).toHaveLength(1));
      expect(toasts[0]?.title).toBe('Bob B mentioned you');
      const burst = await post(bob, 'psst @carol again');
      await vi.waitFor(() => expect(upserts.some((u) => u.key === mentionKey(cid, general, burst.id))).toBe(true));
      expect(toasts).toHaveLength(1);
      await post(bob, 'hello @carolina and carol@example.com');
      await flush();
      await flush();
      expect(toasts).toHaveLength(1);
      expect(upserts.filter((u) => u.key.includes(':m:'))).toHaveLength(2);
    });

    it('no toast while the window is hidden (the entry is still there)', async () => {
      setVisibility('hidden');
      await post(bob, '@carol ping');
      await vi.waitFor(() => expect(upserts.some((u) => u.key.includes(':m:'))).toBe(true));
      expect(toasts).toEqual([]);
      expect(C.getState().unread[general]?.count).toBe(1);
    });

    it('a channel you are looking at is read as it arrives — unless the window is hidden', async () => {
      await C.getState().init(); // the view opens #general
      C.getState().setReading(true);
      await post(alice, 'right in front of you');
      await flush();
      expect(C.getState().unread[general]).toBeUndefined();
      expect(upserts).toEqual([]);
      setVisibility('hidden');
      await post(alice, 'while the tab is in the background');
      await vi.waitFor(() => expect(C.getState().unread[general]?.count).toBe(1));
      await vi.waitFor(() => expect(upserts).toHaveLength(1));
    });

    it('closing the Communities view leaves you "not looking": messages count and notify again', async () => {
      await C.getState().init();
      C.getState().setReading(true);
      C.getState().dispose();
      C.getState().setReading(false); // what MessagePane does when it unmounts
      await post(alice, 'anyone?');
      await vi.waitFor(() => expect(upserts).toHaveLength(1));
      expect(C.getState().unread[general]?.count).toBe(1);
    });

    it('reading a channel resolves its notification entries; reading it on another device does too', async () => {
      await post(alice, 'one');
      await post(alice, 'two', memes);
      await vi.waitFor(() => expect(upserts).toHaveLength(2));
      await C.getState().selectChannel(general); // opens + marks read
      await C.getState().init();
      expect(resolved).toContain(channelKey(cid, general));
      expect(C.getState().unread[general]).toBeUndefined();
      // read #memes on another device: the next sync clears it here
      await server.api(carol).markRead({ id: memes, communityId: cid }, server.clock());
      await C.getState().refreshUnread();
      expect(resolved).toContain(channelKey(cid, memes));
      expect(C.getState().unread[memes]).toBeUndefined();
    });
  });

  describe('muting a community (this device only)', () => {
    it('a muted community still counts but never notifies or toasts, and is left out of the badge', async () => {
      prefs.getState().setMuted(cid, true);
      await post(bob, '@carol please look');
      await vi.waitFor(() => expect(C.getState().unread[general]?.count).toBe(1));
      await flush();
      await flush();
      expect(upserts).toEqual([]);
      expect(toasts).toEqual([]);
      expect(totalCommunityUnread(C.getState().unread, prefs.getState().muted)).toBe(0);
      prefs.getState().setMuted(cid, false); // unmuting shows the truth
      expect(totalCommunityUnread(C.getState().unread, prefs.getState().muted)).toBe(1);
    });

    it('muting marks the community’s existing notification entries read', () => {
      C.getState().noteMuteChanged(cid, true);
      expect(resolved).toEqual([communityKey(cid)]);
      C.getState().noteMuteChanged(cid, false);
      expect(resolved).toHaveLength(1);
    });

    it('the mute list persists, and is per community', () => {
      const key = `test-prefs-persist-${n++}`;
      const a = createCommunityPrefsStore(key);
      a.getState().setMuted('c1', true);
      a.getState().setMuted('c2', true);
      a.getState().setMuted('c1', false);
      expect(JSON.parse(localStorage.getItem(key) as string).state.muted).toEqual({ c2: true });
      expect(createCommunityPrefsStore(key).getState().muted).toEqual({ c2: true });
    });
  });

  describe('the Chat badge', () => {
    it('sums unread across communities, leaving muted ones out', () => {
      const unread = { a: { communityId: 'x', count: 3 }, b: { communityId: 'x', count: 2 }, c: { communityId: 'y', count: 4 } };
      expect(totalCommunityUnread(unread, {})).toBe(9);
      expect(totalCommunityUnread(unread, { x: true })).toBe(4);
      expect(totalCommunityUnread(unread, { x: true, y: true })).toBe(0);
      expect(totalCommunityUnread({}, {})).toBe(0);
    });
  });
});

describe('notification helpers', () => {
  it('@mentions need the whole username, not part of a longer name or an email address', () => {
    expect(mentionsUser('hi @carol!', 'carol')).toBe(true);
    expect(mentionsUser('@Carol hi', 'carol')).toBe(true);
    expect(mentionsUser('(@carol)', 'carol')).toBe(true);
    expect(mentionsUser('hi @carolina', 'carol')).toBe(false);
    expect(mentionsUser('mail carol@carol.com', 'carol')).toBe(false);
    expect(mentionsUser('hi carol', 'carol')).toBe(false);
    expect(mentionsUser('@@carol', 'carol')).toBe(false);
    expect(mentionsUser('hi @carol', undefined)).toBe(false);
    expect(mentionsUser('hi @a.b', 'a.b')).toBe(true); // regex characters in a name are literal
    expect(mentionsUser('hi @axb', 'a.b')).toBe(false);
  });

  it('notification links round-trip and refuse anything else', () => {
    const c = crypto.randomUUID();
    const ch = crypto.randomUUID();
    expect(communityLinkFromSub(communityLink(c, ch))).toEqual({ communityId: c, channelId: ch });
    expect(communityLinkFromSub(communityLink(c.toUpperCase(), ch))).toEqual({ communityId: c, channelId: ch });
    expect(communityLinkFromSub(`join:${'a'.repeat(16)}`)).toBeNull();
    expect(communityLinkFromSub(`c:${c}`)).toBeNull();
    expect(communityLinkFromSub(`c:x:y`)).toBeNull();
    expect(communityLinkFromSub(null)).toBeNull();
  });
});

describe('the notification centre entries (one per key)', () => {
  beforeEach(() => useNotificationStore.setState({ notifications: [] }));

  it('upsert replaces the entry with the same key, brings it to the top and makes it unread again', () => {
    const s = useNotificationStore.getState();
    const a = s.upsert('chat:c:1', { title: 'One', body: '1 new', kind: 'chat' });
    s.add({ title: 'Other', body: 'x', kind: 'system' });
    s.markRead(a);
    const again = useNotificationStore.getState().upsert('chat:c:1', { title: 'One', body: '2 new', kind: 'chat' });
    const list = useNotificationStore.getState().notifications;
    expect(again).toBe(a);
    expect(list.map((x) => [x.title, x.body, x.read])).toEqual([
      ['One', '2 new', false],
      ['Other', 'x', false],
    ]);
  });

  it('markReadByKey marks every entry under a prefix and leaves the rest', () => {
    const s = useNotificationStore.getState();
    s.upsert('chat:c1:ch1', { title: 'a', body: '' });
    s.upsert('chat:c1:ch1:m:9', { title: 'b', body: '' });
    s.upsert('chat:c1:ch2', { title: 'c', body: '' });
    s.upsert('chat:c2:ch1', { title: 'd', body: '' });
    useNotificationStore.getState().markReadByKey('chat:c1:ch1');
    expect(
      useNotificationStore
        .getState()
        .notifications.map((x) => [x.title, x.read])
        .sort(),
    ).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
      ['d', false],
    ]);
    useNotificationStore.getState().markReadByKey('chat:c1:');
    expect(
      useNotificationStore
        .getState()
        .notifications.filter((x) => !x.read)
        .map((x) => x.title),
    ).toEqual(['d']);
  });

  it('keeps at most 50 entries', () => {
    const s = useNotificationStore.getState();
    for (let i = 0; i < 60; i++) s.upsert(`k${i}`, { title: `${i}`, body: '' });
    expect(useNotificationStore.getState().notifications).toHaveLength(50);
  });
});

describe('the unread count in the tab title', () => {
  beforeEach(() => {
    document.title = 'Chat · pact';
  });

  it('adds and strips a prefix, capped at 99+', () => {
    expect(withBadge('Chat · pact', 3)).toBe('(3) Chat · pact');
    expect(withBadge('(3) Chat · pact', 4)).toBe('(4) Chat · pact');
    expect(withBadge('(3) Chat · pact', 0)).toBe('Chat · pact');
    expect(withBadge('Chat · pact', 250)).toBe('(99+) Chat · pact');
    expect(stripBadge('(99+) x')).toBe('x');
    expect(stripBadge('(not a count) x')).toBe('(not a count) x');
    expect(stripBadge('(12)x')).toBe('(12)x');
  });

  it('shows only when asked to, and puts the title back exactly as it was', () => {
    const badge = createTitleBadge();
    badge.set(3, false);
    expect(document.title).toBe('Chat · pact');
    badge.set(3, true);
    expect(document.title).toBe('(3) Chat · pact');
    badge.set(5, true);
    expect(document.title).toBe('(5) Chat · pact');
    badge.set(0, true);
    expect(document.title).toBe('Chat · pact');
    badge.set(2, true);
    badge.stop();
    expect(document.title).toBe('Chat · pact');
  });

  it('coexists with whoever else writes the title (a focus timer rewriting it every second, a section change)', async () => {
    const badge = createTitleBadge();
    badge.set(2, true);
    expect(document.title).toBe('(2) Chat · pact');
    // TimerEngine overwrites the whole title: the prefix is put back, and the timer's text is never lost
    document.title = '24:59 · Focus — pact';
    await vi.waitFor(() => expect(document.title).toBe('(2) 24:59 · Focus — pact'));
    document.title = '24:58 · Focus — pact';
    await vi.waitFor(() => expect(document.title).toBe('(2) 24:58 · Focus — pact'));
    // AppShell switches section
    document.title = 'Notes · pact';
    await vi.waitFor(() => expect(document.title).toBe('(2) Notes · pact'));
    // the count drops to zero: someone else's title is left as they wrote it
    badge.set(0, true);
    expect(document.title).toBe('Notes · pact');
    document.title = '24:57 · Focus — pact';
    await flush();
    await flush();
    expect(document.title).toBe('24:57 · Focus — pact');
    badge.stop();
  });

  it('after stop() nobody is decorating any more', async () => {
    const badge = createTitleBadge();
    badge.set(2, true);
    badge.stop();
    document.title = 'Home';
    await flush();
    await flush();
    expect(document.title).toBe('Home');
  });
});
