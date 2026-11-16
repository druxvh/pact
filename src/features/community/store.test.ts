import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryServer } from './memoryApi';
import { createCommunityStore } from './store';
import { CommunityError } from './types';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('communities (store + the rules the database enforces)', () => {
  let server: MemoryServer;
  let alice: string; // admin
  let bob: string; // will be a moderator
  let carol: string; // plain member
  let dave: string; // outsider
  let A: ReturnType<typeof createCommunityStore>;
  let B: ReturnType<typeof createCommunityStore>;
  let C: ReturnType<typeof createCommunityStore>;
  let cid: string;
  let channelId: string;

  beforeEach(async () => {
    localStorage.clear();
    server = new MemoryServer();
    alice = server.addUser('alice', 'Alice A');
    bob = server.addUser('bob', 'Bob B');
    carol = server.addUser('carol', 'Carol C');
    dave = server.addUser('dave', 'Dave D');
    A = createCommunityStore(() => server.api(alice));
    B = createCommunityStore(() => server.api(bob));
    C = createCommunityStore(() => server.api(carol));
    cid = await server.api(alice).createCommunity({ name: 'Pact Club', description: 'hi', hue: 200 });
    const inv = await server.api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
    await server.api(bob).joinCommunity(inv.code);
    await server.api(carol).joinCommunity(inv.code);
    await server.api(alice).setRole(cid, bob, 'mod');
    await A.getState().init();
    await B.getState().init();
    await C.getState().init();
    channelId = A.getState().activeChannelId as string;
  });

  it('loads my communities, picks #general and my role', () => {
    expect(A.getState().communities.map((c) => [c.name, c.role])).toEqual([['Pact Club', 'admin']]);
    expect(B.getState().communities[0]?.role).toBe('mod');
    expect(C.getState().communities[0]?.role).toBe('member');
    expect(A.getState().channels[cid]?.map((c) => c.name)).toEqual(['general']);
  });

  it('messages reach other members live, with replies and reactions', async () => {
    await A.getState().send('hello everyone', []);
    await flush();
    const first = C.getState().messages[channelId]?.[0];
    expect(first?.body).toBe('hello everyone');
    C.getState().setReplyTo(first as NonNullable<typeof first>);
    await C.getState().send('hi Alice!', []);
    await flush();
    const reply = A.getState().messages[channelId]?.at(-1);
    expect(reply?.replyTo).toBe(first?.id);
    expect(A.getState().profiles[carol]?.displayName).toBe('Carol C');
    await B.getState().toggleReaction(first as NonNullable<typeof first>, '🔥');
    await flush();
    expect(A.getState().reactions[first?.id as string]?.map((r) => r.emoji)).toEqual(['🔥']);
    await B.getState().toggleReaction(first as NonNullable<typeof first>, '🔥');
    expect(A.getState().reactions[first?.id as string]).toEqual([]);
  });

  it('a moderator hides a message: members see a blank tombstone, mods can read and restore the original', async () => {
    await C.getState().send('buy my stuff https://spam.example/x', []);
    await flush();
    const id = A.getState().messages[channelId]?.[0]?.id as string;
    await B.getState().hide(id, 'spam');
    await flush();
    const seenByMember = C.getState().messages[channelId]?.[0];
    expect(seenByMember?.hiddenAt).not.toBeNull();
    expect(seenByMember?.body).toBe('');
    expect(seenByMember?.hiddenReason).toBe('spam');
    expect((await server.api(bob).getOriginal(id))?.body).toContain('buy my stuff');
    await expect(server.api(carol).getOriginal(id)).rejects.toBeInstanceOf(CommunityError); // members can't read originals
    await A.getState().restore(id);
    await flush();
    expect(C.getState().messages[channelId]?.[0]?.body).toContain('buy my stuff');
    expect(C.getState().messages[channelId]?.[0]?.hiddenAt).toBeNull();
  });

  it('removing links keeps the text and replaces every link', async () => {
    await C.getState().send('look www.bad.example and https://worse.example/a?b=1 ok', []);
    await flush();
    const id = A.getState().messages[channelId]?.[0]?.id as string;
    await B.getState().stripLinks(id);
    await flush();
    expect(C.getState().messages[channelId]?.[0]?.body).toBe('look [link removed] and [link removed] ok');
    await expect(C.getState().edit(id, 'sneaky')).rejects.toBeInstanceOf(CommunityError); // can't edit a moderated message
  });

  it('members can’t moderate; authors can edit and delete their own messages only', async () => {
    await A.getState().send('admin says hi', []);
    await C.getState().send('carol here', []);
    await flush();
    const adminMsg = C.getState().messages[channelId]?.find((m) => m.authorId === alice);
    const carolMsg = C.getState().messages[channelId]?.find((m) => m.authorId === carol);
    await expect(C.getState().hide(adminMsg?.id as string, 'x')).rejects.toBeInstanceOf(CommunityError);
    await expect(C.getState().edit(adminMsg?.id as string, 'hijack')).rejects.toBeInstanceOf(CommunityError);
    await expect(B.getState().edit(carolMsg?.id as string, 'hijack')).rejects.toBeInstanceOf(CommunityError); // not even a mod edits others' words
    await C.getState().edit(carolMsg?.id as string, 'carol edited');
    await flush();
    expect(A.getState().messages[channelId]?.find((m) => m.id === carolMsg?.id)?.editedAt).not.toBeNull();
    await C.getState().remove(carolMsg?.id as string);
    await flush();
    expect(A.getState().messages[channelId]?.find((m) => m.id === carolMsg?.id)).toMatchObject({ body: '', deletedAt: expect.any(String) });
  });

  it('only people in the community can read it; an invite code is the only way in', async () => {
    const outsider = server.api(dave);
    await expect(outsider.listChannels(cid)).rejects.toBeInstanceOf(CommunityError);
    await expect(outsider.listMessages(channelId, { limit: 10 })).rejects.toBeInstanceOf(CommunityError);
    expect(await outsider.listCommunities()).toEqual([]);
    expect(await outsider.joinCommunity('0000000000000000')).toBeNull();
  });

  it('invites can expire, run out and be revoked', async () => {
    const one = await server.api(alice).createInvite(cid, { maxUses: 1, expiresInHours: null });
    expect(await server.api(dave).joinCommunity(one.code)).toBe(cid);
    const eve = server.addUser('eve');
    expect(await server.api(eve).joinCommunity(one.code)).toBeNull(); // used up
    const revoked = await server.api(bob).createInvite(cid, { maxUses: null, expiresInHours: 24 });
    await server.api(alice).revokeInvite(revoked.code);
    expect(await server.api(eve).joinCommunity(revoked.code)).toBeNull();
    await expect(server.api(carol).createInvite(cid, { maxUses: null, expiresInHours: null })).rejects.toBeInstanceOf(CommunityError); // members can't invite
  });

  it('guessing codes is throttled', async () => {
    const eve = server.api(server.addUser('eve'));
    for (let i = 0; i < 15; i++) expect(await eve.joinCommunity(`${i}`.padStart(16, '0'))).toBeNull();
    await expect(eve.joinCommunity('0000000000000000')).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('roles: the admin appoints moderators; moderators remove members but not each other or the admin', async () => {
    await expect(server.api(bob).setRole(cid, carol, 'mod')).rejects.toBeInstanceOf(CommunityError); // a mod can't appoint
    await expect(server.api(alice).setRole(cid, alice, 'member')).rejects.toBeInstanceOf(CommunityError); // nor demote herself
    const dana = server.addUser('dana');
    const inv = await server.api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
    await server.api(dana).joinCommunity(inv.code);
    await server.api(alice).setRole(cid, dana, 'mod');
    await expect(server.api(bob).kickMember(cid, dana)).rejects.toBeInstanceOf(CommunityError); // mod can't kick a mod
    await expect(server.api(bob).kickMember(cid, alice)).rejects.toBeInstanceOf(CommunityError); // nobody kicks the admin
    await expect(server.api(bob).banMember(cid, alice, '')).rejects.toBeInstanceOf(CommunityError);
    await server.api(bob).kickMember(cid, carol); // a mod can kick a member
    expect(server.roleOf(cid, carol)).toBeNull();
  });

  it('a banned person cannot get back in, even with a valid invite', async () => {
    const inv = await server.api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
    await server.api(bob).banMember(cid, carol, 'spam');
    expect(server.roleOf(cid, carol)).toBeNull();
    await expect(server.api(carol).joinCommunity(inv.code)).rejects.toMatchObject({ code: 'banned' });
    expect(await server.api(carol).previewInvite(inv.code)).toBeNull();
  });

  it('only the admin creates channels; messages and replies stay inside their channel', async () => {
    await expect(server.api(bob).createChannel(cid, 'memes', '')).rejects.toBeInstanceOf(CommunityError);
    const memes = await server.api(alice).createChannel(cid, 'memes', 'only the good ones');
    await expect(server.api(alice).createChannel(cid, 'Bad Name', '')).rejects.toBeInstanceOf(CommunityError);
    await A.getState().send('in general', []);
    const general = A.getState().messages[channelId]?.[0];
    await expect(
      server.api(alice).sendMessage({ communityId: cid, channelId: memes.id, body: 'x', attachments: [], replyTo: general?.id ?? null }),
    ).rejects.toBeInstanceOf(CommunityError);
  });

  it('attachments must belong to the community they are posted in', async () => {
    const png = new File([new Uint8Array([1, 2, 3])], 'meme.png', { type: 'image/png' });
    const ok = await server.api(carol).uploadAttachment(cid, png);
    await C.getState().send('', [ok]);
    expect(C.getState().messages[channelId]?.[0]?.attachments[0]?.name).toBe('meme.png');
    const other = await server.api(alice).createCommunity({ name: 'Elsewhere', description: '', hue: 1 });
    const foreign = await server.api(alice).uploadAttachment(other, png);
    await expect(server.api(alice).sendMessage({ communityId: cid, channelId, body: 'x', attachments: [foreign], replyTo: null })).rejects.toBeInstanceOf(
      CommunityError,
    );
    await expect(server.api(carol).uploadAttachment(cid, new File([new Uint8Array(1)], 'a.exe', { type: 'application/x-msdownload' }))).rejects.toMatchObject({
      code: 'bad_type',
    });
  });

  it('older messages load in pages', async () => {
    const api = server.api(alice);
    for (let i = 0; i < 60; i++) await api.sendMessage({ communityId: cid, channelId, body: `m${i}`, attachments: [], replyTo: null });
    await A.getState().selectChannel(channelId);
    expect(A.getState().messages[channelId]).toHaveLength(50);
    expect(A.getState().hasMore[channelId]).toBe(true);
    await A.getState().loadOlder();
    expect(A.getState().messages[channelId]).toHaveLength(60);
    expect(A.getState().hasMore[channelId]).toBe(false);
  });

  it('leaving removes the community from my list; the admin cannot leave', async () => {
    await server.api(carol).leaveCommunity(cid);
    await C.getState().refreshCommunities();
    expect(C.getState().communities).toEqual([]);
    await expect(server.api(alice).leaveCommunity(cid)).rejects.toBeInstanceOf(CommunityError);
  });
});
