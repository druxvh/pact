import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificationCenter } from '@/app/NotificationCenter';
import { useChatStore } from '@/features/chat/store';
import { MemoryServer } from '@/features/community/memoryApi';
import { setCommunityApiForTesting } from '@/features/community/useCommunityStore';
import { setNowPlayingApiForTesting } from '@/features/nowplaying/hooks';
import { MemoryNowPlayingServer } from '@/features/nowplaying/memoryApi';
import type { Track } from '@/features/nowplaying/track';
import { useAuthStore } from '@/store/useAuthStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { click, mount, run } from '@/test/render';
import { setActivityApiForTesting, useActivityStore } from './hooks';
import { MemoryActivityServer } from './memoryApi';
import { usePeopleStore } from './people';
import { sendPrivateReply } from './reply';

const ME = '11111111-1111-4111-8111-111111111111';
const MAYA = '22222222-2222-4222-8222-222222222222';
const song: Track = { title: 'Night Drive', artist: 'The Tests', album: '', artworkUrl: 'https://i.scdn.co/image/abc', trackUrl: null, source: 'spotify' };
const wait = (ms = 120) => run(() => new Promise<void>((r) => setTimeout(r, ms)));

let server: MemoryActivityServer;
let unmount: (() => Promise<void>) | null = null;

beforeEach(() => {
  server = new MemoryActivityServer();
  setActivityApiForTesting(server.api(ME));
  setCommunityApiForTesting(new MemoryServer().api(ME));
  setNowPlayingApiForTesting(new MemoryNowPlayingServer().api(ME));
  useAuthStore.setState({ status: 'signedIn', user: { id: ME, email: null, provider: null, name: null } });
  useActivityStore.getState().reset();
  usePeopleStore.setState({ people: { [MAYA]: { name: 'Maya' } } });
  useNotificationStore.setState({ notifications: [] });
});
afterEach(async () => {
  await unmount?.();
  unmount = null;
  document.body.innerHTML = '';
  useActivityStore.getState().reset();
  setActivityApiForTesting(null);
  setCommunityApiForTesting(null);
  setNowPlayingApiForTesting(null);
  useAuthStore.setState({ status: 'guest', user: null });
  useNotificationStore.setState({ notifications: [] });
});

describe('the bell', () => {
  it('a heart on my song arrives live as "Maya liked your song" with the song’s cover, and opens the thread', async () => {
    await useActivityStore.getState().start();
    const note = await server.api(ME).postNote({ text: 'my note', track: song });
    await server.api(MAYA).like({ ownerId: ME, kind: 'listening', key: 'k' }, { kind: 'listening', track: song });
    await server.api(MAYA).like({ ownerId: ME, kind: 'note', key: note.id }, { kind: 'note', text: 'my note', track: song });
    await wait(200);
    const list = useNotificationStore.getState().notifications;
    expect(list.map((n) => n.title).sort()).toEqual(['Maya liked your note', 'Maya liked your song']);
    expect(list[0]?.link).toEqual({ section: 'chat', sub: `a:${MAYA}` });
    expect(list.every((n) => n.key?.startsWith(`activity:${MAYA}:`))).toBe(true);

    const m = await mount(createElement(NotificationCenter));
    unmount = m.unmount;
    await click(m.container.querySelector('button[aria-label^="Notifications"]') as HTMLButtonElement);
    await wait();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Maya liked your song');
    expect(text).toContain('Maya liked your note');
    // with the cover of the song that was liked
    expect(document.body.querySelectorAll('[data-track-art]').length).toBe(2);
    expect(document.body.querySelector('[data-track-art] img')?.getAttribute('src')).toBe('https://i.scdn.co/image/abc');
  });

  it('a comment or a reply with no song gets a speech bubble instead of a cover', async () => {
    await useActivityStore.getState().start();
    const note = await server.api(ME).postNote({ text: 'plain note', track: null });
    await server.api(MAYA).addComment({ ownerId: ME, kind: 'note', key: note.id }, 'nice', { kind: 'note', text: 'plain note' });
    await wait(200);
    const m = await mount(createElement(NotificationCenter));
    unmount = m.unmount;
    await click(m.container.querySelector('button[aria-label^="Notifications"]') as HTMLButtonElement);
    await wait();
    expect(document.body.textContent).toContain('Maya commented: nice');
    expect(document.body.querySelectorAll('[data-track-art]')).toHaveLength(0);
  });

  it('other notifications look exactly as before', async () => {
    useNotificationStore.getState().add({ title: 'Friend request', body: 'Riley wants to connect', kind: 'friend' });
    const m = await mount(createElement(NotificationCenter));
    unmount = m.unmount;
    await click(m.container.querySelector('button[aria-label^="Notifications"]') as HTMLButtonElement);
    await wait();
    expect(document.body.textContent).toContain('Riley wants to connect');
    expect(document.body.querySelectorAll('[data-track-art]')).toHaveLength(0);
  });
});

describe('private replies', () => {
  it('to a real person: an activity message in their inbox', async () => {
    const r = await sendPrivateReply(MAYA, 'hello!', { kind: 'note', text: 'x' });
    expect(r).toEqual({ where: 'activity', sub: `a:${MAYA}` });
    expect((await server.api(MAYA).messages()).map((m) => m.body)).toEqual(['hello!']);
  });

  it('to a simulated friend: into the simulated chat with them, quoting what was replied to, and never to the activity API', async () => {
    const before = useChatStore.getState().messages.length;
    const r = await sendPrivateReply('alex', 'congrats!', { kind: 'note', text: 'Shipping the new onboarding today' });
    expect(r.where).toBe('chat');
    const sent = useChatStore.getState().messages.at(-1);
    expect(useChatStore.getState().messages).toHaveLength(before + 1);
    expect(sent?.conversationId).toBe(r.sub);
    expect(sent?.body).toBe('Re: “Shipping the new onboarding today” — congrats!');
    expect(server.messages).toHaveLength(0);
  });
});
