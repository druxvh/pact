import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_HOST_ID, type OverlayCallbacks, VibePartyOverlay } from './overlay';
import type { ChatMessage, QueueItem } from './protocol';
import { watchUrlFor } from './protocol';

const noop = () => {};
function callbacks(over: Partial<OverlayCallbacks> = {}): OverlayCallbacks {
  return {
    onJoin: noop,
    onStart: noop,
    onLeave: noop,
    onRetry: noop,
    onOpenPact: noop,
    onChat: noop,
    onReaction: noop,
    onQueueAdd: async () => null,
    onQueueAddCurrent: async () => null,
    onQueueVote: noop,
    onQueueRemove: noop,
    onQueuePlay: noop,
    onFollow: noop,
    onPrefsChange: noop,
    ...over,
  };
}

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: crypto.randomUUID(), peerId: 'p1', name: 'Sam', text: 'hi', at: Date.now(), ...over });
const item = (n: number, over: Partial<QueueItem> = {}): QueueItem => ({
  id: `q${n}`,
  videoId: `video${String(n).padStart(6, '0')}`,
  url: watchUrlFor(`video${String(n).padStart(6, '0')}`),
  title: `Song ${n}`,
  addedBy: 'p1',
  addedByName: 'Sam',
  voters: ['p1'],
  createdAt: n,
  ...over,
});

let overlay: VibePartyOverlay;
let root: ShadowRoot;
const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const qa = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll(sel)] as T[];

function mount(cb: OverlayCallbacks = callbacks()) {
  overlay = new VibePartyOverlay(cb);
  overlay.mount();
  const host = document.getElementById(OVERLAY_HOST_ID);
  if (!host?.shadowRoot) throw new Error('overlay did not mount');
  root = host.shadowRoot;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Element.prototype.scrollTo ??= () => {};
});
afterEach(() => {
  overlay?.unmount();
  document.getElementById(OVERLAY_HOST_ID)?.remove();
});

describe('typing in the panel', () => {
  it('keeps keystrokes away from YouTube’s global hotkeys (but not from the panel’s own handlers)', () => {
    const hotkey = vi.fn();
    document.addEventListener('keydown', hotkey);
    document.addEventListener('keyup', hotkey);
    document.addEventListener('keypress', hotkey);
    const onJoin = vi.fn();
    mount(callbacks({ onJoin }));

    const room = q<HTMLInputElement>('#vp-room');
    room.value = 'friday-vibes';
    for (const type of ['keydown', 'keyup', 'keypress']) room.dispatchEvent(new KeyboardEvent(type, { key: ' ', bubbles: true, composed: true }));
    room.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(hotkey).not.toHaveBeenCalled(); // YouTube never saw a single key
    expect(onJoin).toHaveBeenCalledWith('friday-vibes', 'guest'); // …yet Enter still submitted the form

    // control: the same keys outside the panel do reach the document
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(hotkey).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', hotkey);
  });
});

describe('untrusted content', () => {
  beforeEach(() => {
    mount();
    overlay.setSelf('me');
    overlay.setRoom('friday-vibes');
  });

  it('renders chat as text, never as markup', () => {
    overlay.pushChat(msg({ name: '<img src=x onerror=alert(1)>', text: '<script>alert(1)</script><img src=x onerror=alert(2)>' }));
    const el = q('.vp-msg');
    expect(el.querySelector('img, script')).toBeNull();
    expect(el.querySelector('.vp-msg-text')?.textContent).toBe('<script>alert(1)</script><img src=x onerror=alert(2)>');
    expect(el.querySelector('.vp-msg-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('renders queue titles and names as text', () => {
    overlay.setQueue([item(1, { title: '<b onmouseover=alert(1)>bold</b>', addedByName: '<i>x</i>' })]);
    expect(q('.vp-item').querySelector('b, i')).toBeNull();
    expect(q('.vp-item-title').textContent).toBe('<b onmouseover=alert(1)>bold</b>');
  });

  it('ignores a repeated message id and groups quick consecutive messages from one sender', () => {
    const first = msg({ id: 'a', at: 1000 });
    overlay.pushChat(first);
    overlay.pushChat(first);
    overlay.pushChat(msg({ id: 'b', at: 2000 }));
    overlay.pushChat(msg({ id: 'c', at: 2000, peerId: 'p2', name: 'Riley' }));
    expect(qa('.vp-msg')).toHaveLength(3);
    expect(qa('.vp-msg').map((m) => m.classList.contains('vp-msg--grouped'))).toEqual([false, true, false]);
  });
});

describe('structure & accessibility', () => {
  beforeEach(() => {
    mount();
    overlay.setSelf('me');
    overlay.setRoom('friday-vibes');
  });

  it('is a labelled landmark with real tab semantics', () => {
    expect(q('aside').getAttribute('aria-label')).toBe('VibeParty');
    const tabs = qa('[role=tab]');
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1]); // roving tabindex
    for (const t of tabs) expect(q(`#${t.getAttribute('aria-controls')}`).getAttribute('role')).toBe('tabpanel');
    expect(q('#vp-pane-queue').hidden).toBe(true);
    expect(q('[role=log]').getAttribute('aria-live')).toBe('polite');
  });

  it('arrow keys move between tabs and show the right panel', () => {
    const [chat, queue] = qa('[role=tab]') as [HTMLElement, HTMLElement];
    chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
    expect(queue.getAttribute('aria-selected')).toBe('true');
    expect(q('#vp-pane-queue').hidden).toBe(false);
    expect(q('#vp-pane-chat').hidden).toBe(true);
    queue.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, composed: true }));
    expect(chat.getAttribute('aria-selected')).toBe('true');
  });

  it('every control has an accessible name', () => {
    overlay.setQueue([item(1), item(2, { addedBy: 'me' })]);
    for (const el of qa('button, input')) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim() || (el.id && root.querySelector(`label[for="${el.id}"]`)?.textContent);
      expect(name, el.outerHTML.slice(0, 120)).toBeTruthy();
    }
  });

  it('vote buttons announce state and count; your own items can be removed, others’ cannot', () => {
    overlay.setQueue([item(1, { voters: ['p1', 'me'] }), item(2, { addedBy: 'me' })]);
    const votes = qa('.vp-vote');
    expect(votes[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(votes[0]?.getAttribute('aria-label')).toBe('Remove your vote from Song 1 (2 votes)');
    expect(votes[1]?.getAttribute('aria-label')).toBe('Upvote Song 2 (1 vote)');
    expect(qa('.vp-item')[0]?.querySelector('[data-action=remove]')).toBeNull();
    expect(qa('.vp-item')[1]?.querySelector('[data-action=remove]')).not.toBeNull();
  });

  it('collapsing makes the panel inert and persists the preference', () => {
    const onPrefsChange = vi.fn();
    overlay.unmount();
    mount(callbacks({ onPrefsChange }));
    overlay.setRoom('friday-vibes');
    q('.vp-icon-btn[aria-label^="Minimize"]').click();
    expect(q('.vp').dataset.collapsed).toBe('true');
    expect((q('.vp-panel') as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(q('.vp-fab').getAttribute('aria-expanded')).toBe('false');
    expect(onPrefsChange).toHaveBeenCalledWith({ collapsed: true, autoFollow: false });
  });
});

describe('behaviour', () => {
  it('rejects a malformed room code inline, accepts a good one, and prefills the saved name', () => {
    const onJoin = vi.fn();
    mount(callbacks({ onJoin }));
    overlay.setSavedName('Alex');
    q<HTMLInputElement>('#vp-room').value = '!';
    q('.vp-submit').click();
    expect(onJoin).not.toHaveBeenCalled();
    expect(q('#vp-room').getAttribute('aria-invalid')).toBe('true');
    expect(q('.vp-join .vp-error').textContent).toMatch(/4–32/);

    q<HTMLInputElement>('#vp-room').value = '  Friday Vibes ';
    q('.vp-submit').click();
    expect(onJoin).toHaveBeenCalledWith('friday-vibes', 'Alex');
  });

  it('“New” fills in a secure room code', () => {
    mount();
    [...root.querySelectorAll('.vp-join .vp-btn')].find((b) => b.textContent?.includes('New'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(q<HTMLInputElement>('#vp-room').value).toMatch(/^[a-z]+-[a-z]+-[a-z2-9]{8}$/);
  });

  it('sends chat on Enter (not while composing), clears the box, and ignores empty input', () => {
    const onChat = vi.fn();
    mount(callbacks({ onChat }));
    overlay.setRoom('friday-vibes');
    const input = q<HTMLInputElement>('.vp-composer input');
    const press = (init: KeyboardEventInit) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, ...init }));
    press({});
    input.value = '  hello ';
    press({ isComposing: true });
    expect(onChat).not.toHaveBeenCalled();
    press({});
    expect(onChat).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');
  });

  it('shows the add-queue error from the callback inline', async () => {
    mount(callbacks({ onQueueAdd: async () => 'That doesn’t look like a YouTube link.' }));
    overlay.setRoom('friday-vibes');
    const input = q<HTMLInputElement>('#vp-pane-queue input');
    input.value = 'nope';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    await vi.waitFor(() => expect(q('#vp-pane-queue .vp-error').textContent).toMatch(/YouTube/));
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('counts unread messages while collapsed and clears them on expand', () => {
    mount();
    overlay.setSelf('me');
    overlay.setRoom('friday-vibes');
    q('.vp-icon-btn[aria-label^="Minimize"]').click();
    overlay.pushChat(msg());
    expect(q('.vp-fab .vp-dot').hidden).toBe(false);
    q('.vp-fab').click();
    expect(q('.vp-fab .vp-dot').hidden).toBe(true);
  });

  it('shows ad / autoplay / follow notices and clears only the requested kind', () => {
    const onFollow = vi.fn();
    mount(callbacks({ onFollow }));
    overlay.setRoom('friday-vibes');
    overlay.setNotice({ kind: 'mismatch', videoId: 'dQw4w9WgXcQ' });
    expect(q('.vp-notice:not(.vp-link-notice)').hidden).toBe(false);
    [...root.querySelectorAll('.vp-notice button')].find((b) => b.textContent === 'Go to it')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onFollow).toHaveBeenCalledWith('dQw4w9WgXcQ');
    overlay.clearNotice('ad'); // different kind: stays
    expect(q('.vp-notice:not(.vp-link-notice)').hidden).toBe(false);
    overlay.clearNotice('mismatch');
    expect(q('.vp-notice:not(.vp-link-notice)').hidden).toBe(true);
  });

  it('re-mounting replaces an orphaned panel instead of stacking a second one', () => {
    mount();
    mount();
    expect(document.querySelectorAll(`#${OVERLAY_HOST_ID}`)).toHaveLength(1);
  });
});

describe('starting, joining and being invited', () => {
  const host = () => document.getElementById(OVERLAY_HOST_ID) as HTMLElement;

  it('stays out of the way until asked: hidden when there is no party, shown by openJoin, closed again by the X', () => {
    mount();
    expect(host().style.display).toBe('none');
    overlay.openJoin();
    expect(host().style.display).toBe('block');
    expect(q('.vp').dataset.view).toBe('join');
    expect(q('.vp').dataset.collapsed).toBe('false'); // minimize doesn't apply here
    q('.vp-header-join').click();
    expect(host().style.display).toBe('none');
    overlay.setRoom('friday-vibes');
    expect(host().style.display).toBe('block');
    expect(q('.vp').dataset.view).toBe('party');
    overlay.setRoom(null);
    expect(host().style.display).toBe('none'); // leaving a party doesn't pop the join panel back up
  });

  it('"Start a party" reports the name typed (or guest) and needs a video', () => {
    const onStart = vi.fn();
    mount(callbacks({ onStart }));
    overlay.openJoin();
    overlay.setStartable(false);
    expect(q<HTMLButtonElement>('.vp-start').disabled).toBe(true);
    overlay.setStartable(true);
    q('.vp-start').click();
    expect(onStart).toHaveBeenLastCalledWith('guest');
    q<HTMLInputElement>('#vp-name').value = 'Alex';
    q('.vp-start').click();
    expect(onStart).toHaveBeenLastCalledWith('Alex');
  });

  it('accepts a pasted invite link or the whole invite text in the code field', () => {
    const onJoin = vi.fn();
    mount(callbacks({ onJoin }));
    q<HTMLInputElement>('#vp-room').value =
      `🍿 Join my VibeParty — room code: amber-lofi-k7q2x9dm\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&pact=amber-lofi-k7q2x9dm`;
    q('.vp-submit').click();
    expect(onJoin).toHaveBeenCalledWith('amber-lofi-k7q2x9dm', 'guest');

    q<HTMLInputElement>('#vp-room').value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // a plain video link has no code
    q('.vp-submit').click();
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(q('#vp-room').getAttribute('aria-invalid')).toBe('true');
  });

  it('offers an invite from a link — it opens the panel and prefills the code, but joins only on a click', () => {
    const onJoin = vi.fn();
    mount(callbacks({ onJoin }));
    overlay.setSavedName('Alex');
    overlay.setInvite('amber-lofi-k7q2x9dm');
    expect(host().style.display).toBe('block');
    expect(q('.vp-invite').hidden).toBe(false);
    expect(q('.vp-invite').textContent).toContain('amber-lofi-k7q2x9dm');
    expect(q<HTMLInputElement>('#vp-room').value).toBe('amber-lofi-k7q2x9dm');
    expect(onJoin).not.toHaveBeenCalled();
    q('.vp-invite .vp-btn--primary').click();
    expect(onJoin).toHaveBeenCalledWith('amber-lofi-k7q2x9dm', 'Alex');

    overlay.setInvite(null);
    expect(q('.vp-invite').hidden).toBe(true);
  });

  it('an invite to another party while in one asks before switching, and ignores one to the room you are in', () => {
    const onJoin = vi.fn();
    mount(callbacks({ onJoin }));
    overlay.setRoom('friday-vibes');
    overlay.setInvite('friday-vibes');
    expect(q('.vp-notice:not(.vp-link-notice)').hidden).toBe(true);
    overlay.setInvite('other-party-code');
    expect(q('.vp-notice:not(.vp-link-notice)').hidden).toBe(false);
    expect(onJoin).not.toHaveBeenCalled();
    [...root.querySelectorAll('.vp-notice button')].find((b) => b.textContent === 'Switch party')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onJoin).toHaveBeenCalledWith('other-party-code', 'guest');
  });

  it('copies an invite with the code and a link to the current video', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount();
    overlay.setCurrentVideo('dQw4w9WgXcQ');
    expect(await overlay.copyInvite('amber-lofi-k7q2x9dm')).toBe(true); // before the room is set: the start flow
    expect(writeText).toHaveBeenCalledWith(
      '🍿 Join my VibeParty — room code: amber-lofi-k7q2x9dm\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&pact=amber-lofi-k7q2x9dm',
    );
    overlay.setRoom('friday-vibes');
    q('.vp-header .vp-icon-btn[aria-label="Copy invite link"]').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('pact=friday-vibes'));

    writeText.mockRejectedValueOnce(new Error('denied'));
    expect(await overlay.copyInvite()).toBe(false);
    expect(q('.vp-toast').textContent).toContain('friday-vibes'); // the code is still shown so it can be copied by hand
  });
});

describe('connection state', () => {
  beforeEach(() => {
    mount();
    overlay.setRoom('friday-vibes');
  });
  const notice = () => q('.vp-link-notice');

  it('labels every state honestly', () => {
    const chip = () => ({ mode: q('.vp-mode').dataset.mode, text: q('.vp-mode').textContent });
    overlay.setLink({ mode: 'connecting' });
    expect(chip()).toEqual({ mode: 'connecting', text: 'Connecting…' });
    overlay.setLink({ mode: 'live' });
    expect(chip()).toEqual({ mode: 'live', text: 'Live' });
    overlay.setLink({ mode: 'reconnecting' });
    expect(chip()).toEqual({ mode: 'reconnecting', text: 'Reconnecting…' });
    overlay.setLink({ mode: 'error', reason: 'failed', message: 'Can’t reach the party server.' });
    expect(chip()).toEqual({ mode: 'error', text: 'Offline' });
    overlay.setLink({ mode: 'local', reason: 'signed-out' });
    expect(chip()).toEqual({ mode: 'local', text: 'This browser' });
  });

  it('a signed-out party says only this browser is in it, and offers the way to sign in', () => {
    const onOpenPact = vi.fn();
    overlay.unmount();
    mount(callbacks({ onOpenPact }));
    overlay.setRoom('friday-vibes');
    overlay.setLink({ mode: 'local', reason: 'signed-out' });
    expect(notice().hidden).toBe(false);
    expect(notice().textContent).toMatch(/only this browser/i);
    [...root.querySelectorAll('.vp-link-notice button')]
      .find((b) => b.textContent?.includes('Sign in'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpenPact).toHaveBeenCalled();

    overlay.setLink({ mode: 'local', reason: 'unconfigured' });
    expect(notice().textContent).toMatch(/no account service/i);
    expect(notice().querySelector('button')).toBeNull();
  });

  it('reconnecting explains where changes go; an error offers a retry; live and connecting say nothing extra', () => {
    const onRetry = vi.fn();
    overlay.unmount();
    mount(callbacks({ onRetry }));
    overlay.setRoom('friday-vibes');
    overlay.setLink({ mode: 'reconnecting' });
    expect(notice().textContent).toMatch(/stay on this browser/i);
    overlay.setLink({ mode: 'error', reason: 'failed', message: 'Can’t reach the party server. Still trying…' });
    expect(notice().textContent).toContain('Can’t reach the party server');
    [...root.querySelectorAll('.vp-link-notice button')]
      .find((b) => b.textContent?.includes('Try again'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRetry).toHaveBeenCalled();

    overlay.setLink({ mode: 'live' });
    expect(notice().hidden).toBe(true);
    overlay.setLink({ mode: 'connecting' });
    expect(notice().hidden).toBe(true);
  });

  it('a refused room also offers opening pact (to sign in again)', () => {
    overlay.setLink({ mode: 'error', reason: 'denied', message: 'The server refused this room.' });
    expect([...root.querySelectorAll('.vp-link-notice button')].map((b) => b.textContent?.trim())).toEqual(['Try again', 'Open pact']);
  });
});
