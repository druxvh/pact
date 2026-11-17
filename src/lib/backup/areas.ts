/**
 * What a backup contains, area by area: which storage key, how to validate it, which collections inside it can be
 * counted / compared / merged, and what to repair afterwards.
 *
 * Deliberately NOT in any backup: the auth session, the account-ownership marker, the notes sync bookkeeping and the
 * sign-in PKCE verifier (secrets / per-device state), and the VibeParty "recent rooms" (room codes are bearer
 * passwords — only the display name is kept).
 */
import { ACCENT_PRESETS } from '@/lib/appearance/accent';
import { fontById } from '@/lib/appearance/fonts';
import { IMAGE_ASSET_ID, MESHES } from '@/lib/appearance/wallpaper';
import {
  arr,
  bool,
  type Counter,
  field,
  INVALID,
  iso,
  isRecord,
  jsonObject,
  nullable,
  num,
  obj,
  oneOf,
  optional,
  type Parser,
  type Rec,
  record,
  required,
  str,
} from '@/lib/backup/schema';
import { SECTION_IDS } from '@/store/useNavStore';

/** Mirrors `ME_ID` in useUserStore / the default notebook & board ids (a test keeps them in step). */
export const ME = 'local-user';
export const DEFAULT_NOTEBOOK = 'nb-personal';
export const DEFAULT_BOARD = 'board-personal';

export type AreaId =
  | 'notes'
  | 'kanban'
  | 'timer'
  | 'chat'
  | 'user'
  | 'home'
  | 'homeLayout'
  | 'mainFocus'
  | 'capture'
  | 'omnibox'
  | 'tour'
  | 'settings'
  | 'appearance'
  | 'theme'
  | 'notifications'
  | 'party';

/** A list inside a store that can be counted, compared by id and merged. */
export type Coll = {
  field: string;
  noun: readonly [string, string];
  /** Items are plain strings (e.g. hidden hosts), compared by value. */
  primitive?: boolean;
  /** Field holding the edit time, to decide which copy is newer. */
  stamp?: string;
  /** Sort the merged list by the stamp. */
  order?: 'asc' | 'desc';
};

export type AreaSpec = {
  id: AreaId;
  label: string;
  key: string;
  /** The store's current persist version. */
  version: number;
  colls: readonly Coll[];
  /** Preferences can't be meaningfully merged: "Merge" leaves them as they are, only "Replace" changes them. */
  mergeable: boolean;
  /** Validate and clean a state object. `strict` = the data is in the current version. */
  parse: (state: unknown, strict: boolean, c: Counter) => Rec | null;
  /** Fix invariants (a notebook must exist, numbers unique…) — only run on current-version data, also after a merge. */
  repair?: (state: Rec, now: string) => Rec;
  /** Applied to a backup's data when it is read (not when merging into local data): e.g. never revive a stale running timer. */
  normalize?: (state: Rec) => Rec;
};

const nowIso = () => new Date().toISOString();
const id64 = str({ min: 1, max: 64 });
const text = (max: number) => field(str({ max, truncate: true }), () => '');
const stamp = () => field(iso, nowIso);
const hex = /^#[0-9a-fA-F]{6}$/;

/** Build a state parser from per-field parsers (all optional: a missing/invalid field leaves the store's default). */
function stateParser(shape: (strict: boolean) => Record<string, Parser>): AreaSpec['parse'] {
  const parse: AreaSpec['parse'] = (state, strict, c) => {
    if (!isRecord(state)) return null;
    const out: Rec = {};
    for (const [k, p] of Object.entries(shape(strict))) {
      if (!Object.hasOwn(state, k)) continue;
      const r = p(state[k], c);
      if (r === INVALID) c.dropped++;
      else if (r !== undefined) out[k] = r;
    }
    return out;
  };
  return Object.assign(parse, { fields: Object.keys(shape(true)) });
}

/** The top-level state fields an area's parser knows about (anything else in a file is dropped). */
export const areaFields = (spec: AreaSpec): readonly string[] => (spec.parse as AreaSpec['parse'] & { fields?: string[] }).fields ?? [];

/** Give later duplicates of (container, number) a fresh number and keep each container's counter ahead of every number. */
function renumber(items: Rec[], containers: Rec[], containerField: string): void {
  const next = new Map<string, number>();
  for (const b of containers) next.set(String(b.id), Math.max(1, typeof b.nextNumber === 'number' ? b.nextNumber : 1));
  for (const it of items)
    next.set(String(it[containerField]), Math.max(next.get(String(it[containerField])) ?? 1, (typeof it.number === 'number' ? it.number : 0) + 1));
  const used = new Set<string>();
  for (const it of items) {
    const k = `${String(it[containerField])}#${String(it.number)}`;
    if (used.has(k)) {
      const n = next.get(String(it[containerField])) ?? 1;
      it.number = n;
      next.set(String(it[containerField]), n + 1);
    }
    used.add(`${String(it[containerField])}#${String(it.number)}`);
  }
  for (const b of containers) b.nextNumber = next.get(String(b.id)) ?? b.nextNumber;
}

const dedupeById = (items: Rec[]): Rec[] => {
  const seen = new Set<string>();
  return items.filter((x) => {
    const id = String(x.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

// ── notes ────────────────────────────────────────────────────────────────────

const notes: AreaSpec = {
  id: 'notes',
  label: 'Notes',
  key: 'pact-notes',
  version: 3,
  mergeable: true,
  colls: [
    { field: 'notes', noun: ['note', 'notes'], stamp: 'updatedAt' },
    { field: 'notebooks', noun: ['notebook', 'notebooks'] },
  ],
  parse: stateParser((strict) => {
    const notebook = obj(
      {
        id: required(id64),
        name: field(str({ max: 500, truncate: true }), () => 'Notebook'),
        memberIds: field(arr(str({ max: 64 }), { max: 100 }), () => [ME]),
        nextNumber: field(num({ int: true, min: 1, max: 1e9 }), () => 1),
        createdAt: stamp(),
      },
      strict,
    );
    const note = obj(
      {
        id: required(id64),
        notebookId: field(str({ max: 64 }), () => ''),
        number: field(num({ int: true, min: 0, max: 1e9 }), () => 0),
        title: text(500),
        body: text(500_000),
        pinned: field(bool, () => false),
        assigneeId: field(nullable(str({ max: 64 })), () => null),
        createdAt: stamp(),
        updatedAt: stamp(),
      },
      strict,
    );
    return {
      notebooks: arr(notebook, { max: 2000 }),
      notes: arr(note, { max: 50_000 }),
      activeNotebookId: str({ max: 64 }),
      selectedId: nullable(str({ max: 64 })),
    };
  }),
  repair: (state, now) => {
    const notebooks = dedupeById(((state.notebooks as Rec[] | undefined) ?? []).map((b) => ({ ...b })));
    if (notebooks.length === 0) notebooks.push({ id: DEFAULT_NOTEBOOK, name: 'Personal', memberIds: [ME], nextNumber: 1, createdAt: now });
    const ids = new Set(notebooks.map((b) => String(b.id)));
    const first = String(notebooks[0]?.id);
    const list = dedupeById(((state.notes as Rec[] | undefined) ?? []).map((n) => ({ ...n }))).map((n) =>
      ids.has(String(n.notebookId)) ? n : { ...n, notebookId: first },
    );
    renumber(list, notebooks, 'notebookId');
    const active = typeof state.activeNotebookId === 'string' && ids.has(state.activeNotebookId) ? state.activeNotebookId : first;
    const sel = typeof state.selectedId === 'string' && list.some((n) => n.id === state.selectedId) ? state.selectedId : null;
    return { ...state, notebooks, notes: list, activeNotebookId: active, selectedId: sel };
  },
};

// ── kanban ───────────────────────────────────────────────────────────────────

const kanban: AreaSpec = {
  id: 'kanban',
  label: 'Kanban boards',
  key: 'pact-kanban',
  version: 2,
  mergeable: true,
  colls: [
    { field: 'tasks', noun: ['task', 'tasks'], stamp: 'updatedAt' },
    { field: 'boards', noun: ['board', 'boards'] },
  ],
  parse: stateParser((strict) => {
    const board = obj(
      {
        id: required(id64),
        name: field(str({ max: 500, truncate: true }), () => 'Board'),
        memberIds: field(arr(str({ max: 64 }), { max: 100 }), () => [ME]),
        nextNumber: field(num({ int: true, min: 1, max: 1e9 }), () => 1),
        createdAt: stamp(),
      },
      strict,
    );
    const task = obj(
      {
        id: required(id64),
        boardId: field(str({ max: 64 }), () => ''),
        columnId: field(oneOf('todo', 'in_progress', 'done'), () => 'todo'),
        number: field(num({ int: true, min: 0, max: 1e9 }), () => 0),
        title: text(500),
        description: text(20_000),
        assigneeId: field(nullable(str({ max: 64 })), () => null),
        priority: field(oneOf('none', 'low', 'medium', 'high'), () => 'none'),
        due: field(nullable(str({ pattern: /^\d{4}-\d{2}-\d{2}$/ })), () => null),
        order: field(num({ min: -1e12, max: 1e12 }), () => 1000),
        createdAt: stamp(),
        updatedAt: stamp(),
        completedAt: field(nullable(iso), () => null),
      },
      strict,
    );
    return { boards: arr(board, { max: 500 }), tasks: arr(task, { max: 50_000 }), activeBoardId: str({ max: 64 }) };
  }),
  repair: (state, now) => {
    const boards = dedupeById(((state.boards as Rec[] | undefined) ?? []).map((b) => ({ ...b })));
    if (boards.length === 0) boards.push({ id: DEFAULT_BOARD, name: 'Personal', memberIds: [ME], nextNumber: 1, createdAt: now });
    const ids = new Set(boards.map((b) => String(b.id)));
    const first = String(boards[0]?.id);
    const tasks = dedupeById(((state.tasks as Rec[] | undefined) ?? []).map((t) => ({ ...t }))).map((t) =>
      ids.has(String(t.boardId)) ? t : { ...t, boardId: first },
    );
    renumber(tasks, boards, 'boardId');
    const active = typeof state.activeBoardId === 'string' && ids.has(state.activeBoardId) ? state.activeBoardId : first;
    return { ...state, boards, tasks, activeBoardId: active };
  },
};

// ── timer ────────────────────────────────────────────────────────────────────

const PHASES = ['focus', 'short', 'long'] as const;

const timer: AreaSpec = {
  id: 'timer',
  label: 'Focus timer',
  key: 'pact-timer',
  version: 2,
  mergeable: true,
  colls: [
    { field: 'sessions', noun: ['focus session', 'focus sessions'], stamp: 'completedAt', order: 'desc' },
    { field: 'presets', noun: ['custom timer', 'custom timers'] },
  ],
  parse: stateParser((strict) => {
    const dur = num({ min: 1, max: 600 });
    const session = obj(
      {
        id: required(id64),
        phase: field(oneOf(...PHASES), () => 'focus'),
        minutes: field(num({ min: 0, max: 100_000 }), () => 0),
        completedAt: stamp(),
        intent: field(nullable(str({ max: 500, truncate: true })), () => null),
        taskId: field(nullable(str({ max: 64 })), () => null),
        presetId: optional(nullable(str({ max: 64 }))),
      },
      strict,
    );
    const preset = obj(
      {
        id: required(id64),
        name: field(str({ max: 24, truncate: true }), () => 'Timer'),
        icon: field(str({ max: 40 }), () => 'timer'),
        minutes: field(num({ min: 1, max: 120 }), () => 25),
      },
      strict,
    );
    return {
      phase: oneOf(...PHASES),
      status: oneOf('idle', 'running', 'paused'),
      durations: (v, c) => {
        const r = obj({ focus: field(dur), short: field(dur), long: field(dur) }, false)(v, c);
        return r;
      },
      endsAt: nullable(num()),
      remainingMs: num({ min: 0, max: 1e10 }),
      cycle: num({ int: true, min: 0, max: 1000 }),
      longEvery: num({ int: true, min: 1, max: 100 }),
      autoStart: bool,
      intent: str({ max: 500, truncate: true }),
      linkedTaskId: nullable(str({ max: 64 })),
      presets: arr(preset, { max: 12 }),
      activePresetId: nullable(str({ max: 64 })),
      sessions: arr(session, { max: 20_000 }),
      lastCompleted: nullable(jsonObject(2000)),
    };
  }),
  // A timer that was "running" when the backup was made ended long ago — never revive a stale countdown.
  normalize: (state) => {
    const d = isRecord(state.durations) ? state.durations : {};
    const phase = typeof state.phase === 'string' && (PHASES as readonly string[]).includes(state.phase) ? state.phase : 'focus';
    const minutes = typeof d[phase] === 'number' ? (d[phase] as number) : 25;
    return { ...state, status: 'idle', endsAt: null, remainingMs: minutes * 60_000, lastCompleted: null };
  },
};

// ── chat (a local demo backend, but still the person's data) ─────────────────

const chat: AreaSpec = {
  id: 'chat',
  label: 'Chats',
  key: 'pact-chat',
  version: 2,
  mergeable: true,
  colls: [
    { field: 'messages', noun: ['message', 'messages'], stamp: 'createdAt', order: 'asc' },
    { field: 'conversations', noun: ['conversation', 'conversations'] },
  ],
  parse: stateParser((strict) => {
    const conversation = obj(
      {
        id: required(id64),
        kind: field(oneOf('dm', 'group'), () => 'dm'),
        name: optional(str({ max: 200, truncate: true })),
        participantIds: field(arr(str({ max: 64 }), { max: 200 }), () => []),
        createdAt: stamp(),
        lastMessageAt: stamp(),
        lastReadAt: stamp(),
      },
      strict,
    );
    const attachment = obj(
      {
        id: required(id64),
        kind: field(oneOf('image', 'video'), () => 'image'),
        name: field(str({ max: 300, truncate: true }), () => ''),
        size: field(num({ min: 0 }), () => 0),
        mime: field(str({ max: 100 }), () => ''),
        width: optional(num({ min: 0, max: 100_000 })),
        height: optional(num({ min: 0, max: 100_000 })),
      },
      strict,
    );
    const message = obj(
      {
        id: required(id64),
        conversationId: required(id64),
        senderId: field(str({ max: 64 }), () => ''),
        body: text(8000),
        createdAt: stamp(),
        attachments: optional(arr(attachment, { max: 20 })),
        replyTo: optional(str({ max: 64 })),
        reactions: optional(arr(obj({ emoji: required(str({ max: 32 })), by: field(arr(str({ max: 64 }), { max: 200 }), () => []) }, strict), { max: 50 })),
        deleted: optional(bool),
      },
      strict,
    );
    return {
      conversations: arr(conversation, { max: 2000 }),
      messages: arr(message, { max: 50_000 }),
      activeId: nullable(str({ max: 64 })),
      drafts: record(str({ max: 8000, truncate: true }), { maxKeys: 2000 }),
      recentEmoji: arr(str({ max: 32 }), { max: 32 }),
    };
  }),
  repair: (state) => {
    const convs = dedupeById(((state.conversations as Rec[] | undefined) ?? []).map((c) => ({ ...c })));
    const ids = new Set(convs.map((c) => String(c.id)));
    const messages = dedupeById(((state.messages as Rec[] | undefined) ?? []).map((m) => ({ ...m }))).filter((m) => ids.has(String(m.conversationId)));
    const active = typeof state.activeId === 'string' && ids.has(state.activeId) ? state.activeId : null;
    return { ...state, conversations: convs, messages, activeId: active };
  },
};

// ── profile & friends ────────────────────────────────────────────────────────

const user: AreaSpec = {
  id: 'user',
  label: 'Profile & friends',
  key: 'pact-user',
  version: 4,
  mergeable: true,
  colls: [
    { field: 'friendIds', noun: ['friend', 'friends'], primitive: true },
    { field: 'friendRequests', noun: ['friend request', 'friend requests'], stamp: 'createdAt' },
  ],
  parse: stateParser((strict) => {
    const person = obj(
      {
        id: field(str({ max: 64 }), () => ME),
        displayName: field(str({ min: 1, max: 40, truncate: true }), () => 'You'),
        username: field(str({ pattern: /^[a-z0-9_]{3,20}$/ }), () => 'you'),
        designation: optional(str({ max: 60, truncate: true })),
        bio: optional(str({ max: 160, truncate: true })),
        email: optional(str({ max: 120, truncate: true })),
        isOnline: field(bool, () => true),
      },
      strict,
    );
    const request = obj(
      {
        id: required(id64),
        fromId: required(str({ max: 64 })),
        toId: required(str({ max: 64 })),
        status: field(oneOf('pending', 'accepted', 'rejected'), () => 'pending'),
        createdAt: stamp(),
      },
      strict,
    );
    return {
      currentUser: (v, c) => {
        const r = person(v, c);
        return r === INVALID ? INVALID : { ...r, id: ME };
      },
      friendIds: arr(str({ min: 1, max: 64 }), { max: 5000 }),
      friendRequests: arr(request, { max: 5000 }),
      onboarded: bool,
    };
  }),
};

// ── Home: shortcuts ──────────────────────────────────────────────────────────

/** Only web links: a shortcut is rendered as a link, so `javascript:` and friends are never accepted. */
const webUrl: Parser<string> = (v) => {
  if (typeof v !== 'string' || v.length > 2048) return INVALID;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : INVALID;
  } catch {
    return INVALID;
  }
};

const home: AreaSpec = {
  id: 'home',
  label: 'Home shortcuts',
  key: 'pact-home',
  version: 1,
  mergeable: true,
  colls: [
    { field: 'pinned', noun: ['shortcut', 'shortcuts'] },
    { field: 'hiddenHosts', noun: ['hidden site', 'hidden sites'], primitive: true },
  ],
  parse: stateParser((strict) => ({
    pinned: arr(obj({ id: required(id64), title: text(120), url: required(webUrl) }, strict), { max: 500 }),
    hiddenHosts: arr(str({ min: 1, max: 253 }), { max: 1000 }),
    recent: arr(str({ max: 200 }), { max: 12 }),
    seeded: bool,
  })),
};

const homeLayout: AreaSpec = {
  id: 'homeLayout',
  label: 'Home layout',
  key: 'pact-home-layout',
  version: 1,
  mergeable: false,
  colls: [],
  // The store runs `layout` and `countdown` through its own sanitisers on load; here we only bound the size and type.
  parse: stateParser(() => ({ layout: jsonObject(5000), countdown: jsonObject(1000), draft: str({ max: 20_000, truncate: true }) })),
};

// Small stores added by other features. Each one coerces whatever it loads, so here we only bound type and size.
const mainFocus: AreaSpec = {
  id: 'mainFocus',
  label: 'Daily focus history',
  key: 'pact-main-focus',
  version: 1,
  mergeable: false,
  colls: [],
  parse: stateParser(() => ({ entries: arr(jsonObject(2000), { max: 5000 }) })),
};

const capture: AreaSpec = {
  id: 'capture',
  label: 'Quick capture',
  key: 'pact-capture',
  version: 1,
  mergeable: false,
  colls: [],
  parse: stateParser(() => ({
    kind: oneOf('note', 'task'),
    notebookId: nullable(str({ max: 64 })),
    boardId: nullable(str({ max: 64 })),
    columnId: oneOf('todo', 'in_progress', 'done'),
    draft: str({ max: 20_000, truncate: true }),
  })),
};

const omnibox: AreaSpec = {
  id: 'omnibox',
  label: 'Search ranking & pins',
  key: 'pact-omnibox',
  version: 1,
  mergeable: false,
  colls: [],
  parse: stateParser(() => ({ entries: jsonObject(200_000), pinned: arr(str({ max: 300 }), { max: 200 }) })),
};

const tour: AreaSpec = {
  id: 'tour',
  label: 'Tour progress',
  key: 'pact-tour',
  version: 1,
  mergeable: false,
  colls: [],
  parse: stateParser(() => ({ completed: jsonObject(200), requested: bool })),
};

const settings: AreaSpec = {
  id: 'settings',
  label: 'Preferences',
  key: 'pact-settings',
  version: 1,
  mergeable: false,
  colls: [],
  parse: stateParser(() => ({
    clock: oneOf('auto', '12h', '24h'),
    showGreeting: bool,
    showTopSites: bool,
    sounds: bool,
    motion: oneOf('system', 'full', 'reduced'),
  })),
};

// ── appearance ───────────────────────────────────────────────────────────────

const color: Parser<string> = (v) => (typeof v === 'string' && hex.test(v) ? v : INVALID);

/** Colours end up inside a generated stylesheet, so they must be exactly `#rrggbb` — never free text. */
const wallpaper: Parser<Rec> = (v, c) => {
  if (!isRecord(v)) return INVALID;
  switch (v.kind) {
    case 'none':
      return { kind: 'none' };
    case 'solid': {
      const col = color(v.color, c);
      return col === INVALID ? INVALID : { kind: 'solid', color: col };
    }
    case 'gradient': {
      const from = color(v.from, c);
      const to = color(v.to, c);
      const angle = num({ min: -3600, max: 3600 })(v.angle, c);
      return from === INVALID || to === INVALID ? INVALID : { kind: 'gradient', from, to, angle: angle === INVALID ? 135 : angle };
    }
    case 'mesh':
      return typeof v.id === 'string' && MESHES.some((m) => m.id === v.id) ? { kind: 'mesh', id: v.id } : INVALID;
    case 'image':
      return { kind: 'image', id: IMAGE_ASSET_ID, name: typeof v.name === 'string' ? v.name.slice(0, 200) : 'Wallpaper' };
    default:
      return INVALID;
  }
};

const accent: Parser<Rec> = (v) => {
  if (!isRecord(v)) return INVALID;
  if (v.kind === 'preset') return typeof v.id === 'string' && ACCENT_PRESETS.some((p) => p.id === v.id) ? { kind: 'preset', id: v.id } : INVALID;
  if (v.kind === 'custom') return typeof v.hex === 'string' && hex.test(v.hex) ? { kind: 'custom', hex: v.hex } : INVALID;
  return INVALID;
};

const knownFont: Parser<string> = (v) => (typeof v === 'string' && fontById(v) ? v : INVALID);

const appearance: AreaSpec = {
  id: 'appearance',
  label: 'Appearance (accent, fonts, wallpaper)',
  key: 'pact-appearance',
  version: 2,
  mergeable: false,
  colls: [],
  parse: stateParser((strict) => {
    const dim01 = num({ min: 0, max: 80 });
    return {
      accent,
      font: knownFont,
      monoFont: knownFont,
      wallpaper,
      // v1 kept one number for both themes; the store's migrate upgrades it
      dim: (v, c) =>
        strict
          ? obj({ light: field(dim01, () => 0), dark: field(dim01, () => 0) }, true)(v, c)
          : typeof v === 'number'
            ? dim01(v, c)
            : obj({ light: field(dim01), dark: field(dim01) }, false)(v, c),
      blur: num({ min: 0, max: 24 }),
      imageLuminance: nullable(num({ min: 0, max: 1 })),
    };
  }),
};

const theme: AreaSpec = {
  id: 'theme',
  label: 'Theme',
  key: 'pact-theme',
  version: 2,
  mergeable: false,
  colls: [],
  // v1 stored `{ theme }`; the store's migrate reads it
  parse: stateParser(() => ({ mode: oneOf('light', 'dark', 'system'), theme: oneOf('light', 'dark', 'system') })),
};

const notifications: AreaSpec = {
  id: 'notifications',
  label: 'Notifications',
  key: 'pact-notifications',
  version: 2,
  mergeable: true,
  colls: [{ field: 'notifications', noun: ['notification', 'notifications'], stamp: 'createdAt', order: 'desc' }],
  parse: stateParser((strict) => ({
    notifications: arr(
      obj(
        {
          id: required(id64),
          title: text(300),
          body: text(2000),
          createdAt: stamp(),
          read: field(bool, () => false),
          kind: optional(oneOf('friend', 'chat', 'system', 'space', 'timer')),
          key: optional(str({ max: 200 })),
          link: optional(obj({ section: required(oneOf(...SECTION_IDS)), sub: optional(nullable(str({ max: 200 }))) }, strict)),
        },
        strict,
      ),
      { max: 200 },
    ),
  })),
};

// ── VibeParty ────────────────────────────────────────────────────────────────

const party: AreaSpec = {
  id: 'party',
  label: 'VibeParty name',
  key: 'pact-party',
  version: 1,
  mergeable: false,
  colls: [],
  // `recent` (room codes) is dropped on purpose: a room code is a password.
  parse: stateParser(() => ({ name: str({ max: 24, truncate: true }) })),
};

export const AREAS: readonly AreaSpec[] = [
  notes,
  kanban,
  timer,
  chat,
  user,
  home,
  homeLayout,
  mainFocus,
  capture,
  omnibox,
  tour,
  settings,
  appearance,
  theme,
  notifications,
  party,
];
export const AREA_BY_KEY: Readonly<Record<string, AreaSpec>> = Object.fromEntries(AREAS.map((a) => [a.key, a]));
export const AREA_KEYS: readonly string[] = AREAS.map((a) => a.key);

/**
 * Storage keys deliberately left out of every backup, and why. (A test fails when a new key appears that is in neither
 * list, so a new store can't silently go missing from backups.)
 */
export const NOT_BACKED_UP: Readonly<Record<string, string>> = {
  'pact-auth': 'the sign-in session — a secret',
  'pact-local-owner': 'which account owns this device — per device',
  'pact-sync-notes': 'notes sync bookkeeping — rebuilt from the account',
  'pact-appearance-boot': 'a cache of the first-paint appearance — rebuilt on load',
  'pact-chat-tab': 'which Chat tab was open last — trivial UI state',
  'pact-community-last': 'the last community opened — belongs to the account on the server',
  'pact-party-client': 'this browser’s VibeParty identity — per device',
  'pact-party-host': 'live VibeParty room state — ephemeral',
};

/** Sanitise one persisted value from our own storage before it goes into a file or snapshot (secrets removed, nothing else touched). */
export function scrubForBackup(key: string, raw: string): string {
  if (key !== 'pact-party') return raw;
  try {
    const v = JSON.parse(raw) as { state?: Rec; version?: number };
    if (v && isRecord(v.state)) return JSON.stringify({ ...v, state: { ...v.state, recent: [] } });
  } catch {
    /* fall through */
  }
  return raw;
}
