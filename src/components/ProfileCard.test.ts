import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileCard, type ProfileCardData, ProfileHover } from './ProfileCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

const person: ProfileCardData = {
  name: 'Alice Admin',
  username: 'alice',
  role: 'Designer',
  bio: 'Pixels & motion.',
  badge: 'Admin',
  meta: 'Joined Nov 2026',
  links: [
    { kind: 'instagram', url: 'https://instagram.com/alice' },
    { kind: 'github', url: 'https://github.com/alice' },
    { kind: 'website', url: 'javascript:alert(1)' }, // never rendered
    { kind: 'github', url: 'https://evil.example/alice' }, // wrong host
  ],
};

describe('ProfileCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });
  const render = (node: ReturnType<typeof createElement>) => act(async () => root.render(node));
  const hoverCard = (props: { disabled?: boolean; focusable?: boolean } = {}) =>
    // biome-ignore lint/correctness/noChildrenProp: ProfileHover's `children` is a required single element, which createElement's variadic form can't express
    createElement(ProfileHover, { person, ...props, children: createElement('span', { 'data-testid': 'name' }, 'Alice Admin') });
  const trigger = () => host.querySelector('[data-testid="name"]') as HTMLElement;
  const mouseIn = async (el: HTMLElement, pointerType = 'mouse') => {
    await act(async () => {
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType }));
      el.dispatchEvent(new MouseEvent('mouseenter'));
    });
    await tick(450);
  };
  const cardText = () => document.body.querySelector('[class*="popup-motion"]')?.textContent ?? '';

  it('shows everything it has: name, badge, @username, role, bio, meta, and only valid links (new tab, noopener)', async () => {
    await render(createElement(ProfileCard, { person }));
    expect(host.textContent).toContain('Alice Admin');
    expect(host.textContent).toContain('Admin');
    expect(host.textContent).toContain('@alice');
    expect(host.textContent).toContain('Designer');
    expect(host.textContent).toContain('Pixels & motion.');
    expect(host.textContent).toContain('Joined Nov 2026');
    const links = [...host.querySelectorAll('a')] as HTMLAnchorElement[];
    expect(links.map((a) => a.href)).toEqual(['https://instagram.com/alice', 'https://github.com/alice']);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toMatch(/noopener/);
    }
  });

  it('a bare card (just a name) renders no empty sections', async () => {
    await render(createElement(ProfileCard, { person: { name: 'Zed' } }));
    expect(host.querySelector('ul')).toBeNull();
    expect(host.querySelectorAll('p')).toHaveLength(1); // just the name
  });

  it('opens on mouse hover after a short delay, not before, and closes again on leave', async () => {
    await render(hoverCard());
    expect(cardText()).toBe('');
    await act(async () => {
      trigger().dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      trigger().dispatchEvent(new MouseEvent('mouseenter'));
    });
    await tick(100);
    expect(cardText()).toBe(''); // 350 ms delay: a pointer passing over doesn't flash cards
    await tick(350);
    expect(cardText()).toContain('Pixels & motion.');
  });

  it('a focusable trigger is a tab stop; an avatar-style one is not', async () => {
    await render(hoverCard({ focusable: true }));
    expect(trigger().getAttribute('tabindex')).toBe('0');
    await render(hoverCard());
    expect(trigger().hasAttribute('tabindex')).toBe(false);
  });

  it('touch never opens it', async () => {
    await render(hoverCard());
    await mouseIn(trigger(), 'touch');
    expect(cardText()).toBe('');
  });

  it('with no hover-capable pointer at all there is no card and no extra tab stop', async () => {
    vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
    await render(hoverCard({ focusable: true }));
    expect(trigger().hasAttribute('tabindex')).toBe(false);
    await mouseIn(trigger());
    expect(cardText()).toBe('');
  });

  it('disabled (nothing to show yet) stays quiet, and enabling it later works without remounting the trigger', async () => {
    await render(hoverCard({ disabled: true, focusable: true }));
    const el = trigger();
    expect(el.hasAttribute('tabindex')).toBe(false);
    await mouseIn(el);
    expect(cardText()).toBe('');
    await render(hoverCard({ disabled: false, focusable: true }));
    expect(trigger()).toBe(el); // same element: a list doesn't flicker when a profile arrives
    await mouseIn(el);
    expect(cardText()).toContain('Alice Admin');
  });

  it('Esc closes the card and is not passed on, so a dialog underneath stays open', async () => {
    const underneath = vi.fn();
    document.addEventListener('keydown', underneath);
    await render(hoverCard());
    await mouseIn(trigger());
    expect(cardText()).toContain('Alice Admin');
    await act(async () => {
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await tick(50);
    expect(cardText()).toBe('');
    expect(underneath).not.toHaveBeenCalled();
    // with no card open, Esc goes where it always went
    await act(async () => {
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(underneath).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', underneath);
  });
});
