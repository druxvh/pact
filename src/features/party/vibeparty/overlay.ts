import overlayCss from './overlay.css?inline';
import type { ChatMessage, PeerInfo, QueueItem, ReactionEvent } from './protocol';
import { parseYouTubeId, watchUrlFor } from './protocol';

export type OverlayCallbacks = {
  onJoin: (room: string, name: string) => void;
  onLeave: () => void;
  onChat: (text: string) => void;
  onReaction: (emoji: string, messageId: string | null) => void;
  onQueueAdd: (url: string, title: string) => void;
  onQueueVote: (id: string) => void;
  onQueuePlay: (videoId: string) => void;
};

const DOUBLE_TAP_MS = 300;
const BURST_TTL_MS = 1000;
const REACTION_EMOJIS = ['🔥', '😂', '❤️', '👏', '😭', '🎉', '😎', '✨', '💯', '🫡'];
const HOST_ID = 'pact-vibeparty-root';

export class VibePartyOverlay {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private panel: HTMLElement | null = null;
  private chatList: HTMLElement | null = null;
  private queueList: HTMLElement | null = null;
  private reactionLayer: HTMLElement | null = null;
  private presenceRow: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private roomChip: HTMLElement | null = null;
  private joinView: HTMLElement | null = null;
  private partyView: HTMLElement | null = null;
  private seenMessageIds = new Set<string>();
  private messages: ChatMessage[] = [];
  private queue: QueueItem[] = [];
  private selfId = '';
  private chatFocused = false;

  get isChatFocused(): boolean {
    return this.chatFocused;
  }

  getHost(): HTMLDivElement | null {
    return this.host;
  }

  privateChatInputFocus(): void {
    this.chatFocused = true;
  }

  privateChatInputBlur(): void {
    this.chatFocused = false;
    this.renderChat();
  }

  privateLiveRegion: HTMLElement | null = null;
  private leaveBtn: HTMLButtonElement | null = null;

  constructor(private readonly callbacks: OverlayCallbacks) {}

  mount(): void {
    if (this.host && document.getElementById(HOST_ID)) return;
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    this.host.setAttribute('role', 'dialog');
    this.host.setAttribute('aria-modal', 'true');
    this.host.setAttribute('aria-label', 'VibeParty overlay');
    this.host.style.cssText =
      'position:fixed;top:72px;right:16px;z-index:2147483646;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = overlayCss;
    this.shadow.appendChild(style);
    this.panel = this.buildPanel();
    this.shadow.appendChild(this.panel);
    (document.documentElement ?? document.body).appendChild(this.host);
  }

  unmount(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  setSelf(selfId: string): void {
    this.selfId = selfId;
  }

  setRoom(room: string | null): void {
    if (this.roomChip) this.roomChip.textContent = room ? `#${room}` : 'no room';
    if (this.joinView && this.partyView) {
      this.joinView.style.display = room ? 'none' : 'flex';
      this.partyView.style.display = room ? 'flex' : 'none';
    }
  }

  setStatus(text: string, live = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('vp-live', live);
  }

  setPresence(peers: PeerInfo[]): void {
    if (!this.presenceRow) return;
    this.presenceRow.replaceChildren();
    const label = document.createElement('span');
    label.textContent = `${peers.length} here`;
    this.presenceRow.appendChild(label);
    for (const peer of peers) {
      const chip = document.createElement('span');
      chip.className = 'vp-peer';
      chip.textContent = peer.id === this.selfId ? `${peer.name} (you)` : peer.name;
      this.presenceRow.appendChild(chip);
    }
    if (this.leaveBtn) {
      this.leaveBtn.disabled = false;
    }
  }

  pushChat(message: ChatMessage): void {
    if (this.seenMessageIds.has(message.id)) return;
    this.seenMessageIds.add(message.id);
    this.messages.push(message);
    if (this.messages.length > 200) this.messages = this.messages.slice(-200);
    this.renderChat();
  }

  setQueue(items: QueueItem[]): void {
    this.queue = [...items].sort((a, b) => {
      const votes = b.voters.length - a.voters.length;
      if (votes !== 0) return votes;
      return a.createdAt - b.createdAt;
    });
    this.renderQueue();
  }

  spawnReaction(reaction: ReactionEvent): void {
    const emoji = reaction.emoji || this.randomEmoji();
    let x: number;
    let y: number;
    const card = reaction.messageId
      ? this.shadow?.querySelector(`[data-message-id="${cssEscape(reaction.messageId)}"]`)
      : null;
    if (card && this.chatList) {
      const cardRect = card.getBoundingClientRect();
      const listRect = this.chatList.getBoundingClientRect();
      x = cardRect.left - listRect.left + cardRect.width / 2;
      y = cardRect.top - listRect.top + cardRect.height / 2;
    } else {
      x = 40 + Math.random() * (this.chatList?.clientWidth ?? 300) - 80;
      y = (this.chatList?.clientHeight ?? 200) * (0.4 + Math.random() * 0.5);
    }
    this.spawnBurst(emoji, x, y);
  }

  private spawnBurst(emoji: string, x: number, y: number): void {
    if (!this.reactionLayer) return;
    const node = document.createElement('span');
    node.className = 'vp-emoji-burst';
    node.textContent = emoji;
    node.style.left = `${Math.max(12, x)}px`;
    node.style.top = `${Math.max(12, y)}px`;
    node.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 48)}px`);
    this.reactionLayer.appendChild(node);
    const cleanup = () => node.remove();
    node.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, BURST_TTL_MS + 50);
  }

  private randomEmoji(): string {
    return REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)] ?? '🔥';
  }

  private renderChat(): void {
    if (!this.chatList) return;
    this.chatList.replaceChildren();
    if (this.messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vp-empty';
      empty.setAttribute('aria-label', 'No messages yet');
      empty.textContent = 'no messages yet — double-tap a message for reactions';
      this.chatList.appendChild(empty);
      return;
    }
    for (const message of this.messages) {
      const card = document.createElement('div');
      card.className = 'vp-msg-card';
      card.setAttribute('role', 'article');
      card.setAttribute('aria-label', `${message.name}: ${message.text}`);
      card.dataset.messageId = message.id;

      const meta = document.createElement('div');
      meta.className = 'vp-msg-meta';
      const name = document.createElement('span');
      name.className = 'vp-msg-name';
      name.textContent = message.name;
      const time = document.createElement('span');
      time.textContent = new Date(message.at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      meta.append(name, time);

      const text = document.createElement('div');
      text.className = 'vp-msg-text';
      text.textContent = message.text;

      const hint = document.createElement('span');
      hint.className = 'vp-msg-hint';
      hint.textContent = ' double-tap for reactions';

      card.append(meta, text, hint);
      card.addEventListener('click', (event) => this.handleMessageTap(card, event));
      this.chatList.appendChild(card);
    }
    this.chatList.scrollTop = this.chatList.scrollHeight;
  }

  private handleMessageTap(card: HTMLElement, event: MouseEvent): void {
    const now = Date.now();
    const messageId = card.dataset.messageId ?? null;
    const last = Number(card.dataset.lastTap ?? '0');
    if (last && now - last < DOUBLE_TAP_MS) {
      card.dataset.lastTap = '0';
      const emoji = this.randomEmoji();
      const listRect = this.chatList?.getBoundingClientRect();
      const x = listRect ? event.clientX - listRect.left : 40;
      const y = listRect ? event.clientY - listRect.top : 40;
      this.spawnBurst(emoji, x, y);
      this.callbacks.onReaction(emoji, messageId);
      return;
    }
    card.dataset.lastTap = String(now);
  }

  private renderQueue(): void {
    if (!this.queueList) return;
    this.queueList.replaceChildren();
    if (this.queue.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vp-empty';
      empty.textContent = 'queue is empty — drop a YouTube link above';
      this.queueList.appendChild(empty);
      return;
    }
    for (const item of this.queue) {
      const row = document.createElement('div');
      row.className = 'vp-queue-item';

      const vote = document.createElement('button');
      const voted = item.voters.includes(this.selfId);
      vote.className = `vp-upvote${voted ? ' vp-voted' : ''}`;
      vote.innerHTML = `<span>▲</span><span>${item.voters.length}</span>`;
      vote.title = voted ? 'Remove your vote' : 'Upvote';
      vote.setAttribute('aria-pressed', String(voted));
      vote.setAttribute('aria-label', voted ? 'Removed your vote' : 'Upvote');
      vote.addEventListener('click', () => this.callbacks.onQueueVote(item.id));

      const info = document.createElement('div');
      info.className = 'vp-queue-info';
      const title = document.createElement('div');
      title.className = 'vp-queue-title';
      title.textContent = item.title;
      title.title = item.url;
      if (item.videoId) {
        title.addEventListener('click', () => this.callbacks.onQueuePlay(item.videoId as string));
      }
      const sub = document.createElement('div');
      sub.className = 'vp-queue-sub';
      sub.textContent = `added by ${item.addedByName}`;
      info.append(title, sub);

      row.append(vote, info);
      this.queueList.appendChild(row);
    }
  }

  private buildPanel(): HTMLElement {
    const root = el('div', 'vp-root');

    const header = el('div', 'vp-header');
    const brand = el('div', 'vp-brand');
    const badge = el('span', 'vp-logo-badge');
    badge.textContent = 'p.';
    const brandName = el('span', 'vp-brand-name');
    brandName.textContent = 'VibeParty';
    brand.append(badge, brandName);
    this.roomChip = el('div', 'vp-room-chip');
    this.roomChip.textContent = 'no room';
    const spacer = el('div', 'vp-spacer');
    const collapse = el('button', 'vp-icon-btn');
    collapse.textContent = '–';
    collapse.title = 'Collapse';
    collapse.addEventListener('click', () => {
      root.classList.toggle('vp-collapsed');
      collapse.textContent = root.classList.contains('vp-collapsed') ? '+' : '–';
    });
    header.append(brand, this.roomChip, spacer, collapse);

    this.statusEl = el('div', 'vp-status');
    this.statusEl.textContent = 'offline — local only';
    this.statusEl.setAttribute('role', 'status');

    this.privateLiveRegion = el('div', 'vp-live-region');
    this.privateLiveRegion.setAttribute('aria-live', 'polite');
    this.privateLiveRegion.setAttribute('aria-busy', 'false');

    const body = el('div', 'vp-body');

    this.joinView = el('div', 'vp-join');
    const joinTitle = el('h3');
    joinTitle.textContent = 'Start or join a party';
    const joinBlurb = el('p');
    joinBlurb.textContent = 'Same room code = synced playback, chat, and queue.';
    const roomInput = el('input', 'vp-input') as HTMLInputElement;
    roomInput.placeholder = 'room code (e.g. friday-vibes)';
    roomInput.maxLength = 32;
    roomInput.setAttribute('aria-label', 'Room code - VibeParty');
    const nameInput = el('input', 'vp-input') as HTMLInputElement;
    nameInput.placeholder = 'your name';
    nameInput.maxLength = 20;
    nameInput.setAttribute('aria-label', 'Your name');
    try {
      const saved = localStorage.getItem('pact-vibeparty-name');
      if (saved) nameInput.value = saved;
    } catch {}
    const joinBtn = el('button', 'vp-btn') as HTMLButtonElement;
    joinBtn.textContent = 'Join party';
    joinBtn.setAttribute('aria-label', 'Join party');
    const doJoin = () => {
      const room = roomInput.value.trim().toLowerCase().replace(/\s+/g, '-');
      const name = nameInput.value.trim() || 'guest';
      if (!room) {
        roomInput.focus();
        return;
      }
      try {
        localStorage.setItem('pact-vibeparty-name', name);
      } catch {}
      this.callbacks.onJoin(room, name);
    };
    joinBtn.addEventListener('click', doJoin);
    roomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    this.joinView.append(joinTitle, joinBlurb, roomInput, nameInput, joinBtn);

    this.partyView = el('div');
    this.partyView.style.cssText = 'display:none;flex-direction:column;min-height:0;flex:1;';

    const tabs = el('div', 'vp-tabs');
    const chatTab = el('button', 'vp-tab vp-active') as HTMLButtonElement;
    chatTab.textContent = 'Chat';
    chatTab.setAttribute('role', 'tab');
    chatTab.setAttribute('aria-controls', 'vp-pane-chat');
    chatTab.setAttribute('aria-selected', 'true');
    const queueTab = el('button', 'vp-tab') as HTMLButtonElement;
    queueTab.textContent = 'Queue';
    queueTab.setAttribute('role', 'tab');
    queueTab.setAttribute('aria-controls', 'vp-pane-queue');
    queueTab.setAttribute('aria-selected', 'false');
    tabs.append(chatTab, queueTab);

    const chatPane = el('div', 'vp-pane vp-active');
    this.chatList = el('div', 'vp-chat-list');
    this.reactionLayer = el('div', 'vp-reaction-layer');
    this.chatList.appendChild(this.reactionLayer);
    const chatRow = el('div', 'vp-chat-input-row');
    const chatInput = el('input', 'vp-input') as HTMLInputElement;
    chatInput.placeholder = 'say something…';
    chatInput.setAttribute('aria-label', 'Chat input');
    chatInput.setAttribute('aria-want-to-chat', 'true');
    const sendBtn = el('button', 'vp-btn') as HTMLButtonElement;
    sendBtn.textContent = 'Send';
    sendBtn.setAttribute('aria-label', 'Send message');
    const sendChat = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      this.callbacks.onChat(text);
    };
    sendBtn.addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });
    chatInput.addEventListener('focus', () => this.privateChatInputFocus());
    chatInput.addEventListener('blur', () => this.privateChatInputBlur());
    chatRow.append(chatInput, sendBtn);
    chatPane.append(this.chatList, chatRow);

    const queuePane = el('div', 'vp-pane');
    const queueAdd = el('div', 'vp-queue-add');
    const queueAddRow = el('div', 'vp-queue-add-row');
    const urlInput = el('input', 'vp-input') as HTMLInputElement;
    urlInput.placeholder = 'paste a YouTube URL';
    urlInput.setAttribute('aria-label', 'YouTube URL');
    const titleInput = el('input', 'vp-input') as HTMLInputElement;
    titleInput.placeholder = 'title (optional)';
    titleInput.setAttribute('aria-label', 'Title (optional)');
    const addBtn = el('button', 'vp-btn') as HTMLButtonElement;
    addBtn.textContent = 'Add';
    addBtn.setAttribute('aria-label', 'Add to queue');
    const doAdd = () => {
      const url = urlInput.value.trim();
      if (!url) return;
      const videoId = parseYouTubeId(url);
      const title = titleInput.value.trim() || videoId || url;
      urlInput.value = '';
      titleInput.value = '';
      this.callbacks.onQueueAdd(videoId ? watchUrlFor(videoId) : url, title);
    };
    addBtn.addEventListener('click', doAdd);
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdd();
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdd();
    });
    queueAddRow.append(urlInput, addBtn);
    queueAdd.append(queueAddRow, titleInput);
    this.queueList = el('div', 'vp-queue-list');
    queuePane.append(queueAdd, this.queueList);

    chatTab.addEventListener('click', () => {
      chatTab.classList.add('vp-active');
      queueTab.classList.remove('vp-active');
      chatPane.classList.add('vp-active');
      queuePane.classList.remove('vp-active');
      chatTab.setAttribute('aria-selected', 'true');
      queueTab.setAttribute('aria-selected', 'false');
    });
    queueTab.addEventListener('click', () => {
      queueTab.classList.add('vp-active');
      chatTab.classList.remove('vp-active');
      queuePane.classList.add('vp-active');
      chatPane.classList.remove('vp-active');
      queueTab.setAttribute('aria-selected', 'true');
      chatTab.setAttribute('aria-selected', 'false');
    });

    this.presenceRow = el('div', 'vp-presence');
    this.leaveBtn = el('button', 'vp-btn vp-ghost') as HTMLButtonElement;
    this.leaveBtn.textContent = 'Leave party';
    this.leaveBtn.setAttribute('aria-label', 'Leave party');
    this.leaveBtn.addEventListener('click', () => this.callbacks.onLeave());
    const leaveRow = el('div', 'vp-leave-row');
    leaveRow.appendChild(this.leaveBtn);

    this.partyView.append(tabs, chatPane, queuePane, this.presenceRow, leaveRow);
    body.append(this.joinView, this.partyView);
    root.append(header, this.statusEl, body);
    return root;
  }
}

function el(tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
