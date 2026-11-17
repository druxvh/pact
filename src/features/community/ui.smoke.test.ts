import { act, type ComponentType, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui';
import { Composer } from './Composer';
import { MembersPanel } from './MembersPanel';
import { MemoryServer } from './memoryApi';
import { ModerationDialog } from './SafetyDialogs';
import { setCommunityApiForTesting, useCommunityStore } from './useCommunityStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

/** Renders the safety UI against the in-memory server, as each kind of person sees it. */
describe('safety UI (smoke)', () => {
  let server: MemoryServer;
  let alice: string;
  let bob: string;
  let carol: string;
  let cid: string;
  let general: string;
  let host: HTMLDivElement;
  let root: Root;

  const as = async (who: string) => {
    setCommunityApiForTesting(server.api(who));
    useCommunityStore.getState().reset();
    await act(async () => {
      await useCommunityStore.getState().init();
    });
  };
  const mount = async <P extends object>(node: ComponentType<P>, props: P) => {
    await act(async () => {
      root.render(createElement(TooltipProvider, null, createElement(node, props)));
    });
    await tick();
  };

  beforeEach(async () => {
    localStorage.clear();
    server = new MemoryServer();
    alice = server.addUser('alice', 'Alice A', 'https://cdn.test/avatars/alice.webp');
    bob = server.addUser('bob', 'Bob B');
    carol = server.addUser('carol', 'Carol C');
    cid = await server.api(alice).createCommunity({ name: 'Pact Club', description: '', hue: 200 });
    const inv = await server.api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
    await server.api(bob).joinCommunity(inv.code);
    await server.api(carol).joinCommunity(inv.code);
    await server.api(alice).setRole(cid, bob, 'mod');
    general = server.channels.find((c) => c.communityId === cid)?.id as string;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useCommunityStore.getState().reset();
    setCommunityApiForTesting(null);
    document.body.innerHTML = '';
  });

  const channelOf = () => useCommunityStore.getState().channels[cid]?.[0];

  it('the composer counts down slowmode and disables sending; moderators see it doesn’t apply to them', async () => {
    await server.api(alice).setSlowmode(general, 30);
    await as(carol);
    await act(async () => {
      await useCommunityStore.getState().send('first', []);
    });
    await mount(Composer, { communityId: cid, channel: channelOf() as NonNullable<ReturnType<typeof channelOf>>, role: 'member' });
    expect(host.textContent).toMatch(/Slowmode: you can send again in (29|30)s/);
    expect(host.textContent).toMatch(/(29|30)s/);
    const send = host.querySelector('button[aria-label^="Send message"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await as(bob);
    await mount(Composer, { communityId: cid, channel: channelOf() as NonNullable<ReturnType<typeof channelOf>>, role: 'mod' });
    expect(host.textContent).toContain('doesn’t apply to you');
  });

  it('a timed-out member sees why, with the end time, and cannot type or send', async () => {
    await server.api(bob).timeoutMember(cid, carol, 3600);
    await as(carol);
    await mount(Composer, { communityId: cid, channel: channelOf() as NonNullable<ReturnType<typeof channelOf>>, role: 'member' });
    expect(host.textContent).toContain('You’re timed out until');
    expect(host.textContent).toContain('You can read, but not send messages or react');
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect((host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('button[aria-label="Attach images, GIFs or video"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the members list shows avatars and a "Timed out" badge, and offers the right actions', async () => {
    await server.api(bob).timeoutMember(cid, carol, 600);
    await as(alice);
    const community = useCommunityStore.getState().communities[0];
    await mount(MembersPanel, { community: community as NonNullable<typeof community> });
    expect(host.textContent).toContain('Timed out');
    expect(host.querySelector('img[src="https://cdn.test/avatars/alice.webp"]')).not.toBeNull();
    // the admin gets an actions menu on every other person; nobody gets one on themselves
    expect(host.querySelector('button[aria-label="Actions for Carol C"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Actions for Bob B"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Actions for Alice A"]')).toBeNull();
    await as(carol);
    await mount(MembersPanel, {
      community: useCommunityStore.getState().communities[0] as NonNullable<ReturnType<typeof useCommunityStore.getState>['communities'][0]>,
    });
    expect(host.querySelector('button[aria-label^="Actions for"]')).toBeNull(); // a plain member can do nothing to anyone
  });

  it('the moderation dialog sets slowmode per channel and lists bans with an Unban button where allowed', async () => {
    await server.api(bob).banMember(cid, carol, 'spam');
    const dave = server.addUser('dave', 'Dave D');
    const inv = await server.api(alice).createInvite(cid, { maxUses: null, expiresInHours: null });
    await server.api(dave).joinCommunity(inv.code);
    await server.api(alice).banMember(cid, dave, 'by the admin');
    await as(bob);
    const community = useCommunityStore.getState().communities[0];
    let tab: 'slowmode' | 'bans' = 'slowmode';
    const render = () =>
      mount(ModerationDialog, {
        community: community as NonNullable<typeof community>,
        tab,
        onTabChange: (t) => (tab = t),
        open: true,
        onOpenChange: () => {},
      });
    await render();
    expect(document.body.textContent).toContain('Slowmode limits how often');
    expect(document.body.querySelector('button[aria-label="Slowmode for #general"]')).not.toBeNull();
    tab = 'bans';
    await render();
    await tick(10);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Carol C');
    expect(text).toContain('“spam”');
    expect(text).toContain('Dave D');
    expect(text).toContain('by the admin');
    // bob issued Carol's ban, the admin issued Dave's
    const unbans = [...document.body.querySelectorAll('li')].filter((li) => li.textContent?.includes('Carol C') || li.textContent?.includes('Dave D'));
    expect(unbans.find((li) => li.textContent?.includes('Carol C'))?.textContent).toContain('Unban');
    expect(unbans.find((li) => li.textContent?.includes('Dave D'))?.textContent).not.toContain('Unban');
  });
});
