import { MotionConfig } from 'motion/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileCard } from '@/components/ProfileCard';
import { Avatar } from '@/components/ui';
import { PersonHover } from '@/features/chat/PersonHover';
import { MemberHover } from '@/features/community/MemberHover';
import { mount, run } from '@/test/render';
import type { Person } from '@/types/user';
import { Equalizer } from './Equalizer';
import { setNowPlayingApiForTesting, useNowPlayingStore } from './hooks';
import { ListeningRow } from './ListeningRow';
import { MemoryNowPlayingServer } from './memoryApi';
import { PersonAvatar } from './PersonAvatar';
import type { Track } from './track';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const song = (over: Partial<Track> & { title?: string } = {}): Track => ({
  title: 'Night Drive',
  artist: 'The Tests',
  album: 'Fixtures',
  artworkUrl: 'https://i.scdn.co/image/ab67616d',
  trackUrl: 'https://open.spotify.com/track/abc',
  source: 'spotify',
  ...over,
});
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
/** A hover wrapper around a labelled <span> (what the app does with a name or an avatar). */
const hoverOf = (component: unknown, props: Record<string, unknown>, label: string) =>
  // biome-ignore lint/correctness/noChildrenProp: the hover wrappers' `children` is a required single element, which createElement's variadic form can't express
  createElement(component as never, { ...props, children: createElement('span', { 'data-testid': 'n' }, label) });

let unmount: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unmount?.();
  unmount = null;
  document.body.innerHTML = '';
  setNowPlayingApiForTesting(null);
  useNowPlayingStore.getState().reset();
  vi.useRealTimers();
});
const show = async (node: Parameters<typeof mount>[0]) => {
  const m = await mount(node);
  unmount = m.unmount;
  return m.container;
};

describe('the avatar badge', () => {
  it('shows a small "listening" badge only when asked, alongside the presence dot', async () => {
    const plain = await show(createElement(Avatar, { name: 'Alice', status: 'online' }));
    expect(plain.querySelector('[aria-label="Listening to music"]')).toBeNull();
    expect(plain.querySelector('[aria-label="online"]')).not.toBeNull();
    await unmount?.();

    const c = await show(createElement(Avatar, { name: 'Alice', status: 'online', listening: true }));
    unmount = null;
    const badge = c.querySelector('[aria-label="Listening to music"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('role')).toBe('img');
    expect(badge?.querySelector('.np-eq')).not.toBeNull();
    expect(c.querySelector('[aria-label="online"]')).not.toBeNull(); // the dot is still there
    expect(c.firstElementChild?.hasAttribute('aria-hidden')).toBe(false); // so the label can be reached
  });

  it('an avatar without a status or a badge stays hidden from screen readers, as before', async () => {
    const c = await show(createElement(Avatar, { name: 'Alice' }));
    expect(c.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the badge grows with the avatar and is a round badge (no corner above the documented dots)', async () => {
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl'] as const) {
      const c = await show(createElement(Avatar, { name: 'A', size, listening: true }));
      expect(c.querySelector('[aria-label="Listening to music"]')?.className, size).toMatch(/rounded-full/);
      await unmount?.();
      unmount = null;
    }
  });
});

describe('the equalizer', () => {
  it('moves while music plays', async () => {
    const c = await show(createElement(Equalizer, {}));
    expect(c.querySelector('.np-eq')?.getAttribute('data-state')).toBe('live');
    expect(c.querySelectorAll('.np-eq > i')).toHaveLength(3);
  });
  it('is still — not moving — when animations are off in the app', async () => {
    const c = await show(createElement(MotionConfig, { reducedMotion: 'always' }, createElement(Equalizer, {})));
    expect(c.querySelector('.np-eq')?.getAttribute('data-state')).toBe('still');
  });
  it('is still, and dimmed, when paused', async () => {
    const c = await show(createElement(Equalizer, { playing: false }));
    expect(c.querySelector('.np-eq')?.getAttribute('data-state')).toBe('still');
    expect(c.querySelector('.np-eq')?.hasAttribute('data-dim')).toBe(true);
  });
  it('is decorative: hidden from screen readers', async () => {
    const c = await show(createElement(Equalizer, {}));
    expect(c.querySelector('.np-eq')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the "Listening now" row', () => {
  it('shows the cover, title, artist and player, and links to the track', async () => {
    const c = await show(createElement(ListeningRow, { track: song() }));
    expect(c.textContent).toContain('Listening now');
    expect(c.textContent).toContain('Night Drive');
    expect(c.textContent).toContain('The Tests · Spotify');
    const a = c.querySelector('a') as HTMLAnchorElement;
    expect(a.href).toBe('https://open.spotify.com/track/abc');
    expect(a.target).toBe('_blank');
    expect(a.rel).toMatch(/noopener/);
    expect(a.rel).toMatch(/noreferrer/);
    const img = c.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('https://i.scdn.co/image/ab67616d');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('without a link it is not a link; without an artist it names just the player', async () => {
    const c = await show(createElement(ListeningRow, { track: song({ trackUrl: null, artist: '' }) }));
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toContain('Spotify');
    expect(c.textContent).not.toContain('·');
  });

  it('shows another person’s text as text: markup in a title stays characters, and invisible/bidi characters are gone', async () => {
    const evil = {
      title: `<img src=x onerror="alert(1)">${cp(0x202e)}gnp.exe`,
      artist: '<script>alert(2)</script>',
      album: '',
      artworkUrl: null,
      trackUrl: null,
      source: 'spotify',
    } as Track;
    const c = await show(createElement(ListeningRow, { track: evil }));
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelectorAll('img')).toHaveLength(0); // nothing was interpreted as an element
    expect(c.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(c.textContent).not.toContain(cp(0x202e));
  });

  it('re-checks addresses itself: artwork from any other host never becomes an <img>, a bad link is not a link', async () => {
    const hostile = { ...song(), artworkUrl: 'https://attacker.example/pixel.gif?victim=1', trackUrl: 'javascript:alert(1)' } as Track;
    const c = await show(createElement(ListeningRow, { track: hostile }));
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('a')).toBeNull();
    expect(c.innerHTML).not.toContain('attacker.example');
    expect(c.innerHTML).not.toContain('javascript:');
  });

  it('look-alike hosts fail too', async () => {
    for (const artworkUrl of [
      'https://i.scdn.co.evil.example/a.png',
      'https://evil.example/i.scdn.co/a.png',
      'http://i.scdn.co/a.png',
      'https://i.scdn.co@evil.example/a.png',
    ]) {
      const c = await show(createElement(ListeningRow, { track: song({ artworkUrl }) }));
      expect(c.querySelector('img'), artworkUrl).toBeNull();
      await unmount?.();
      unmount = null;
    }
  });

  it('falls back to the coloured tile when the picture can’t be loaded', async () => {
    const c = await show(createElement(ListeningRow, { track: song() }));
    const img = c.querySelector('img') as HTMLImageElement;
    await run(() => void img.dispatchEvent(new Event('error')));
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('svg')).not.toBeNull();
  });

  it('a track that isn’t one (no title, unknown player) renders nothing', async () => {
    for (const bad of [{ ...song(), title: '' }, { ...song(), source: 'napster' }, null, 'x']) {
      const c = await show(createElement(ListeningRow, { track: bad as never }));
      expect(c.innerHTML, JSON.stringify(bad)).toBe('');
      await unmount?.();
      unmount = null;
    }
  });
});

describe('the profile card', () => {
  it('without a track it is exactly what it was — no empty row', async () => {
    const c = await show(createElement(ProfileCard, { person: { name: 'Zed' } }));
    expect(c.textContent).not.toContain('Listening');
    expect(c.querySelectorAll('p')).toHaveLength(1);
  });
  it('with one, the row sits between the bio and the links', async () => {
    const c = await show(
      createElement(ProfileCard, {
        person: { name: 'Alice', bio: 'Pixels.', meta: 'Joined Nov 2026', links: [{ kind: 'github', url: 'https://github.com/alice' }], listening: song() },
      }),
    );
    const html = c.innerHTML;
    expect(html.indexOf('Pixels.')).toBeLessThan(html.indexOf('Listening now'));
    expect(html.indexOf('Listening now')).toBeLessThan(html.indexOf('aria-label="Links"'));
  });
  it('a null track is no row', async () => {
    const c = await show(createElement(ProfileCard, { person: { name: 'Alice', listening: null } }));
    expect(c.textContent).not.toContain('Listening');
  });
});

describe('who shows what on screen', () => {
  const alex: Person = { id: 'alex', displayName: 'Alex Rivera', username: 'alex', designation: 'Designer', bio: '', email: '', isOnline: true };
  const sam: Person = { id: 'sam', displayName: 'Sam Okafor', username: 'sam', designation: '', bio: '', email: '', isOnline: false };

  it('PersonAvatar badges the simulated friends who have a demo track — and only them', async () => {
    const c = await show(
      createElement('div', null, createElement(PersonAvatar, { userId: 'alex', name: 'Alex' }), createElement(PersonAvatar, { userId: 'sam', name: 'Sam' })),
    );
    expect(c.querySelectorAll('[aria-label="Listening to music"]')).toHaveLength(1);
  });

  it('a real account shows the badge once its track is fetched, and drops it when it stops', async () => {
    vi.useFakeTimers();
    const server = new MemoryNowPlayingServer();
    setNowPlayingApiForTesting(server.api(ME));
    server.set(OTHER, song());
    const c = await show(createElement(PersonAvatar, { userId: OTHER, name: 'Other' }));
    expect(c.querySelector('[aria-label="Listening to music"]')).toBeNull(); // nothing yet: lookups are lazy and batched
    await run(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(c.querySelector('[aria-label="Listening to music"]')).not.toBeNull();
    await run(() => void server.clear(OTHER));
    expect(c.querySelector('[aria-label="Listening to music"]')).toBeNull();
  });

  it('with no id it is a plain avatar', async () => {
    const c = await show(createElement(PersonAvatar, { userId: undefined, name: 'Nobody' }));
    expect(c.querySelector('[aria-label="Listening to music"]')).toBeNull();
  });

  it('hovering a friend’s name shows their "Listening now" row in the card', async () => {
    const c = await show(hoverOf(PersonHover, { person: alex }, 'Alex'));
    const trigger = c.querySelector('[data-testid="n"]') as HTMLElement;
    await run(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 450));
    });
    const card = document.body.querySelector('[class*="popup-motion"]')?.textContent ?? '';
    expect(card).toContain('Listening now');
    expect(card).toContain('Midnight City');
    expect(card).toContain('M83');
  });

  it('a friend who isn’t listening gets a plain card', async () => {
    const c = await show(hoverOf(PersonHover, { person: sam }, 'Sam'));
    const trigger = c.querySelector('[data-testid="n"]') as HTMLElement;
    await run(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 450));
    });
    const card = document.body.querySelector('[class*="popup-motion"]')?.textContent ?? '';
    expect(card).toContain('Sam Okafor');
    expect(card).not.toContain('Listening now');
  });

  it('MemberHover does the same for community members', async () => {
    const server = new MemoryNowPlayingServer();
    setNowPlayingApiForTesting(server.api(ME));
    server.set(OTHER, song({ title: 'Community Song' }));
    const profile = { id: OTHER, username: 'other', displayName: 'Other One', designation: '' };
    const c = await show(hoverOf(MemberHover, { profile }, 'Other'));
    await run(() => new Promise<void>((r) => setTimeout(r, 400))); // lookups are batched
    const trigger = c.querySelector('[data-testid="n"]') as HTMLElement;
    await run(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(document.body.querySelector('[class*="popup-motion"]')?.textContent).toContain('Community Song');
  });
});
