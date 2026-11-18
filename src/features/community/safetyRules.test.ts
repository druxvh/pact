import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryServer } from './memoryApi';
import { createCommunityStore, myMembership } from './store';
import { CommunityError } from './types';

const flush = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The same rules supabase/tests/rls.mjs checks against the real migrations, checked against the in-memory twin. */
describe('safety rules (slowmode, timeouts, bans list, admin transfer)', () => {
  let server: MemoryServer;
  let alice: string; // admin
  let bob: string; // moderator
  let mia: string; // second moderator
  let carol: string; // member
  let dave: string; // member
  let erin: string; // outsider
  let cid: string;
  let general: string;
  let A: ReturnType<typeof createCommunityStore>;
  let C: ReturnType<typeof createCommunityStore>;
  const api = (u: string) => server.api(u);
  const say = (u: string, body: string, channel = general) =>
    api(u).sendMessage({ communityId: cid, channelId: channel, body, attachments: [], replyTo: null });

  beforeEach(async () => {
    localStorage.clear();
    server = new MemoryServer();
    alice = server.addUser('alice', 'Alice A');
    bob = server.addUser('bob', 'Bob B');
    mia = server.addUser('mia', 'Mia M');
    carol = server.addUser('carol', 'Carol C');
    dave = server.addUser('dave', 'Dave D');
    erin = server.addUser('erin', 'Erin E');
    cid = await api(alice).createCommunity({ name: 'Pact Club', description: '', hue: 200 });
    const inv = await api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
    for (const u of [bob, mia, carol, dave]) await api(u).joinCommunity(inv.code);
    await api(alice).setRole(cid, bob, 'mod');
    await api(alice).setRole(cid, mia, 'mod');
    general = (await api(alice).listChannels(cid))[0]?.id as string;
    A = createCommunityStore(() => api(alice));
    C = createCommunityStore(() => api(carol));
    await A.getState().init();
    await C.getState().init();
  });

  describe('slowmode', () => {
    it('moderators and the admin set it; members and outsiders cannot; it has a range', async () => {
      expect((await api(bob).setSlowmode(general, 30)).slowmodeSeconds).toBe(30);
      expect((await api(alice).setSlowmode(general, 5)).slowmodeSeconds).toBe(5);
      await expect(api(carol).setSlowmode(general, 5)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(erin).setSlowmode(general, 5)).rejects.toMatchObject({ code: 'not_found' });
      await expect(api(alice).setSlowmode(general, 21601)).rejects.toBeInstanceOf(CommunityError);
      await expect(api(alice).setSlowmode(general, -1)).rejects.toBeInstanceOf(CommunityError);
      expect((await api(alice).setSlowmode(general, 21600)).slowmodeSeconds).toBe(21600);
      expect((await api(carol).listChannels(cid))[0]?.slowmodeSeconds).toBe(21600);
    });

    it('a member must wait between messages (the error says how long); other people, other channels, and moderators are not held back', async () => {
      const memes = await api(alice).createChannel(cid, 'memes', '');
      await api(alice).setSlowmode(general, 30);
      await say(carol, 'first');
      const err = await say(carol, 'second').catch((e) => e);
      expect(err).toBeInstanceOf(CommunityError);
      expect(err).toMatchObject({ code: 'slowmode' });
      expect(err.detail.seconds).toBeGreaterThanOrEqual(29);
      expect(err.detail.seconds).toBeLessThanOrEqual(30);
      await say(dave, 'a different member');
      await say(carol, 'another channel', memes.id);
      await say(bob, 'mod one');
      await say(bob, 'mod two');
      await say(alice, 'admin one');
      await say(alice, 'admin two');
      expect(server.messages.filter((m) => m.authorId === carol)).toHaveLength(2);
    });

    it('deleting the message that started the clock does not reset it; reactions are not slowed; turning it off frees you', async () => {
      await api(alice).setSlowmode(general, 60);
      const first = await say(carol, 'first');
      await api(carol).deleteMessage(first.id);
      await expect(say(carol, 'again')).rejects.toMatchObject({ code: 'slowmode' });
      await api(carol).addReaction({ id: first.id, communityId: cid }, '👍');
      await api(alice).setSlowmode(general, 0);
      await say(carol, 'free');
    });

    it('a short slowmode ends by itself', async () => {
      await api(alice).setSlowmode(general, 1);
      await say(carol, 'one');
      await expect(say(carol, 'two')).rejects.toMatchObject({ code: 'slowmode' });
      await sleep(1100);
      await say(carol, 'two');
    });

    it('the store starts a cooldown after a send and obeys the server’s answer if its own sum was wrong', async () => {
      await api(alice).setSlowmode(general, 30);
      await C.getState().refreshChannels();
      await C.getState().send('hello', []);
      const cd = C.getState().cooldownUntil[general] as number;
      expect(cd).toBeGreaterThan(Date.now() + 28_000);
      expect(cd).toBeLessThanOrEqual(Date.now() + 30_000);
      // pretend we forgot (e.g. another tab sent): the server still says no, and says for how long
      C.setState({ cooldownUntil: {} });
      await expect(C.getState().send('too fast', [])).rejects.toMatchObject({ code: 'slowmode' });
      expect(C.getState().cooldownUntil[general]).toBeGreaterThan(Date.now() + 25_000);
    });

    it('a moderator who sends gets no cooldown', async () => {
      await api(alice).setSlowmode(general, 30);
      await A.getState().refreshChannels();
      await A.getState().send('hello', []);
      expect(A.getState().cooldownUntil[general]).toBeDefined(); // the store notes it …
      // … but the composer ignores it for moderators (see slowmodeRemainingMs `exempt`), and the server never refuses them
      await A.getState().send('again', []);
    });

    it('the store updates the channel when slowmode changes (and others see it live)', async () => {
      await A.getState().setSlowmode(general, 10);
      expect(A.getState().channels[cid]?.[0]?.slowmodeSeconds).toBe(10);
      await flush();
      expect(C.getState().channels[cid]?.[0]?.slowmodeSeconds).toBe(10);
    });
  });

  describe('timeouts', () => {
    it('a timed-out member can still read but cannot post or react; the error says when it ends', async () => {
      const m = await say(dave, 'hello');
      const until = await api(bob).timeoutMember(cid, carol, 3600);
      expect(Date.parse(until as string)).toBeGreaterThan(Date.now() + 3_500_000);
      expect((await api(carol).listMessages(general, { limit: 10 })).length).toBe(1);
      const err = await say(carol, 'let me talk').catch((e) => e);
      expect(err).toMatchObject({ code: 'timed_out', detail: { until } });
      await expect(api(carol).addReaction({ id: m.id, communityId: cid }, '🔥')).rejects.toMatchObject({ code: 'timed_out' });
      await say(dave, 'others are unaffected');
      await flush();
      expect(myMembership(A.getState(), cid, carol)?.timeoutUntil).toBe(until); // the others' member lists update live
    });

    it('the store notices a timeout it did not know about, and shows it on the member', async () => {
      await api(bob).timeoutMember(cid, carol, 600);
      await expect(C.getState().send('hi', [])).rejects.toMatchObject({ code: 'timed_out' });
      await flush();
      expect(myMembership(C.getState(), cid, carol)?.timeoutUntil).not.toBeNull();
      await A.getState().refreshMembers();
      expect(myMembership(A.getState(), cid, carol)?.timeoutUntil).not.toBeNull();
      await api(bob).timeoutMember(cid, carol, 0);
      await flush();
      expect(myMembership(C.getState(), cid, carol)?.timeoutUntil).toBeNull();
      await C.getState().send('back', []);
    });

    it('who may time out whom', async () => {
      await expect(api(bob).timeoutMember(cid, alice, 60)).rejects.toMatchObject({ code: 'not_allowed' }); // not the admin
      await expect(api(alice).timeoutMember(cid, alice, 60)).rejects.toMatchObject({ code: 'not_allowed' }); // not yourself
      await expect(api(bob).timeoutMember(cid, bob, 60)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(bob).timeoutMember(cid, mia, 60)).rejects.toMatchObject({ code: 'not_allowed' }); // a mod can't time out a mod
      await api(alice).timeoutMember(cid, mia, 60); // the admin can
      await expect(api(bob).timeoutMember(cid, mia, 0)).rejects.toMatchObject({ code: 'not_allowed' }); // nor lift it
      await expect(say(mia, 'timed-out mod')).rejects.toMatchObject({ code: 'timed_out' });
      await expect(api(carol).timeoutMember(cid, dave, 60)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(erin).timeoutMember(cid, dave, 60)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(bob).timeoutMember(cid, erin, 60)).rejects.toMatchObject({ code: 'not_a_member' });
    });

    it('durations: 0 lifts, up to 28 days, nothing else', async () => {
      await expect(api(bob).timeoutMember(cid, carol, -1)).rejects.toMatchObject({ code: 'bad_duration' });
      await expect(api(bob).timeoutMember(cid, carol, 28 * 86400 + 1)).rejects.toMatchObject({ code: 'bad_duration' });
      await expect(api(bob).timeoutMember(cid, carol, 1.5)).rejects.toMatchObject({ code: 'bad_duration' });
      expect(await api(bob).timeoutMember(cid, carol, 28 * 86400)).not.toBeNull();
      expect(await api(bob).timeoutMember(cid, carol, 0)).toBeNull();
      await say(carol, 'free again');
    });

    it('it runs out by itself', async () => {
      await api(bob).timeoutMember(cid, carol, 1);
      await expect(say(carol, 'now')).rejects.toMatchObject({ code: 'timed_out' });
      await sleep(1100);
      await say(carol, 'later');
    });

    it('a timed-out member cannot leave and rejoin to shake it off; a moderator can still remove them; the admin is never affected', async () => {
      await api(bob).timeoutMember(cid, carol, 600);
      await expect(api(carol).leaveCommunity(cid)).rejects.toMatchObject({ code: 'timed_out' });
      expect(server.roleOf(cid, carol)).toBe('member');
      await api(bob).kickMember(cid, carol);
      expect(server.roleOf(cid, carol)).toBeNull();
    });

    it('becoming the admin clears a timeout', async () => {
      await api(alice).timeoutMember(cid, bob, 600);
      await api(alice).transferAdmin(cid, bob);
      expect(server.members.find((m) => m.userId === bob)?.timeoutUntil).toBeNull();
      await say(bob, 'the new admin speaks');
    });
  });

  describe('the ban list', () => {
    it('moderators and the admin can list bans (newest first) with who and why; members and outsiders cannot', async () => {
      await api(bob).banMember(cid, carol, 'spam');
      await api(alice).banMember(cid, dave, 'by the admin');
      const bans = await api(mia).listBans(cid);
      expect(bans.map((b) => [b.userId, b.bannedBy, b.reason])).toEqual([
        [dave, alice, 'by the admin'],
        [carol, bob, 'spam'],
      ]);
      expect(bans[0]?.createdAt).toBeTruthy();
      await expect(api(carol).listBans(cid)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(erin).listBans(cid)).rejects.toMatchObject({ code: 'not_allowed' });
    });

    it('lifting: the admin any ban, a moderator only their own, never the person it applies to', async () => {
      await api(bob).banMember(cid, carol, 'spam');
      await api(alice).banMember(cid, dave, 'x');
      await expect(api(carol).unbanMember(cid, carol)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(mia).unbanMember(cid, carol)).rejects.toMatchObject({ code: 'not_allowed' }); // someone else's
      await expect(api(bob).unbanMember(cid, dave)).rejects.toMatchObject({ code: 'not_allowed' }); // the admin's
      await expect(api(bob).unbanMember(cid, erin)).rejects.toMatchObject({ code: 'not_allowed' }); // nobody banned
      await api(bob).unbanMember(cid, carol);
      await api(alice).unbanMember(cid, dave);
      expect(await api(alice).listBans(cid)).toEqual([]);
    });

    it('after an unban the person can join again with an invite — and not before', async () => {
      const inv = await api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
      await api(bob).banMember(cid, carol, 'spam');
      await expect(api(carol).joinCommunity(inv.code)).rejects.toMatchObject({ code: 'banned' });
      await api(bob).unbanMember(cid, carol);
      expect(await api(carol).joinCommunity(inv.code)).toBe(cid);
    });

    it('banning the same person twice is refused, as in the database', async () => {
      await api(bob).banMember(cid, carol, 'spam');
      await expect(api(alice).banMember(cid, carol, 'again')).rejects.toBeInstanceOf(CommunityError);
    });
  });

  describe('admin transfer', () => {
    const admins = () => server.members.filter((m) => m.communityId === cid && m.role === 'admin');

    it('the new admin takes over and the old one becomes a moderator — always exactly one admin', async () => {
      await api(alice).transferAdmin(cid, carol);
      expect(admins().map((m) => m.userId)).toEqual([carol]);
      expect(server.roleOf(cid, alice)).toBe('mod');
      expect(server.communities.find((c) => c.id === cid)?.createdBy).toBe(carol);
      await expect(api(alice).createChannel(cid, 'nope', '')).rejects.toMatchObject({ code: 'not_allowed' });
      await api(carol).createChannel(cid, 'mine', '');
      await api(carol).transferAdmin(cid, bob); // a moderator target works too
      expect(admins().map((m) => m.userId)).toEqual([bob]);
    });

    it('only the admin may; not to yourself, an outsider or a banned person', async () => {
      await expect(api(bob).transferAdmin(cid, bob)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(carol).transferAdmin(cid, carol)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(erin).transferAdmin(cid, erin)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(alice).transferAdmin(cid, alice)).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(api(alice).transferAdmin(cid, erin)).rejects.toMatchObject({ code: 'not_a_member' });
      server.bans.push({ communityId: cid, userId: dave, bannedBy: alice, reason: '', createdAt: server.clock() }); // (a ban that left the membership in place)
      await expect(api(alice).transferAdmin(cid, dave)).rejects.toMatchObject({ code: 'banned' });
      expect(admins().map((m) => m.userId)).toEqual([alice]);
    });

    it('the community is never left without its admin: the admin cannot leave, be removed, banned or demoted', async () => {
      await expect(api(alice).leaveCommunity(cid)).rejects.toBeInstanceOf(CommunityError);
      await expect(api(bob).kickMember(cid, alice)).rejects.toBeInstanceOf(CommunityError);
      await expect(api(bob).banMember(cid, alice, '')).rejects.toBeInstanceOf(CommunityError);
      await expect(api(alice).setRole(cid, alice, 'member')).rejects.toBeInstanceOf(CommunityError);
      await api(alice).transferAdmin(cid, carol);
      await api(alice).leaveCommunity(cid); // now just a moderator: free to go
      expect(admins().map((m) => m.userId)).toEqual([carol]);
    });

    it('members see the change live', async () => {
      await api(alice).transferAdmin(cid, carol);
      await flush();
      expect(C.getState().communities[0]?.role).toBe('admin');
      await A.getState().refreshMembers();
      expect(A.getState().communities[0]?.role).toBe('mod');
    });
  });

  describe('avatars', () => {
    it('a profile can carry an avatar URL, and the store keeps it for the members list and message authors', async () => {
      const zed = server.addUser('zed', 'Zed Z', 'https://cdn.test/avatars/zed.webp');
      const inv = await api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
      await api(zed).joinCommunity(inv.code);
      await A.getState().refreshMembers();
      await say(zed, 'hi');
      await flush();
      expect(A.getState().profiles[zed]?.avatarUrl).toBe('https://cdn.test/avatars/zed.webp');
      expect(A.getState().profiles[carol]?.avatarUrl).toBeUndefined();
    });
  });

  describe('profile cards', () => {
    it('bio and links come through getProfiles like the database path: valid links only, and no keys when there are none', async () => {
      const zed = server.addUser('zed', 'Zed Z', undefined, {
        designation: 'Engineer',
        bio: 'Infra.',
        links: [
          { kind: 'github', url: 'https://github.com/zed' },
          { kind: 'github', url: 'https://evil.example/zed' },
          { kind: 'website', url: 'javascript:alert(1)' },
        ],
      });
      const inv = await api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
      await api(zed).joinCommunity(inv.code);
      await A.getState().refreshMembers();
      await say(zed, 'hi');
      await flush();
      expect(A.getState().profiles[zed]).toMatchObject({ designation: 'Engineer', bio: 'Infra.', links: [{ kind: 'github', url: 'https://github.com/zed' }] });
      expect('links' in (A.getState().profiles[carol] ?? {})).toBe(false);
      expect('bio' in (A.getState().profiles[carol] ?? {})).toBe(false);
      const junk = server.addUser('junk', 'Junk J', undefined, { links: 'not-an-array' });
      const [loaded] = await api(alice).getProfiles([junk]);
      expect(loaded).toBeDefined();
      expect('links' in (loaded as object)).toBe(false);
    });
  });
});
