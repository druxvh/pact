import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findActionRow, WATCH_BUTTON_ID, WatchTogetherButton } from './watch-button';

const NEW_LAYOUT =
  '<ytd-watch-metadata><div id="actions"><div id="actions-inner"><div id="menu"><div id="top-level-buttons-computed"><button>Like</button><button>Share</button></div></div></div></div></ytd-watch-metadata>';
const OLD_LAYOUT = '<div id="menu-container"><div id="top-level-buttons-computed"><button>Like</button></div></div>';

let onWatchPage = true;
let button: WatchTogetherButton | null = null;
const onClick = vi.fn();

function mount(opts: { fallbackAfterMs?: number } = {}) {
  button = new WatchTogetherButton({ onClick, isWatchPage: () => onWatchPage, fallbackAfterMs: opts.fallbackAfterMs ?? 6_000, tickMs: 500 });
  button.mount();
  return button;
}
const host = () => document.getElementById(WATCH_BUTTON_ID);
const inner = <T extends Element = HTMLElement>(sel: string) => host()?.shadowRoot?.querySelector(sel) as T;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  onWatchPage = true;
});
afterEach(() => {
  button?.unmount();
  button = null;
  vi.useRealTimers();
});

describe('finding the like / share row', () => {
  it('knows the current layout and the older ones', () => {
    document.body.innerHTML = NEW_LAYOUT;
    expect(findActionRow()?.id).toBe('top-level-buttons-computed');
    document.body.innerHTML = OLD_LAYOUT;
    expect(findActionRow()?.id).toBe('top-level-buttons-computed');
    document.body.innerHTML = '<div>nothing here</div>';
    expect(findActionRow()).toBeNull();
  });
});

describe('placement', () => {
  it('sits in the row next to the like / share buttons', () => {
    document.body.innerHTML = NEW_LAYOUT;
    mount();
    const row = document.getElementById('top-level-buttons-computed');
    expect(host()?.parentElement).toBe(row);
    expect(button?.placement).toBe('row');
    expect(inner('button').textContent).toBe('Watch together');
    expect(inner('button').getAttribute('aria-label')).toMatch(/watch this video together/i);
  });

  it('waits for a row YouTube hasn’t rendered yet, then moves in', () => {
    mount();
    expect(button?.placement).toBe('hidden'); // not yet: still looking
    document.body.innerHTML = NEW_LAYOUT;
    vi.advanceTimersByTime(600);
    expect(button?.placement).toBe('row');
  });

  it('falls back to a floating button when no row appears, and moves into the row if one shows up later', () => {
    mount({ fallbackAfterMs: 3_000 });
    vi.advanceTimersByTime(2_000);
    expect(button?.placement).toBe('hidden');
    vi.advanceTimersByTime(1_500);
    expect(button?.placement).toBe('floating');
    expect(host()?.parentElement).toBe(document.documentElement);

    document.body.innerHTML = OLD_LAYOUT;
    vi.advanceTimersByTime(600);
    expect(button?.placement).toBe('row');
    expect(host()?.hasAttribute('data-float')).toBe(false);
  });

  it('re-attaches itself when YouTube re-renders the row out from under it', () => {
    document.body.innerHTML = NEW_LAYOUT;
    mount();
    document.body.innerHTML = NEW_LAYOUT; // a navigation: the whole subtree is replaced
    expect(button?.placement).toBe('hidden');
    vi.advanceTimersByTime(600);
    expect(button?.placement).toBe('row');
    expect(document.querySelectorAll(`#${WATCH_BUTTON_ID}`)).toHaveLength(1);
  });

  it('leaves non-watch pages alone, and comes back on a watch page', () => {
    document.body.innerHTML = NEW_LAYOUT;
    onWatchPage = false;
    mount();
    expect(host()).toBeNull();
    onWatchPage = true;
    button?.refresh();
    expect(button?.placement).toBe('row');
    onWatchPage = false;
    vi.advanceTimersByTime(600);
    expect(host()).toBeNull();
  });

  it('replaces an orphan left by a previous content-script instance and cleans up on unmount', () => {
    document.body.innerHTML = NEW_LAYOUT;
    const orphan = document.createElement('div');
    orphan.id = WATCH_BUTTON_ID;
    document.body.append(orphan);
    mount();
    expect(document.querySelectorAll(`#${WATCH_BUTTON_ID}`)).toHaveLength(1);
    expect(host()).not.toBe(orphan);
    button?.unmount();
    expect(host()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the button', () => {
  it('reports clicks without letting them (or the keys) reach YouTube', () => {
    document.body.innerHTML = NEW_LAYOUT;
    mount();
    const pageClick = vi.fn();
    const pageKey = vi.fn();
    document.addEventListener('click', pageClick);
    document.addEventListener('keydown', pageKey);
    inner('button').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    inner('button').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(pageClick).not.toHaveBeenCalled();
    expect(pageKey).not.toHaveBeenCalled();
    document.removeEventListener('click', pageClick);
    document.removeEventListener('keydown', pageKey);
  });

  it('shows the party state instead of offering to start another', () => {
    document.body.innerHTML = NEW_LAYOUT;
    mount();
    button?.setState({ inParty: true, people: 3 });
    expect(inner('button').textContent).toBe('In party · 3');
    expect(host()?.hasAttribute('data-party')).toBe(true);
    expect(inner('button').getAttribute('aria-label')).toMatch(/open the vibeparty panel/i);
    button?.setState({ inParty: true, people: 1 });
    expect(inner('button').textContent).toBe('In party');
    button?.setState({ inParty: false, people: 0 });
    expect(inner('button').textContent).toBe('Watch together');
  });
});
