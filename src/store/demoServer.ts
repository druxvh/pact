/**
 * The simulated "backend".
 *
 * pact has no server yet, so everything that would normally happen *remotely* — your friends
 * replying, accepting requests, being online — is faked here, in ONE place. UI code calls these
 * functions instead of poking stores directly, so replacing this module with a real realtime
 * backend later doesn't touch any views.
 */
import { botReply, typingDuration } from '@/features/chat/bots';
import { clearBlobs } from '@/features/chat/idb';
import { useChatStore } from '@/features/chat/store';
import type { Attachment, Message } from '@/features/chat/types';
import type { Task } from '@/features/kanban/store';
import { DEFAULT_BOARD_ID, useKanbanStore } from '@/features/kanban/store';
import { DEFAULT_NOTEBOOK_ID, useNotesStore } from '@/features/notes/store';
import type { Note } from '@/features/notes/types';
import { uid } from '@/lib/format';
import { useNavStore } from '@/store/useNavStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { findPerson, ME_ID, useUserStore } from '@/store/useUserStore';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const wait = (min: number, spread = 0) => min + Math.random() * spread;
const EMOJI_REACTIONS = ['👍', '❤️', '🔥', '😂', '🎉', '👀'];

/** Every persisted slice. Used for backup/export and "reset all data". */
export const STORAGE_KEYS = [
  'pact-user',
  'pact-notes',
  'pact-kanban',
  'pact-timer',
  'pact-chat',
  'pact-party',
  'pact-home',
  'pact-settings',
  'pact-theme',
  'pact-notifications',
] as const;

// ── chat ─────────────────────────────────────────────────────────────────────

function deliver(conversationId: string, personId: string, body: string) {
  const chat = useChatStore.getState();
  chat.addMessage({ conversationId, senderId: personId, body });
  const watching = chat.activeId === conversationId && useNavStore.getState().section === 'chat' && document.visibilityState === 'visible';
  if (watching) {
    chat.markRead(conversationId);
    return;
  }
  const p = findPerson(personId);
  const conv = chat.conversations.find((c) => c.id === conversationId);
  useNotificationStore.getState().add({
    title: conv?.kind === 'group' ? `${p?.displayName ?? 'Someone'} in ${conv.name}` : (p?.displayName ?? 'New message'),
    body,
    kind: 'chat',
    link: { section: 'chat', sub: conversationId },
  });
}

/** Simulate a peer typing, then sending `body`. */
function typeThenDeliver(conversationId: string, personId: string, body: string, startDelay: number) {
  window.setTimeout(() => {
    const chat = useChatStore.getState();
    chat.setTyping(conversationId, personId, true);
    window.setTimeout(() => {
      useChatStore.getState().setTyping(conversationId, personId, false);
      deliver(conversationId, personId, body);
    }, typingDuration(body));
  }, startDelay);
}

function scheduleReplies(msg: Message) {
  const chat = useChatStore.getState();
  const conv = chat.conversations.find((c) => c.id === msg.conversationId);
  if (!conv) return;
  const online = conv.participantIds
    .filter((id) => id !== ME_ID)
    .map(findPerson)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.isOnline));
  if (online.length === 0) return; // offline people don't reply — the thread header says so

  const responders = conv.kind === 'dm' ? online : [...online].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.4 ? 2 : 1);
  responders.forEach((p, i) => {
    const reply = botReply(p.id, msg.body, { hasAttachment: Boolean(msg.attachments?.length) });
    typeThenDeliver(conv.id, p.id, reply, wait(500, 700) + i * 1500);
  });

  const reactor = online[0];
  if (reactor && Math.random() < 0.35) {
    window.setTimeout(
      () => {
        const emoji = EMOJI_REACTIONS[Math.floor(Math.random() * EMOJI_REACTIONS.length)] ?? '👍';
        useChatStore.getState().toggleReaction(msg.id, emoji, reactor.id);
      },
      wait(900, 900),
    );
  }
}

/** Send a message as the current user (and let the simulated peers react). */
export function sendMessage(input: { conversationId: string; body: string; attachments?: Attachment[]; replyTo?: string }): Message {
  const chat = useChatStore.getState();
  const msg = chat.addMessage({
    conversationId: input.conversationId,
    senderId: ME_ID,
    body: input.body.trim(),
    attachments: input.attachments?.length ? input.attachments : undefined,
    replyTo: input.replyTo,
  });
  chat.setReplyingTo(input.conversationId, null);
  chat.setDraft(input.conversationId, '');
  scheduleReplies(msg);
  return msg;
}

// ── friends ──────────────────────────────────────────────────────────────────

function welcomeFriend(personId: string) {
  const convId = useChatStore.getState().ensureDm(personId);
  const p = findPerson(personId);
  useNotificationStore.getState().add({
    title: 'Friend request accepted',
    body: `${p?.displayName ?? 'Someone'} accepted your request`,
    kind: 'friend',
    link: { section: 'chat', sub: convId },
  });
  typeThenDeliver(convId, personId, 'hey! thanks for adding me 👋', wait(600, 500));
  return convId;
}

/** Send a friend request; the demo directory "accepts" it a couple of seconds later. */
export function requestFriend(username: string) {
  const r = useUserStore.getState().sendFriendRequest(username);
  if (!r.ok || !r.personId) return r;
  if (r.accepted) {
    const convId = useChatStore.getState().ensureDm(r.personId);
    typeThenDeliver(convId, r.personId, 'hey! 👋', wait(600, 500));
    return r;
  }
  const { requestId, personId } = r;
  if (requestId) {
    window.setTimeout(
      () => {
        const req = useUserStore.getState().friendRequests.find((x) => x.id === requestId);
        if (req?.status !== 'pending') return;
        useUserStore.getState().acceptRequest(requestId);
        welcomeFriend(personId);
      },
      wait(1500, 1500),
    );
  }
  return r;
}

export function acceptIncoming(requestId: string) {
  const req = useUserStore.getState().friendRequests.find((r) => r.id === requestId);
  if (req?.status !== 'pending') return;
  useUserStore.getState().acceptRequest(requestId);
  const convId = useChatStore.getState().ensureDm(req.fromId);
  typeThenDeliver(convId, req.fromId, 'yay, we’re connected 🎉', wait(600, 600));
  return convId;
}

export function declineIncoming(requestId: string) {
  useUserStore.getState().rejectRequest(requestId);
}

/**
 * On app start: resolve any outgoing request whose simulated acceptance timer was lost
 * (the tab was closed mid-flight), so a request is never stuck "pending" forever.
 */
export function reconcileDemo() {
  const { friendRequests, acceptRequest } = useUserStore.getState();
  for (const r of friendRequests) {
    if (r.status === 'pending' && r.fromId === ME_ID && Date.now() - new Date(r.createdAt).getTime() > 4000) {
      acceptRequest(r.id);
      useChatStore.getState().ensureDm(r.toId);
    }
  }
}

// ── sample workspace ─────────────────────────────────────────────────────────

/** Fill pact with believable data so every feature can be explored straight away. */
export function loadSampleWorkspace() {
  // people
  useUserStore.setState({
    friendIds: ['alex', 'jordan'],
    friendRequests: [{ id: 'fr-riley', fromId: 'riley', toId: ME_ID, status: 'pending', createdAt: ago(180) }],
  });

  // notes
  const mk = (n: number, notebookId: string, title: string, body: string, minutesAgo: number, extra: Partial<Note> = {}): Note => ({
    id: uid('note'),
    notebookId,
    number: n,
    title,
    body,
    pinned: false,
    assigneeId: null,
    createdAt: ago(minutesAgo + 30),
    updatedAt: ago(minutesAgo),
    ...extra,
  });
  const designNb = { id: 'nb-design-jam', name: 'design jam', memberIds: [ME_ID, 'alex', 'jordan'], nextNumber: 3, createdAt: ago(60 * 24) };
  useNotesStore.setState({
    notebooks: [{ id: DEFAULT_NOTEBOOK_ID, name: 'Personal', memberIds: [ME_ID], nextNumber: 3, createdAt: ago(60 * 48) }, designNb],
    notes: [
      mk(
        1,
        DEFAULT_NOTEBOOK_ID,
        'Welcome to pact ✨',
        '## A new tab that does more\n\nPress **⌘K** for the command palette, or **/** on Home to search.\n\n- [x] Open pact\n- [ ] Try the Focus timer\n- [ ] Add a shortcut to Home\n- [ ] Start a VibeParty with a friend\n\n> Notes are Markdown. Tick the boxes in Preview.',
        5,
        { pinned: true },
      ),
      mk(2, DEFAULT_NOTEBOOK_ID, 'Reading list', '- *The Design of Everyday Things*\n- *Shape Up*\n- *Refactoring UI*', 60 * 20),
      mk(
        1,
        designNb.id,
        'Utility tools list',
        'Converters, QR, colour contrast, image compress ≤ 5 MB.\n\n| Tool | Status |\n| --- | --- |\n| QR | ✅ |\n| Image | ✅ |',
        60 * 6,
        { assigneeId: 'alex' },
      ),
      mk(2, designNb.id, 'Chat vibe', 'Discord × Telegram. Reactions, replies, emoji, attachments ≤ 5 MB.', 60 * 3, { assigneeId: 'jordan' }),
    ],
    activeNotebookId: DEFAULT_NOTEBOOK_ID,
    selectedId: null,
  });

  // kanban
  const t = (boardId: string, columnId: Task['columnId'], number: number, order: number, title: string, extra: Partial<Task> = {}): Task => ({
    id: uid('task'),
    boardId,
    columnId,
    number,
    title,
    description: '',
    assigneeId: null,
    priority: 'none',
    due: null,
    order,
    createdAt: ago(60 * 24),
    updatedAt: ago(60 * 5),
    completedAt: columnId === 'done' ? ago(60 * 5) : null,
    ...extra,
  });
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const jam = { id: 'board-design-jam', name: 'design jam', memberIds: [ME_ID, 'alex', 'jordan'], nextNumber: 5, createdAt: ago(60 * 30) };
  useKanbanStore.setState({
    boards: [{ id: DEFAULT_BOARD_ID, name: 'Personal', memberIds: [ME_ID], nextNumber: 4, createdAt: ago(60 * 48) }, jam],
    tasks: [
      t(DEFAULT_BOARD_ID, 'todo', 1, 1000, 'Pick a favourite shortcut set for Home', { priority: 'low' }),
      t(DEFAULT_BOARD_ID, 'in_progress', 2, 1000, 'Write the launch post', {
        priority: 'high',
        due: day(1),
        assigneeId: ME_ID,
        description: 'Short, playful, one gif.',
      }),
      t(DEFAULT_BOARD_ID, 'done', 3, 1000, 'Black theme shipped'),
      t(jam.id, 'todo', 1, 1000, 'Onboarding copy', { assigneeId: 'alex', priority: 'medium', due: day(3) }),
      t(jam.id, 'todo', 4, 2000, 'Fix notification badge', { assigneeId: ME_ID, priority: 'high', due: day(-1) }),
      t(jam.id, 'in_progress', 2, 1000, 'Review the group chat flow', { assigneeId: 'jordan' }),
      t(jam.id, 'done', 3, 1000, 'Home minimal'),
    ],
    activeBoardId: DEFAULT_BOARD_ID,
  });

  // chat
  const dmAlex = uid('dm');
  const dmJordan = uid('dm');
  const grp = uid('grp');
  const base = { createdAt: ago(60 * 24), lastReadAt: ago(0) };
  useChatStore.setState({
    conversations: [
      { id: grp, kind: 'group', name: 'design jam', participantIds: [ME_ID, 'alex', 'jordan'], lastMessageAt: ago(120), ...base },
      { id: dmAlex, kind: 'dm', participantIds: [ME_ID, 'alex'], lastMessageAt: ago(10), ...base, lastReadAt: ago(25) },
      { id: dmJordan, kind: 'dm', participantIds: [ME_ID, 'jordan'], lastMessageAt: ago(40), ...base },
    ],
    messages: [
      { id: uid('m'), conversationId: grp, senderId: 'jordan', body: 'Pushed new notes for the onboarding flow — take a look', createdAt: ago(125) },
      { id: uid('m'), conversationId: grp, senderId: 'alex', body: 'on it 👀', createdAt: ago(122), reactions: [{ emoji: '🙌', by: [ME_ID, 'jordan'] }] },
      { id: uid('m'), conversationId: grp, senderId: ME_ID, body: 'Love the direction. Can we try a softer orange?', createdAt: ago(120) },
      { id: uid('m'), conversationId: dmAlex, senderId: 'alex', body: 'hey — pact is live ✨ the black theme is so clean', createdAt: ago(18) },
      { id: uid('m'), conversationId: dmAlex, senderId: ME_ID, body: 'yess! Discord × Telegram vibe coming together', createdAt: ago(15) },
      { id: uid('m'), conversationId: dmAlex, senderId: 'alex', body: 'Standup in 10 — you in?', createdAt: ago(10) },
      { id: uid('m'), conversationId: dmJordan, senderId: 'jordan', body: 'Can you invite me to the kanban board?', createdAt: ago(40) },
    ],
    activeId: null,
  });

  useNotificationStore.setState({
    notifications: [
      {
        id: uid('n'),
        title: 'Friend request',
        body: 'Riley Chen wants to connect',
        createdAt: ago(180),
        read: false,
        kind: 'friend',
        link: { section: 'chat' },
      },
      {
        id: uid('n'),
        title: 'Alex Rivera',
        body: 'Standup in 10 — you in?',
        createdAt: ago(10),
        read: false,
        kind: 'chat',
        link: { section: 'chat', sub: dmAlex },
      },
    ],
  });
}

// ── backup / reset ───────────────────────────────────────────────────────────

export type Backup = { app: 'pact'; version: 1; exportedAt: string; data: Record<string, string> };

/** Everything pact stores on this device, as a downloadable JSON-able object. (Attachment bytes are not included.) */
export function exportBackup(): Backup {
  const data: Record<string, string> = {};
  for (const key of STORAGE_KEYS) {
    const v = localStorage.getItem(key);
    if (v !== null) data[key] = v;
  }
  return { app: 'pact', version: 1, exportedAt: new Date().toISOString(), data };
}

export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; error: string } {
  try {
    const b = JSON.parse(text) as Partial<Backup>;
    if (b.app !== 'pact' || typeof b.data !== 'object' || b.data === null) return { ok: false, error: 'This doesn’t look like a pact backup file.' };
    const known = Object.keys(b.data).filter((k) => (STORAGE_KEYS as readonly string[]).includes(k));
    if (known.length === 0) return { ok: false, error: 'The backup is empty.' };
    return { ok: true, backup: b as Backup };
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON.' };
  }
}

export function importBackup(backup: Backup) {
  for (const key of STORAGE_KEYS) {
    const v = backup.data[key];
    if (typeof v === 'string') localStorage.setItem(key, v);
  }
}

/** Wipe all pact data on this device (the caller reloads afterwards). */
export async function resetAllData() {
  for (const key of STORAGE_KEYS) localStorage.removeItem(key);
  await clearBlobs().catch(() => {});
}
