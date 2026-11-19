/**
 * The VibeParty panel that lives on YouTube.
 *
 * Plain DOM inside a closed-off shadow root (a framework would add ~140 kB to every YouTube page load for a
 * panel this size). Everything user-supplied is rendered with `textContent` — never innerHTML — so a chat
 * message or a queue title can't inject markup.
 *
 * Accessibility: a labelled `complementary` landmark, real tab semantics (roving tabindex + arrow keys), a
 * polite `log` for chat, `status`/`alert` for notices, visible focus rings, text for every state (not colour
 * alone), and `prefers-reduced-motion` support in the CSS.
 *
 * Typing safety: YouTube binds single-key shortcuts (space, k, j, l, f, m, arrows…) on the document. Because of
 * shadow-DOM event retargeting those handlers can't tell our inputs are inputs, so keystrokes typed here would
 * pause and seek the video. We stop key events at the shadow root instead.
 */
import { generateRoomCode } from '../roomCode.ts';
import { inviteText, lenientRoomCode } from './invite.ts';
import overlayCss from './overlay.css?inline';
import { type ChatMessage, LIMITS, type LinkStatus, type PeerInfo, type QueueItem, type ReactionEvent, thumbnailUrlFor } from './protocol.ts';

export type OverlayPrefs = { collapsed: boolean; autoFollow: boolean };

export type Notice = { kind: 'ad' } | { kind: 'blocked' } | { kind: 'mismatch'; videoId: string } | { kind: 'invite'; room: string };

export type OverlayCallbacks = {
  onJoin(room: string, name: string): void;
  /** "Watch together" on the current video: the host creates the room. */
  onStart(name: string): void;
  onLeave(): void;
  /** The panel's Retry button (the connection is down and not recovering by itself). */
  onRetry(): void;
  /** Open pact itself (to sign in) — content scripts can't open extension pages. */
  onOpenPact(): void;
  onChat(text: string): void;
  onReaction(emoji: string, messageId: string | null): void;
  /** Resolves with an error message to show, or null on success. */
  onQueueAdd(input: string): Promise<string | null>;
  onQueueAddCurrent(): Promise<string | null>;
  onQueueVote(id: string): void;
  onQueueRemove(id: string): void;
  onQueuePlay(videoId: string): void;
  onFollow(videoId: string): void;
  onPrefsChange(prefs: OverlayPrefs): void;
};

export const OVERLAY_HOST_ID = 'pact-vibeparty-root';

const QUICK_REACTIONS = ['🔥', '😂', '❤️', '👏', '🎉'];
const GROUP_GAP_MS = 2 * 60_000;
const TOAST_MS = 3_800;
const BURST_MS = 1_100;

// ── tiny DOM helpers ─────────────────────────────────────────────────────────

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | null | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === 'function') node.addEventListener(key.replace(/^on/, ''), value);
    else if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'number' ? String(c) : c);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// Static, trusted path data (Lucide, ISC licence).
const ICONS = {
  disc: '<circle cx="12" cy="12" r="10"/><path d="M6 12c0-3.31 2.69-6 6-6"/><path d="M18 12c0 3.31-2.69 6-6 6"/><circle cx="12" cy="12" r="1.5"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  retry: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  signin: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
} as const;

const iconPrototypes = new Map<string, SVGSVGElement>();

/** Parsed once from the static markup above, then cloned — no `innerHTML` anywhere in the overlay. */
function icon(name: keyof typeof ICONS): SVGSVGElement {
  let prototype = iconPrototypes.get(name);
  if (!prototype) {
    const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`, 'image/svg+xml');
    prototype = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
    iconPrototypes.set(name, prototype);
  }
  return prototype.cloneNode(true) as SVGSVGElement;
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function hueOf(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return hash;
}

function avatar(peer: PeerInfo, you: boolean): HTMLElement {
  const initial = Array.from(peer.name.trim())[0]?.toUpperCase() ?? '?';
  const node = h('span', { class: `vp-avatar${you ? ' vp-avatar--you' : ''}`, title: you ? `${peer.name} (you)` : peer.name }, initial);
  node.style.setProperty('--hue', String(hueOf(peer.name)));
  return node;
}

// ── the overlay ──────────────────────────────────────────────────────────────

export class VibePartyOverlay {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;

  private root!: HTMLElement;
  private fab!: HTMLButtonElement;
  private fabDot!: HTMLElement;
  private panel!: HTMLElement;

  // join view
  private roomInput!: HTMLInputElement;
  private nameInput!: HTMLInputElement;
  private joinError!: HTMLElement;
  private startBtn!: HTMLButtonElement;
  private inviteBanner!: HTMLElement;
  private inviteText!: HTMLElement;

  // party view
  private roomChip!: HTMLElement;
  private copyBtn!: HTMLButtonElement;
  private modeChip!: HTMLElement;
  private modeText!: HTMLElement;
  private people!: HTMLElement;
  private notice!: HTMLElement;
  private linkNotice!: HTMLElement;
  private tabs: Array<{ id: 'chat' | 'queue'; tab: HTMLButtonElement; panel: HTMLElement }> = [];
  private tabIndicator!: HTMLElement;
  private chatDot!: HTMLElement;
  private queueCount!: HTMLElement;
  private log!: HTMLElement;
  private jumpPill!: HTMLButtonElement;
  private reactLayer!: HTMLElement;
  private chatInput!: HTMLInputElement;
  private chatCounter!: HTMLElement;
  private queueInput!: HTMLInputElement;
  private queueError!: HTMLElement;
  private queueList!: HTMLElement;
  private addCurrentBtn!: HTMLButtonElement;
  private followSwitch!: HTMLButtonElement;
  private toast!: HTMLElement;

  private selfId = '';
  private room: string | null = null;
  /** Not in a party: is the start / join panel open? (It isn't unless the person asked — pages without a party stay clean.) */
  private joinOpen = false;
  private inviteRoom: string | null = null;
  private selected: 'chat' | 'queue' = 'chat';
  private prefs: OverlayPrefs = { collapsed: false, autoFollow: false };
  private unread = 0;
  private currentVideoId: string | null = null;
  private queue: QueueItem[] = [];
  private seen = new Set<string>();
  private lastMsg: ChatMessage | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly cb: OverlayCallbacks) {}

  // ── lifecycle ──────────────────────────────────────────────────────────────

  mount(): void {
    document.getElementById(OVERLAY_HOST_ID)?.remove(); // an orphan from a previous content-script instance
    this.host = h('div', { id: OVERLAY_HOST_ID });
    this.host.style.cssText = 'all:initial;position:fixed;top:72px;right:16px;z-index:2147483646;display:block;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.append(h('style', {}, overlayCss), this.build());

    // Keep keystrokes typed in our inputs away from YouTube's global hotkeys (see file header).
    for (const type of ['keydown', 'keyup', 'keypress'] as const) this.shadow.addEventListener(type, (e) => e.stopPropagation());

    (document.documentElement ?? document.body).append(this.host);
    this.applyPrefs();
    this.setRoom(null);
    this.resizeObserver = new ResizeObserver(() => this.positionIndicator());
    this.resizeObserver.observe(this.panel);
  }

  unmount(): void {
    clearTimeout(this.toastTimer);
    this.resizeObserver?.disconnect();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  // ── state in ───────────────────────────────────────────────────────────────

  setPrefs(prefs: OverlayPrefs): void {
    this.prefs = prefs;
    this.applyPrefs();
  }

  setSavedName(name: string): void {
    if (name && !this.nameInput.value) this.nameInput.value = name;
  }

  setSelf(selfId: string): void {
    this.selfId = selfId;
  }

  setRoom(room: string | null): void {
    const joined = room !== null;
    const changed = room !== this.room;
    this.room = room;
    this.roomChip.textContent = room ?? '';
    this.roomChip.title = room ?? '';
    if (!joined) {
      this.clearNotice();
      this.unread = 0;
      this.renderBadges();
    } else {
      this.joinOpen = false;
      this.inviteRoom = null;
      this.renderInvite();
      if (changed) this.selectTab('chat');
    }
    this.renderView();
    requestAnimationFrame(() => this.positionIndicator());
  }

  /** Show the start / join panel (the "Watch together" button does this). */
  openJoin(): void {
    if (this.room !== null) return;
    this.joinOpen = true;
    this.renderView();
    requestAnimationFrame(() => (this.startBtn.disabled ? this.roomInput : this.startBtn).focus());
  }

  /** Hide the start / join panel again. */
  closeJoin(): void {
    this.joinOpen = false;
    this.inviteRoom = null;
    this.renderInvite();
    this.renderView();
  }

  /** Make the party panel visible (not minimized) — e.g. right after a party started. */
  reveal(): void {
    if (this.room === null || !this.prefs.collapsed) return;
    this.setCollapsed(false);
  }

  /** Someone sent us a link to a party: offer it (never join on our own). Pass null to withdraw the offer. */
  setInvite(room: string | null): void {
    if (room !== null && room === this.room) return; // already there
    if (this.room !== null) {
      // In another party already: ask before leaving it.
      if (room !== null) this.setNotice({ kind: 'invite', room });
      else this.clearNotice('invite');
      return;
    }
    this.inviteRoom = room;
    if (room !== null) {
      this.joinOpen = true;
      this.roomInput.value = room;
    }
    this.renderInvite();
    this.renderView();
  }

  /** Whether "Start a party" has a video to start it on. */
  setStartable(startable: boolean): void {
    this.startBtn.disabled = !startable;
    this.startBtn.title = startable ? '' : 'Open a video first';
  }

  /** The room's connection: the header chip, and a plain-words notice when friends can't reach this party right now. */
  setLink(link: LinkStatus): void {
    const { mode, reason } = link;
    this.modeChip.dataset.mode = mode;
    this.modeText.textContent = { local: 'This browser', connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', error: 'Offline' }[mode];
    this.modeChip.title = {
      local: 'Only YouTube tabs in this browser are in this party.',
      connecting: 'Connecting to the party…',
      live: 'Connected — friends on other computers can join with the same code.',
      reconnecting: 'The connection dropped. Your changes stay on this browser until it’s back.',
      error: link.message ?? 'Can’t reach the party right now.',
    }[mode];
    this.renderLinkNotice(link, reason);
  }

  setPresence(peers: PeerInfo[]): void {
    const max = 5;
    const nodes: Node[] = peers.slice(0, max).map((p) => avatar(p, p.id === this.selfId));
    if (peers.length > max) nodes.push(h('span', { class: 'vp-avatar vp-avatar--more' }, `+${peers.length - max}`));
    nodes.push(h('span', { class: 'vp-people-label' }, peers.length === 1 ? 'Just you here' : `${peers.length} here`));
    this.people.replaceChildren(...nodes);
    this.people.setAttribute('aria-label', `In this party: ${peers.map((p) => (p.id === this.selfId ? `${p.name} (you)` : p.name)).join(', ')}`);
    if (this.fab) this.fab.title = `VibeParty · ${peers.length} here`;
  }

  resetChat(history: ChatMessage[]): void {
    this.log.replaceChildren();
    this.seen.clear();
    this.lastMsg = null;
    this.unread = 0;
    for (const m of history) this.appendMessage(m, false);
    this.renderBadges();
    this.scrollToEnd(true);
  }

  pushChat(message: ChatMessage): void {
    if (this.seen.has(message.id)) return;
    const stick = this.nearBottom() || message.peerId === this.selfId;
    this.appendMessage(message, true);
    if (message.peerId !== this.selfId && (this.prefs.collapsed || this.selected !== 'chat')) {
      this.unread += 1;
      this.renderBadges();
    }
    if (stick) this.scrollToEnd(false);
    else this.jumpPill.hidden = false;
  }

  setQueue(items: QueueItem[]): void {
    this.flipQueue(items);
    this.queue = items;
    this.queueCount.textContent = items.length ? String(items.length) : '';
    this.queueCount.hidden = items.length === 0;
  }

  setCurrentVideo(videoId: string | null): void {
    this.currentVideoId = videoId;
    this.addCurrentBtn.disabled = !videoId;
    this.flipQueue(this.queue); // refresh the "Now playing" marker
  }

  setNotice(notice: Notice): void {
    const body = h('div', { class: 'vp-notice-body' });
    if (notice.kind === 'ad') {
      body.append(icon('tv'), h('span', {}, 'Ad playing — you’ll rejoin the sync when it ends.'));
    } else if (notice.kind === 'blocked') {
      body.append(icon('alert'), h('span', {}, 'Your browser blocked autoplay. Press play once to join the sync.'));
    } else if (notice.kind === 'invite') {
      body.append(
        icon('sparkles'),
        h('span', {}, 'You opened an invite to a different party.'),
        h(
          'div',
          { class: 'vp-notice-actions' },
          h(
            'button',
            { class: 'vp-btn vp-btn--primary vp-btn--sm', type: 'button', onclick: () => this.cb.onJoin(notice.room, this.nameInput.value.trim() || 'guest') },
            'Switch party',
          ),
          h('button', { class: 'vp-btn vp-btn--ghost vp-btn--sm', type: 'button', onclick: () => this.clearNotice('invite') }, 'Stay here'),
        ),
      );
    } else {
      body.append(
        icon('sparkles'),
        h('span', {}, 'The party is watching a different video.'),
        h(
          'div',
          { class: 'vp-notice-actions' },
          h('button', { class: 'vp-btn vp-btn--primary vp-btn--sm', type: 'button', onclick: () => this.cb.onFollow(notice.videoId) }, 'Go to it'),
        ),
      );
    }
    this.notice.dataset.kind = notice.kind;
    this.notice.replaceChildren(body);
    this.notice.hidden = false;
  }

  clearNotice(kind?: Notice['kind']): void {
    if (kind && this.notice.dataset.kind !== kind) return;
    this.notice.hidden = true;
    this.notice.replaceChildren();
    delete this.notice.dataset.kind;
  }

  /** A short message in the panel. Errors are announced assertively. */
  flash(kind: 'info' | 'error', text: string): void {
    clearTimeout(this.toastTimer);
    this.toast.textContent = text;
    this.toast.dataset.kind = kind;
    this.toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    this.toast.hidden = false;
    this.toastTimer = setTimeout(() => {
      this.toast.hidden = true;
    }, TOAST_MS);
  }

  spawnReaction(reaction: ReactionEvent): void {
    const anchor = reaction.messageId ? this.log.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(reaction.messageId)}"]`) : null;
    this.burst(reaction.emoji, anchor);
  }

  // ── building the tree ──────────────────────────────────────────────────────

  private build(): HTMLElement {
    this.fabDot = h('span', { class: 'vp-dot', hidden: true });
    this.fab = h(
      'button',
      { class: 'vp-fab', type: 'button', 'aria-label': 'Open VibeParty', 'aria-expanded': 'false', onclick: () => this.setCollapsed(false) },
      icon('disc'),
      this.fabDot,
    );

    this.toast = h('div', { class: 'vp-toast', hidden: true, role: 'status' });
    this.panel = h(
      'div',
      { class: 'vp-panel' },
      this.buildHeader(),
      this.buildLinkNotice(),
      this.buildNotice(),
      this.buildJoin(),
      this.buildParty(),
      this.toast,
    );

    this.root = h('aside', { class: 'vp', 'aria-label': 'VibeParty', 'data-view': 'join', 'data-collapsed': 'false' }, this.fab, this.panel);
    return this.root;
  }

  private buildHeader(): HTMLElement {
    this.roomChip = h('span', { class: 'vp-room' });
    this.copyBtn = h(
      'button',
      {
        class: 'vp-icon-btn',
        type: 'button',
        'aria-label': 'Copy invite link',
        title: 'Copy an invite (a link friends can open, plus the room code)',
        onclick: () => void this.copyInvite(),
      },
      icon('link'),
    );
    this.modeText = h('span', {});
    this.modeChip = h('span', { class: 'vp-mode', 'data-mode': 'local' }, h('span', { class: 'vp-pulse' }), this.modeText);

    const leave = h(
      'button',
      { class: 'vp-icon-btn', type: 'button', 'aria-label': 'Leave party', title: 'Leave party', onclick: () => this.cb.onLeave() },
      icon('logout'),
    );
    const minimize = h(
      'button',
      { class: 'vp-icon-btn', type: 'button', 'aria-label': 'Minimize VibeParty', title: 'Minimize', onclick: () => this.setCollapsed(true) },
      icon('minus'),
    );
    // In the start / join view there is nothing to minimize to: this just closes the panel.
    const close = h(
      'button',
      { class: 'vp-icon-btn vp-header-join', type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => this.closeJoin() },
      icon('x'),
    );

    return h(
      'header',
      { class: 'vp-header' },
      h('div', { class: 'vp-brand' }, h('span', { class: 'vp-logo' }, icon('disc')), h('span', { class: 'vp-title' }, 'VibeParty')),
      h('div', { class: 'vp-header-party' }, this.roomChip, this.copyBtn, this.modeChip),
      h('div', { class: 'vp-spacer' }),
      h('div', { class: 'vp-header-party' }, leave),
      h('div', { class: 'vp-header-party' }, minimize),
      close,
    );
  }

  /** "Friends can't reach this party" / "connection lost" — in words, with the one action that helps. */
  private buildLinkNotice(): HTMLElement {
    this.linkNotice = h('div', { class: 'vp-notice vp-link-notice', hidden: true, role: 'status' });
    return this.linkNotice;
  }

  private renderLinkNotice(link: LinkStatus, reason: LinkStatus['reason']): void {
    const body = h('div', { class: 'vp-notice-body' });
    const actions = h('div', { class: 'vp-notice-actions' });
    let text: string | null = null;
    if (link.mode === 'local' && reason === 'signed-out') {
      text = 'Only this browser is in the party. Sign in to pact to invite friends on other computers.';
      actions.append(
        h('button', { class: 'vp-btn vp-btn--primary vp-btn--sm', type: 'button', onclick: () => this.cb.onOpenPact() }, icon('signin'), 'Sign in to pact'),
      );
    } else if (link.mode === 'local') {
      text = 'Only this browser is in the party — this build of pact has no account service to reach friends with.';
    } else if (link.mode === 'reconnecting') {
      text = 'Connection lost. Your changes stay on this browser until it’s back — retrying…';
    } else if (link.mode === 'error') {
      text = link.message ?? 'Can’t reach the party right now.';
      actions.append(h('button', { class: 'vp-btn vp-btn--sm', type: 'button', onclick: () => this.cb.onRetry() }, icon('retry'), 'Try again'));
      if (reason === 'denied') {
        actions.append(h('button', { class: 'vp-btn vp-btn--ghost vp-btn--sm', type: 'button', onclick: () => this.cb.onOpenPact() }, 'Open pact'));
      }
    }
    if (text === null) {
      this.linkNotice.hidden = true;
      this.linkNotice.replaceChildren();
      return;
    }
    body.append(icon(link.mode === 'error' ? 'alert' : 'tv'), h('span', {}, text));
    if (actions.childElementCount > 0) body.append(actions);
    this.linkNotice.dataset.kind = link.mode;
    this.linkNotice.replaceChildren(body);
    this.linkNotice.hidden = false;
  }

  private buildNotice(): HTMLElement {
    this.notice = h('div', { class: 'vp-notice', hidden: true, role: 'status' });
    return this.notice;
  }

  private buildJoin(): HTMLElement {
    this.roomInput = h('input', {
      class: 'vp-input vp-mono',
      id: 'vp-room',
      type: 'text',
      placeholder: 'amber-lofi-k7q2x9dm',
      maxlength: 256, // room for a pasted invite link; it is reduced to the code on the way in
      autocomplete: 'off',
      spellcheck: 'false',
      oninput: () => {
        this.roomInput.removeAttribute('aria-invalid');
        this.joinError.textContent = '';
      },
    });
    this.nameInput = h('input', {
      class: 'vp-input',
      id: 'vp-name',
      type: 'text',
      placeholder: 'How should friends see you?',
      maxlength: LIMITS.name,
      autocomplete: 'nickname',
    });
    this.joinError = h('p', { class: 'vp-error', role: 'alert' });

    const name = () => this.nameInput.value.trim() || 'guest';
    const submit = () => {
      const code = lenientRoomCode(this.roomInput.value);
      if (!code) {
        this.roomInput.setAttribute('aria-invalid', 'true');
        this.joinError.textContent = 'Room codes are 4–32 letters, numbers and dashes.';
        this.roomInput.focus();
        return;
      }
      this.cb.onJoin(code, name());
    };
    const onEnter = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && !ke.isComposing) submit();
    };
    this.roomInput.addEventListener('keydown', onEnter);
    this.nameInput.addEventListener('keydown', onEnter);

    this.startBtn = h(
      'button',
      { class: 'vp-btn vp-btn--primary vp-btn--block vp-start', type: 'button', onclick: () => this.cb.onStart(name()) },
      icon('disc'),
      'Start a party for this video',
    );

    this.inviteText = h('span', {});
    this.inviteBanner = h(
      'div',
      { class: 'vp-invite', hidden: true, role: 'status' },
      icon('sparkles'),
      this.inviteText,
      h('button', { class: 'vp-btn vp-btn--primary vp-btn--sm', type: 'button', onclick: submit }, 'Join party'),
    );

    const create = h(
      'button',
      {
        class: 'vp-btn',
        type: 'button',
        onclick: () => {
          this.roomInput.value = generateRoomCode();
          this.roomInput.removeAttribute('aria-invalid');
          this.joinError.textContent = '';
          this.roomInput.select();
        },
      },
      icon('sparkles'),
      'New',
    );

    return h(
      'section',
      { class: 'vp-join', 'aria-label': 'Start or join a party' },
      h(
        'div',
        { class: 'vp-hero' },
        h('span', { class: 'vp-hero-icon' }, icon('disc')),
        h('div', {}, h('h2', { class: 'vp-h' }, 'Watch together'), h('p', { class: 'vp-sub' }, 'Synced playback, chat and a shared queue.')),
      ),
      this.inviteBanner,
      this.startBtn,
      h('p', { class: 'vp-hint' }, 'You get a link to send. Friends need pact and an account to join from their own computer.'),
      h('div', { class: 'vp-or', role: 'presentation' }, h('span', {}, 'or join one')),
      h('label', { class: 'vp-label vp-label--first', for: 'vp-room' }, 'Room code or invite link'),
      h('div', { class: 'vp-row' }, this.roomInput, create),
      h('label', { class: 'vp-label', for: 'vp-name' }, 'Your name'),
      this.nameInput,
      this.joinError,
      h('button', { class: 'vp-btn vp-btn--block vp-submit', type: 'button', onclick: submit }, 'Join party'),
    );
  }

  private buildParty(): HTMLElement {
    this.people = h('div', { class: 'vp-people', role: 'group' });

    // tabs
    this.chatDot = h('span', { class: 'vp-dot vp-dot--inline', hidden: true });
    this.queueCount = h('span', { class: 'vp-count', hidden: true });
    const chatTab = h('button', { class: 'vp-tab', type: 'button', role: 'tab', id: 'vp-tab-chat', 'aria-controls': 'vp-pane-chat' }, 'Chat', this.chatDot);
    const queueTab = h(
      'button',
      { class: 'vp-tab', type: 'button', role: 'tab', id: 'vp-tab-queue', 'aria-controls': 'vp-pane-queue' },
      'Queue',
      this.queueCount,
    );
    this.tabIndicator = h('span', { class: 'vp-indicator', 'aria-hidden': 'true' });
    const tablist = h('div', { class: 'vp-tabs', role: 'tablist', 'aria-label': 'VibeParty sections' }, chatTab, queueTab, this.tabIndicator);

    const chatPane = this.buildChat();
    const queuePane = this.buildQueue();
    this.tabs = [
      { id: 'chat', tab: chatTab, panel: chatPane },
      { id: 'queue', tab: queueTab, panel: queuePane },
    ];
    for (const t of this.tabs) {
      t.tab.addEventListener('click', () => this.selectTab(t.id));
      t.tab.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const i = this.tabs.findIndex((x) => x.id === t.id);
        const next = ke.key === 'ArrowRight' ? i + 1 : ke.key === 'ArrowLeft' ? i - 1 : ke.key === 'Home' ? 0 : ke.key === 'End' ? this.tabs.length - 1 : null;
        if (next === null) return;
        ke.preventDefault();
        const target = this.tabs[(next + this.tabs.length) % this.tabs.length];
        if (target) this.selectTab(target.id, true);
      });
    }

    this.followSwitch = h('button', {
      class: 'vp-switch',
      type: 'button',
      role: 'switch',
      'aria-checked': 'false',
      'aria-label': 'Follow the party’s video automatically',
      onclick: () => {
        this.prefs = { ...this.prefs, autoFollow: !this.prefs.autoFollow };
        this.applyPrefs();
        this.cb.onPrefsChange(this.prefs);
      },
    });
    const footer = h('footer', { class: 'vp-footer' }, h('span', {}, 'Follow the party’s video automatically'), this.followSwitch);

    return h('section', { class: 'vp-party', 'aria-label': 'Party' }, this.people, tablist, chatPane, queuePane, footer);
  }

  private buildChat(): HTMLElement {
    this.log = h('div', { class: 'vp-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Chat messages', tabindex: '0' });
    this.log.addEventListener('scroll', () => {
      if (this.nearBottom()) this.jumpPill.hidden = true;
    });
    this.jumpPill = h('button', { class: 'vp-jump', type: 'button', hidden: true, onclick: () => this.scrollToEnd(false) }, 'New messages ↓');
    this.reactLayer = h('div', { class: 'vp-react-layer', 'aria-hidden': 'true' });

    const reactions = h(
      'div',
      { class: 'vp-reactions', role: 'group', 'aria-label': 'Send a reaction' },
      ...QUICK_REACTIONS.map((emoji) =>
        h('button', { class: 'vp-react', type: 'button', 'aria-label': `React ${emoji}`, onclick: () => this.sendReaction(emoji) }, emoji),
      ),
    );

    this.chatCounter = h('span', { class: 'vp-counter', hidden: true });
    this.chatInput = h('input', {
      class: 'vp-input',
      type: 'text',
      'aria-label': 'Message',
      placeholder: 'Say something…',
      maxlength: LIMITS.chat,
      autocomplete: 'off',
      oninput: () => {
        const left = LIMITS.chat - this.chatInput.value.length;
        this.chatCounter.hidden = left > 80;
        this.chatCounter.textContent = String(left);
      },
    });
    const send = () => {
      const text = this.chatInput.value.trim();
      if (!text) return;
      this.chatInput.value = '';
      this.chatCounter.hidden = true;
      this.cb.onChat(text);
    };
    this.chatInput.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && !ke.isComposing) {
        ke.preventDefault();
        send();
      } else if (ke.key === 'Escape') {
        this.chatInput.blur(); // hand the keyboard back to YouTube
      }
    });
    const sendBtn = h('button', { class: 'vp-send', type: 'button', 'aria-label': 'Send message', onclick: send }, icon('send'));

    return h(
      'div',
      { class: 'vp-pane', role: 'tabpanel', id: 'vp-pane-chat', 'aria-labelledby': 'vp-tab-chat' },
      h('div', { class: 'vp-chat-wrap' }, this.log, this.jumpPill, this.reactLayer),
      reactions,
      h('div', { class: 'vp-composer' }, this.chatInput, this.chatCounter, sendBtn),
    );
  }

  private buildQueue(): HTMLElement {
    this.queueError = h('p', { class: 'vp-error', role: 'alert' });
    this.queueInput = h('input', {
      class: 'vp-input',
      type: 'text',
      'aria-label': 'YouTube link',
      placeholder: 'Paste a YouTube link…',
      autocomplete: 'off',
      oninput: () => {
        this.queueInput.removeAttribute('aria-invalid');
        this.queueError.textContent = '';
      },
    });
    const add = async () => {
      const value = this.queueInput.value.trim();
      if (!value) return;
      const error = await this.cb.onQueueAdd(value);
      if (error) {
        this.queueInput.setAttribute('aria-invalid', 'true');
        this.queueError.textContent = error;
      } else {
        this.queueInput.value = '';
      }
    };
    this.queueInput.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && !ke.isComposing) void add();
      else if (ke.key === 'Escape') this.queueInput.blur();
    });
    const addBtn = h('button', { class: 'vp-btn vp-btn--primary', type: 'button', onclick: () => void add() }, icon('plus'), 'Add');

    this.addCurrentBtn = h(
      'button',
      {
        class: 'vp-btn vp-btn--ghost vp-btn--block',
        type: 'button',
        disabled: true,
        onclick: async () => {
          const error = await this.cb.onQueueAddCurrent();
          if (error) this.flash('error', error);
        },
      },
      icon('plus'),
      'Add the video I’m watching',
    );

    this.queueList = h('ul', { class: 'vp-queue', 'aria-label': 'Up next' });
    return h(
      'div',
      { class: 'vp-pane', role: 'tabpanel', id: 'vp-pane-queue', 'aria-labelledby': 'vp-tab-queue', hidden: true },
      h('div', { class: 'vp-queue-add' }, h('div', { class: 'vp-row' }, this.queueInput, addBtn), this.queueError, this.addCurrentBtn),
      this.queueList,
    );
  }

  // ── behaviour ──────────────────────────────────────────────────────────────

  private applyPrefs(): void {
    // Minimizing is a way of getting a party out of the way; the start / join panel is simply closed instead.
    const collapsed = this.prefs.collapsed && this.view === 'party';
    this.root.dataset.collapsed = String(collapsed);
    this.fab.setAttribute('aria-expanded', String(!collapsed));
    this.panel.inert = collapsed;
    this.followSwitch.setAttribute('aria-checked', String(this.prefs.autoFollow));
    if (!this.prefs.collapsed) requestAnimationFrame(() => this.positionIndicator());
  }

  private setCollapsed(collapsed: boolean): void {
    this.prefs = { ...this.prefs, collapsed };
    if (!collapsed) {
      this.unread = 0;
      this.renderBadges();
    }
    this.applyPrefs();
    this.cb.onPrefsChange(this.prefs);
    // Move focus to where the user's attention is going.
    requestAnimationFrame(() => (collapsed ? this.fab : this.panel.querySelector<HTMLElement>('.vp-icon-btn[aria-label^="Minimize"]'))?.focus());
  }

  private selectTab(id: 'chat' | 'queue', focus = false): void {
    this.selected = id;
    for (const t of this.tabs) {
      const on = t.id === id;
      t.tab.setAttribute('aria-selected', String(on));
      t.tab.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
      if (on && focus) t.tab.focus();
    }
    if (id === 'chat') {
      this.unread = 0;
      this.renderBadges();
      requestAnimationFrame(() => this.scrollToEnd(true));
    }
    requestAnimationFrame(() => this.positionIndicator());
  }

  private positionIndicator(): void {
    const active = this.tabs.find((t) => t.id === this.selected)?.tab;
    if (!active || active.offsetWidth === 0) return;
    this.tabIndicator.style.width = `${active.offsetWidth}px`;
    this.tabIndicator.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  private renderBadges(): void {
    const show = this.unread > 0;
    this.fabDot.hidden = !(show && this.prefs.collapsed);
    this.chatDot.hidden = !(show && !this.prefs.collapsed && this.selected !== 'chat');
  }

  /**
   * Put an invite on the clipboard: the friendly line (with the code) and a link that opens this video with the party
   * offered. Returns whether it worked — callers may be inside a click handler, which is what the clipboard needs.
   */
  async copyInvite(room: string | null = this.room): Promise<boolean> {
    if (!room) return false;
    try {
      await navigator.clipboard.writeText(inviteText(room, this.currentVideoId));
      this.copyBtn.replaceChildren(icon('check'));
      this.copyBtn.dataset.done = 'true';
      this.flash('info', 'Invite copied — send it to a friend');
      setTimeout(() => {
        this.copyBtn.replaceChildren(icon('link'));
        delete this.copyBtn.dataset.done;
      }, 1600);
      return true;
    } catch {
      this.flash('error', `Couldn’t copy — the room code is ${room}`);
      return false;
    }
  }

  // ── what is visible ────────────────────────────────────────────────────────

  private get view(): 'idle' | 'join' | 'party' {
    return this.room !== null ? 'party' : this.joinOpen ? 'join' : 'idle';
  }

  private renderView(): void {
    const view = this.view;
    this.root.dataset.view = view;
    if (this.host) this.host.style.display = view === 'idle' ? 'none' : 'block';
    this.applyPrefs();
  }

  private renderInvite(): void {
    const room = this.inviteRoom;
    this.inviteBanner.hidden = room === null;
    this.inviteText.textContent = room === null ? '' : `You’re invited to a party (${room}).`;
  }

  // ── chat ───────────────────────────────────────────────────────────────────

  private appendMessage(m: ChatMessage, animate: boolean): void {
    this.seen.add(m.id);
    const mine = m.peerId === this.selfId;
    const grouped = this.lastMsg !== null && this.lastMsg.peerId === m.peerId && m.at - this.lastMsg.at < GROUP_GAP_MS;
    this.lastMsg = m;

    const el = h(
      'div',
      { class: `vp-msg${mine ? ' vp-msg--mine' : ''}${grouped ? ' vp-msg--grouped' : ''}${animate ? ' vp-msg--new' : ''}`, 'data-message-id': m.id },
      grouped
        ? null
        : h(
            'div',
            { class: 'vp-msg-head' },
            h('span', { class: 'vp-msg-name' }, mine ? 'You' : m.name),
            h('time', { datetime: new Date(m.at).toISOString() }, clock(m.at)),
          ),
      h('div', { class: 'vp-msg-text' }, m.text),
    );
    el.addEventListener('dblclick', () => this.sendReaction('❤️', m.id, el));
    this.log.append(el);
    while (this.log.childElementCount > LIMITS.chatHistory) this.log.firstElementChild?.remove();
  }

  private nearBottom(): boolean {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 80;
  }

  private scrollToEnd(instant: boolean): void {
    this.log.scrollTo({ top: this.log.scrollHeight, behavior: instant ? 'instant' : 'smooth' });
    this.jumpPill.hidden = true;
  }

  private sendReaction(emoji: string, messageId: string | null = null, anchor: HTMLElement | null = null): void {
    this.burst(emoji, anchor);
    this.cb.onReaction(emoji, messageId);
  }

  private burst(emoji: string, anchor: HTMLElement | null): void {
    const layer = this.reactLayer.getBoundingClientRect();
    if (layer.width === 0) return; // hidden tab / collapsed panel
    let x: number;
    let y: number;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      x = r.left - layer.left + r.width / 2;
      y = r.top - layer.top + r.height / 2;
    } else {
      x = 24 + Math.random() * (layer.width - 48);
      y = layer.height - 28;
    }
    const node = h('span', { class: 'vp-burst' }, emoji);
    node.style.left = `${Math.min(layer.width - 20, Math.max(8, x))}px`;
    node.style.top = `${Math.min(layer.height - 8, Math.max(8, y))}px`;
    node.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 56)}px`);
    node.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 40)}deg`);
    this.reactLayer.append(node);
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), BURST_MS + 200);
  }

  // ── queue ──────────────────────────────────────────────────────────────────

  /** Re-render the queue, animating rows from where they were to where they now are (FLIP). */
  private flipQueue(items: QueueItem[]): void {
    const before = new Map<string, number>();
    for (const li of this.queueList.querySelectorAll<HTMLElement>('[data-id]')) before.set(li.dataset.id ?? '', li.getBoundingClientRect().top);

    // The list is rebuilt on every change; remember which button had keyboard focus so it isn't lost.
    const active = this.shadow?.activeElement as HTMLElement | null;
    const focused =
      active && this.queueList.contains(active) ? { id: active.closest<HTMLElement>('[data-id]')?.dataset.id, action: active.dataset.action } : null;

    if (items.length === 0) {
      this.queueList.replaceChildren(
        h('li', { class: 'vp-empty' }, h('strong', {}, 'The queue is empty'), h('span', {}, 'Add a link above — the most upvoted video plays next.')),
      );
      return;
    }
    this.queueList.replaceChildren(...items.map((item) => this.queueRow(item)));
    if (focused?.id && focused.action) {
      this.queueList.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused.id)}"] [data-action="${focused.action}"]`)?.focus({ preventScroll: true });
    }

    for (const li of this.queueList.querySelectorAll<HTMLElement>('[data-id]')) {
      const id = li.dataset.id ?? '';
      const was = before.get(id);
      if (was === undefined) {
        if (before.size > 0)
          li.animate?.(
            [
              { opacity: 0, transform: 'translateY(8px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
          );
        continue;
      }
      const dy = was - li.getBoundingClientRect().top;
      if (Math.abs(dy) > 1)
        li.animate?.([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  }

  private queueRow(item: QueueItem): HTMLElement {
    const voted = item.voters.includes(this.selfId);
    const mine = item.addedBy === this.selfId;
    const playing = item.videoId === this.currentVideoId;

    const thumb = h('img', { class: 'vp-thumb-img', src: thumbnailUrlFor(item.videoId), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    thumb.addEventListener('error', () => thumb.remove());
    const play = h(
      'button',
      {
        class: 'vp-thumb',
        type: 'button',
        'data-action': 'play',
        'aria-label': playing ? `${item.title} is playing` : `Play ${item.title}`,
        title: playing ? 'Playing now' : 'Play now',
        disabled: playing,
        onclick: () => this.cb.onQueuePlay(item.videoId),
      },
      thumb,
      playing ? h('span', { class: 'vp-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')) : h('span', { class: 'vp-thumb-play' }, icon('play')),
    );

    const vote = h(
      'button',
      {
        class: `vp-vote${voted ? ' vp-vote--on' : ''}`,
        type: 'button',
        'data-action': 'vote',
        'aria-pressed': String(voted),
        'aria-label': `${voted ? 'Remove your vote from' : 'Upvote'} ${item.title} (${item.voters.length} ${item.voters.length === 1 ? 'vote' : 'votes'})`,
        onclick: () => this.cb.onQueueVote(item.id),
      },
      icon('up'),
      h('span', {}, item.voters.length),
    );

    return h(
      'li',
      { class: `vp-item${playing ? ' vp-item--playing' : ''}`, 'data-id': item.id },
      play,
      h(
        'div',
        { class: 'vp-item-info' },
        h('span', { class: 'vp-item-title', title: item.title }, item.title),
        h('span', { class: 'vp-item-meta' }, playing ? 'Now playing' : `Added by ${item.addedByName}`),
      ),
      mine
        ? h(
            'button',
            {
              class: 'vp-icon-btn vp-icon-btn--danger',
              type: 'button',
              'data-action': 'remove',
              'aria-label': `Remove ${item.title} from the queue`,
              title: 'Remove',
              onclick: () => this.cb.onQueueRemove(item.id),
            },
            icon('trash'),
          )
        : null,
      vote,
    );
  }
}
