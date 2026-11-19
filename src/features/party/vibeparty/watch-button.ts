/**
 * The "Watch together" button on a YouTube watch page.
 *
 * It lives next to the like / share buttons, where people already look for "do something with this video". YouTube
 * re-renders that row whenever it likes (navigation, theater mode, A/B layouts), so the button never trusts that its
 * place is still there: a light tick re-attaches it, and when no known row exists at all it settles for a small
 * floating button in the corner rather than disappearing.
 *
 * Everything inside is in a shadow root, so YouTube's CSS can't restyle it and ours can't leak — and keystrokes
 * stop at that root, so Space/Enter on the button never reach YouTube's own hotkeys.
 */

export const WATCH_BUTTON_ID = 'pact-watch-together';

/**
 * Where YouTube keeps the row of like / share / download buttons, newest layout first. When YouTube changes its markup,
 * this list is the one place to update (the floating fallback covers the gap until then).
 */
export const ACTION_ROW_SELECTORS = [
  'ytd-watch-metadata #top-level-buttons-computed',
  '#above-the-fold #top-level-buttons-computed',
  'ytd-watch-metadata #actions-inner #menu',
  '#actions #top-level-buttons-computed',
  '#menu-container #top-level-buttons-computed',
] as const;

export function findActionRow(doc: Document = document): HTMLElement | null {
  for (const selector of ACTION_ROW_SELECTORS) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

export type WatchButtonState = { inParty: boolean; people: number };

export type WatchButtonOptions = {
  onClick(): void;
  /** Is this a page the button belongs on (a video's watch page)? */
  isWatchPage(): boolean;
  /** How long to look for the like / share row before using the floating button (ms). */
  fallbackAfterMs?: number;
  tickMs?: number;
  doc?: Document;
  now?: () => number;
};

const CSS = `
:host { all: initial; display: inline-flex; flex: none; align-items: center; margin-left: 8px; }
:host([data-float]) { position: fixed; right: 16px; bottom: 24px; z-index: 2147483000; margin: 0; }
button {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 11px;
  border-radius: 10px; background: oklch(0.705 0.213 47.6); color: oklch(0.16 0.03 50);
  font: 500 14px/20px Roboto, Arial, sans-serif; white-space: nowrap; cursor: pointer;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 28%);
  transition: filter 0.15s, transform 0.12s;
}
:host([data-float]) button { height: 40px; box-shadow: inset 0 1px 0 oklch(1 0 0 / 28%), 0 6px 20px oklch(0 0 0 / 40%); }
button:hover { filter: brightness(1.08); }
button:active { transform: scale(0.97); }
button:focus-visible { outline: 2px solid oklch(0.705 0.213 47.6); outline-offset: 2px; }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
:host([data-party]) button { background: oklch(0.705 0.213 47.6 / 18%); color: oklch(0.8 0.17 55); box-shadow: inset 0 0 0 1px oklch(0.705 0.213 47.6 / 45%); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The "disc" mark, built node by node (no innerHTML on youtube.com). */
function discIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, attrs: Record<string, string>) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  };
  add('circle', { cx: '12', cy: '12', r: '10' });
  add('path', { d: 'M6 12c0-3.31 2.69-6 6-6' });
  add('path', { d: 'M18 12c0 3.31-2.69 6-6 6' });
  add('circle', { cx: '12', cy: '12', r: '1.5' });
  return svg;
}

export class WatchTogetherButton {
  private readonly doc: Document;
  private readonly now: () => number;
  private host: HTMLElement | null = null;
  private button!: HTMLButtonElement;
  private label!: HTMLElement;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** When we first looked for a row on this watch page and found none. */
  private searchingSince: number | null = null;
  private state: WatchButtonState = { inParty: false, people: 0 };

  constructor(private readonly options: WatchButtonOptions) {
    this.doc = options.doc ?? document;
    this.now = options.now ?? Date.now;
  }

  mount(): void {
    if (this.host) return;
    this.doc.getElementById(WATCH_BUTTON_ID)?.remove(); // an orphan from a previous content-script instance

    const host = this.doc.createElement('div');
    host.id = WATCH_BUTTON_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = this.doc.createElement('style');
    style.textContent = CSS;
    this.label = this.doc.createElement('span');
    this.button = this.doc.createElement('button');
    this.button.type = 'button';
    this.button.append(discIcon(), this.label);
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.options.onClick();
    });
    for (const type of ['keydown', 'keyup', 'keypress'] as const) shadow.addEventListener(type, (e) => e.stopPropagation());
    shadow.append(style, this.button);
    this.host = host;
    this.render();

    this.timer = setInterval(() => this.place(), this.options.tickMs ?? 1_500);
    this.place();
  }

  unmount(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.host?.remove();
    this.host = null;
  }

  setState(state: WatchButtonState): void {
    this.state = state;
    this.render();
  }

  /** The page changed (YouTube navigates without reloading): look for a place again from scratch. */
  refresh(): void {
    this.searchingSince = null;
    this.place();
  }

  /** Where the button currently is — for tests and diagnostics. */
  get placement(): 'row' | 'floating' | 'hidden' {
    if (!this.host?.isConnected) return 'hidden';
    return this.host.hasAttribute('data-float') ? 'floating' : 'row';
  }

  private render(): void {
    if (!this.host) return;
    const { inParty, people } = this.state;
    this.host.toggleAttribute('data-party', inParty);
    this.label.replaceChildren(
      ...(inParty ? [this.dot(), this.doc.createTextNode(people > 1 ? `In party · ${people}` : 'In party')] : [this.doc.createTextNode('Watch together')]),
    );
    this.button.setAttribute('aria-label', inParty ? 'Open the VibeParty panel' : 'Watch this video together with friends');
    this.button.title = inParty ? 'Open the VibeParty panel' : 'Start a watch party for this video — you’ll get a link to send';
  }

  private dot(): HTMLElement {
    const dot = this.doc.createElement('span');
    dot.className = 'dot';
    return dot;
  }

  private place(): void {
    const host = this.host;
    if (!host) return;
    if (!this.options.isWatchPage()) {
      this.searchingSince = null;
      host.remove();
      return;
    }
    const row = findActionRow(this.doc);
    if (row) {
      this.searchingSince = null;
      host.removeAttribute('data-float');
      // Already in the row (YouTube may re-render around us, so check every time).
      if (host.parentElement !== row) row.append(host);
      return;
    }
    this.searchingSince ??= this.now();
    if (this.now() - this.searchingSince >= (this.options.fallbackAfterMs ?? 6_000)) {
      host.setAttribute('data-float', '');
      if (host.parentElement !== this.doc.documentElement) this.doc.documentElement.append(host);
    }
  }
}
