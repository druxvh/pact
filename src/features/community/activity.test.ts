import { beforeEach, describe, expect, it } from 'vitest';
import { gifUrl } from './links';
import { MemoryServer } from './memoryApi';
import { attachmentPaths, listAllFiles, removeInBatches, type StorageEntry } from './storageCleanup';
import { communityUnread, createCommunityStore } from './store';
import { activeTypers, TYPING_TTL_MS, typingLabel } from './typing';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('unread counts, typing, GIFs and storage cleanup', () => {
  let server: MemoryServer;
  let alice: string;
  let bob: string;
  let carol: string;
  let A: ReturnType<typeof createCommunityStore>;
  let B: ReturnType<typeof createCommunityStore>;
  let C: ReturnType<typeof createCommunityStore>;
  let cid: string;
  let general: string;

  beforeEach(async () => {
    localStorage.clear();
    server = new MemoryServer();
    alice = server.addUser('alice', 'Alice A');
    bob = server.addUser('bob', 'Bob B');
    carol = server.addUser('carol', 'Carol C');
    A = createCommunityStore(() => server.api(alice));
    B = createCommunityStore(() => server.api(bob));
    C = createCommunityStore(() => server.api(carol));
    cid = await server.api(alice).createCommunity({ name: 'Pact Club', description: '', hue: 200 });
    const inv = await server.api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
    await server.api(bob).joinCommunity(inv.code);
    await server.api(carol).joinCommunity(inv.code);
    await A.getState().init();
    await B.getState().init();
    await C.getState().init();
    general = A.getState().activeChannelId as string;
  });

  describe('unread', () => {
    it('a channel you are looking at is read as messages arrive; one you are not looking at gets a count', async () => {
      const memes = await server.api(alice).createChannel(cid, 'memes', '');
      await A.getState().send('hello', []);
      await server.api(alice).sendMessage({ communityId: cid, channelId: memes.id, body: 'a meme', attachments: [], replyTo: null });
      await server.api(alice).sendMessage({ communityId: cid, channelId: memes.id, body: 'another', attachments: [], replyTo: null });
      await flush();
      expect(C.getState().unread[general]).toBeUndefined();
      expect(C.getState().unread[memes.id]?.count).toBe(2);
      expect(communityUnread(C.getState().unread, cid)).toBe(2);
    });

    it('your own messages never count, for you or on another device', async () => {
      await A.getState().send('mine', []);
      await flush();
      expect(communityUnread(A.getState().unread, cid)).toBe(0);
      expect(await server.api(alice).unreadCounts()).toEqual([]);
    });

    it('opening the channel clears the badge and remembers it on the server', async () => {
      const memes = await server.api(alice).createChannel(cid, 'memes', '');
      await server.api(alice).sendMessage({ communityId: cid, channelId: memes.id, body: 'one', attachments: [], replyTo: null });
      await flush();
      expect(C.getState().unread[memes.id]?.count).toBe(1);
      await C.getState().selectChannel(memes.id);
      await flush();
      expect(C.getState().unread[memes.id]).toBeUndefined();
      expect(await server.api(carol).unreadCounts()).toEqual([]); // a fresh device agrees
    });

    it('while the pane is closed (a phone on the channel list, or scrolled up in history) messages stay unread until you open it', async () => {
      C.getState().setReading(false);
      await A.getState().send('psst', []);
      await flush();
      expect(C.getState().unread[general]?.count).toBe(1);
      C.getState().setReading(true);
      await flush();
      expect(C.getState().unread[general]).toBeUndefined();
      expect(await server.api(carol).unreadCounts()).toEqual([]);
    });

    it('a new session starts from what the server remembers', async () => {
      C.getState().setReading(false);
      await A.getState().send('one', []);
      await A.getState().send('two', []);
      await flush();
      C.getState().dispose();
      const fresh = createCommunityStore(() => server.api(carol));
      fresh.getState().setReading(false);
      await fresh.getState().init();
      await flush();
      expect(fresh.getState().unread[general]?.count).toBe(2);
    });

    it('joining later does not make the history unread; hidden and deleted messages do not count', async () => {
      await A.getState().send('old 1', []);
      await A.getState().send('old 2', []);
      const dave = server.addUser('dave');
      const inv = await server.api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
      await server.api(dave).joinCommunity(inv.code);
      expect(await server.api(dave).unreadCounts()).toEqual([]);
      C.getState().setReading(false);
      const spam = await server.api(alice).sendMessage({ communityId: cid, channelId: general, body: 'spam', attachments: [], replyTo: null });
      await server.api(alice).sendMessage({ communityId: cid, channelId: general, body: 'fine', attachments: [], replyTo: null });
      await server.api(alice).hideMessage(spam.id, 'spam');
      expect((await server.api(dave).unreadCounts())[0]?.count).toBe(1);
    });

    it('the server never moves a read marker backwards', async () => {
      const api = server.api(carol);
      await api.markRead({ id: general, communityId: cid }, '2999-01-01T00:00:00.000Z');
      await api.markRead({ id: general, communityId: cid }, '2000-01-01T00:00:00.000Z');
      expect(server.reads.get(`${carol}|${general}`)).toBe('2999-01-01T00:00:00.000Z');
    });

    it('you cannot mark a channel of a community you are not in', async () => {
      const dave = server.addUser('dave');
      await expect(server.api(dave).markRead({ id: general, communityId: cid }, new Date().toISOString())).rejects.toMatchObject({ code: 'not_allowed' });
    });
  });

  describe('typing', () => {
    it('others see you typing; you never see yourself; sending a message clears it', async () => {
      C.getState().announceTyping();
      await flush();
      expect(Object.keys(A.getState().typing[general] ?? {})).toEqual([carol]);
      expect(Object.keys(B.getState().typing[general] ?? {})).toEqual([carol]);
      expect(C.getState().typing[general]).toBeUndefined();
      await C.getState().send('done typing', []);
      await flush();
      expect(A.getState().typing[general]?.[carol]).toBeUndefined();
    });

    it('announcing is rate-limited, but the first keystroke after sending announces again', async () => {
      C.getState().announceTyping();
      await flush();
      const first = A.getState().typing[general]?.[carol];
      await new Promise((r) => setTimeout(r, 5));
      C.getState().announceTyping(); // within 3 s: swallowed
      await flush();
      expect(A.getState().typing[general]?.[carol]).toBe(first);
      await C.getState().send('hi', []);
      C.getState().announceTyping();
      await flush();
      expect(A.getState().typing[general]?.[carol]).toBeGreaterThan(first as number);
    });

    it('only people in the community can show up as typing', async () => {
      A.getState().noteTyping(general, crypto.randomUUID());
      expect(A.getState().typing[general]).toBeUndefined();
      A.getState().noteTyping(general, alice); // me
      expect(A.getState().typing[general]).toBeUndefined();
    });

    it('typers expire, and the label reads naturally', () => {
      const now = 1_000_000;
      const map = { a: now + TYPING_TTL_MS, b: now - 1, me: now + 100 };
      expect(activeTypers(map, 'me', now)).toEqual(['a']);
      expect(activeTypers(undefined, 'me', now)).toEqual([]);
      expect(typingLabel([])).toBe('');
      expect(typingLabel(['Ana'])).toBe('Ana is typing…');
      expect(typingLabel(['Ana', 'Bo'])).toBe('Ana and Bo are typing…');
      expect(typingLabel(['Ana', 'Bo', 'Cy'])).toBe('Ana, Bo and Cy are typing…');
      expect(typingLabel(['Ana', 'Bo', 'Cy', 'Di'])).toBe('Several people are typing…');
    });

    it('typing in another community or after leaving reaches nobody', async () => {
      const other = await server.api(alice).createCommunity({ name: 'Elsewhere', description: '', hue: 10 });
      const handle = server.api(alice).subscribeTyping(other, () => {});
      handle.announce(general);
      await flush();
      expect(C.getState().typing[general]).toBeUndefined();
      handle.stop();
    });
  });

  describe('GIFs', () => {
    it('search pages through results; an empty query is trending', async () => {
      const api = server.api(carol);
      const trending = await api.searchGifs('');
      expect(trending.gifs).toHaveLength(4);
      expect(trending.next).toBe('4');
      expect((await api.searchGifs('', { next: trending.next })).next).toBeNull();
      expect((await api.searchGifs('cat')).gifs.map((g) => g.title)).toEqual(['cat']);
    });

    it('says so plainly when the server has no GIF key', async () => {
      server.gifsConfigured = false;
      await expect(server.api(carol).searchGifs('cat')).rejects.toMatchObject({ code: 'not_configured' });
    });

    it('a picked GIF is just a message whose whole body is the link', async () => {
      const gif = (await server.api(carol).searchGifs('dog')).gifs[0];
      await C.getState().send(gif?.url as string, []);
      await flush();
      const got = A.getState().messages[general]?.at(-1);
      expect(got?.body).toBe(gif?.url);
      expect(gifUrl(got?.body ?? '')).toBe(gif?.url);
    });

    it('gifUrl only accepts a bare https link to the provider’s own media hosts', () => {
      expect(gifUrl('https://media.giphy.com/media/abc/giphy.gif')).not.toBeNull();
      expect(gifUrl('  https://media3.giphy.com/media/v1.Y2lk/giphy.webp?cid=1&ct=g  ')).not.toBeNull();
      expect(gifUrl('https://i.giphy.com/abc.gif')).not.toBeNull();
      expect(gifUrl('http://media.giphy.com/media/abc/giphy.gif')).toBeNull(); // not https
      expect(gifUrl('https://evil.example/giphy.gif')).toBeNull();
      expect(gifUrl('https://media.giphy.com.evil.example/a.gif')).toBeNull();
      expect(gifUrl('https://user:pw@media.giphy.com/a.gif')).toBeNull();
      expect(gifUrl('https://media.giphy.com/media/abc/giphy.gif lol')).toBeNull(); // extra text → ordinary message
      expect(gifUrl('https://media.giphy.com/page.html')).toBeNull();
      expect(gifUrl('not a url')).toBeNull();
      expect(gifUrl('')).toBeNull();
    });
  });

  describe('storage cleanup', () => {
    const png = () => new File([new Uint8Array(4)], 'a.png', { type: 'image/png' });

    it('deleting a community removes every file in it — and only that community’s', async () => {
      const keep = await server.api(alice).createCommunity({ name: 'Keep me', description: '', hue: 1 });
      await server.api(alice).uploadAttachment(keep, png());
      await server.api(carol).uploadAttachment(cid, png());
      await server.api(bob).uploadAttachment(cid, png());
      expect(server.files.size).toBe(3);
      await server.api(alice).deleteCommunity(cid);
      expect([...server.files.keys()].every((p) => p.startsWith(`${keep}/`))).toBe(true);
      expect(server.files.size).toBe(1);
    });

    it('only the admin can delete a community, and nothing is removed when they are refused', async () => {
      await server.api(carol).uploadAttachment(cid, png());
      await expect(server.api(bob).deleteCommunity(cid)).rejects.toMatchObject({ code: 'not_allowed' }); // a mod is not enough
      expect(server.files.size).toBe(1);
    });

    it('deleting a channel removes the files its messages used, including ones a moderator hid', async () => {
      const memes = await server.api(alice).createChannel(cid, 'memes', '');
      const a1 = await server.api(carol).uploadAttachment(cid, png());
      const a2 = await server.api(carol).uploadAttachment(cid, png());
      const elsewhere = await server.api(carol).uploadAttachment(cid, png());
      await server.api(carol).sendMessage({ communityId: cid, channelId: memes.id, body: '', attachments: [a1], replyTo: null });
      const hidden = await server.api(carol).sendMessage({ communityId: cid, channelId: memes.id, body: '', attachments: [a2], replyTo: null });
      await server.api(carol).sendMessage({ communityId: cid, channelId: general, body: '', attachments: [elsewhere], replyTo: null });
      await server.api(alice).hideMessage(hidden.id, 'nope');
      await server.api(alice).deleteChannel(memes.id);
      expect([...server.files.keys()]).toEqual([elsewhere.path]);
    });

    it('listAllFiles walks folders at any depth and pages through long listings', async () => {
      const tree: Record<string, StorageEntry[]> = {
        c1: [
          { name: 'u1', id: null },
          { name: 'u2', id: null },
        ],
        'c1/u1': Array.from({ length: 1500 }, (_, i) => ({ name: `f${i}.png`, id: `id${i}` })),
        'c1/u2': [{ name: 'only.png', id: 'x' }],
      };
      const calls: Array<[string, number]> = [];
      const files = await listAllFiles(async (folder, offset, limit) => {
        calls.push([folder, offset]);
        return (tree[folder] ?? []).slice(offset, offset + limit);
      }, 'c1');
      expect(files).toHaveLength(1501);
      expect(files).toContain('c1/u1/f1499.png');
      expect(files).toContain('c1/u2/only.png');
      expect(calls.filter(([f]) => f === 'c1/u1')).toEqual([
        ['c1/u1', 0],
        ['c1/u1', 1000],
      ]);
    });

    it('removeInBatches batches, and reports what failed instead of throwing', async () => {
      const seen: number[] = [];
      const failed = await removeInBatches(
        async (paths) => {
          seen.push(paths.length);
          return { error: seen.length === 2 ? new Error('boom') : null };
        },
        Array.from({ length: 250 }, (_, i) => `p${i}`),
      );
      expect(seen).toEqual([100, 100, 50]);
      expect(failed).toBe(100);
    });

    it('attachmentPaths reads paths out of message rows defensively', () => {
      expect(
        attachmentPaths([
          { attachments: [{ path: 'a/b/c.png' }, { path: 'a/b/c.png' }, { nope: 1 }, null, 'x'] },
          { attachments: 'junk' },
          { attachments: [{ path: 'd' }] },
        ]),
      ).toEqual(['a/b/c.png', 'd']);
    });
  });
});
