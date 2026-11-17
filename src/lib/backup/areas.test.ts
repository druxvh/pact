import { describe, expect, it } from 'vitest';
import { useCaptureStore } from '@/features/capture/store';
import { useChatStore } from '@/features/chat/store';
import { useHomeLayoutStore } from '@/features/home/layout';
import { useHomeStore } from '@/features/home/store';
import { useMainFocusStore } from '@/features/home/widgets/mainFocusStore';
import { DEFAULT_BOARD_ID, useKanbanStore } from '@/features/kanban/store';
import { DEFAULT_NOTEBOOK_ID, useNotesStore } from '@/features/notes/store';
import { usePartyStore } from '@/features/party/store';
import { useTimerStore } from '@/features/timer/store';
import { useTourStore } from '@/features/tour/store';
import { useOmniStore } from '@/lib/omnibox/store';
import { STORAGE_KEYS } from '@/store/demoServer';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useThemeStore } from '@/store/useThemeStore';
import { ME_ID, useUserStore } from '@/store/useUserStore';
import { AREA_BY_KEY, AREA_KEYS, AREAS, areaFields, DEFAULT_BOARD, DEFAULT_NOTEBOOK, ME, NOT_BACKED_UP, scrubForBackup } from './areas';
import { type PreparedBundle, parseEnvelope, prepareBundle } from './prepare';
import type { Bundle } from './types';

const NOW = '2026-11-17T12:00:00.000Z';
const env = (state: unknown, version: number) => JSON.stringify({ state, version });
const bundle = (data: Record<string, string>): Bundle => ({ exportedAt: NOW, appVersion: 't', account: null, data, wallpaper: null });
const st = (p: PreparedBundle) => (p.areas[0] as PreparedBundle['areas'][number]).state;
const only = (key: string, state: unknown, version: number) => prepareBundle(bundle({ [key]: env(state, version) }), NOW);
const N = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  notebookId: DEFAULT_NOTEBOOK,
  number: 1,
  title: id,
  body: '',
  pinned: false,
  assigneeId: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe('the area list stays in step with the app', () => {
  it('constants mirror the real ones', () => {
    expect(ME).toBe(ME_ID);
    expect(DEFAULT_NOTEBOOK).toBe(DEFAULT_NOTEBOOK_ID);
    expect(DEFAULT_BOARD).toBe(DEFAULT_BOARD_ID);
  });

  it('every area’s version is the store’s current persist version (otherwise current data would be treated as "older")', () => {
    const versions: Record<string, number> = {
      'pact-notes': useNotesStore.persist.getOptions().version as number,
      'pact-kanban': useKanbanStore.persist.getOptions().version as number,
      'pact-timer': useTimerStore.persist.getOptions().version as number,
      'pact-chat': useChatStore.persist.getOptions().version as number,
      'pact-user': useUserStore.persist.getOptions().version as number,
      'pact-home': useHomeStore.persist.getOptions().version as number,
      'pact-home-layout': useHomeLayoutStore.persist.getOptions().version as number,
      'pact-main-focus': useMainFocusStore.persist.getOptions().version as number,
      'pact-capture': useCaptureStore.persist.getOptions().version as number,
      'pact-omnibox': useOmniStore.persist.getOptions().version as number,
      'pact-tour': useTourStore.persist.getOptions().version as number,
      'pact-settings': useSettingsStore.persist.getOptions().version as number,
      'pact-appearance': useAppearanceStore.persist.getOptions().version as number,
      'pact-theme': useThemeStore.persist.getOptions().version as number,
      'pact-notifications': useNotificationStore.persist.getOptions().version as number,
      'pact-party': usePartyStore.persist.getOptions().version as number,
    };
    for (const a of AREAS) expect(a.version, a.key).toBe(versions[a.key]);
    expect(Object.keys(versions).sort()).toEqual([...AREA_KEYS].sort());
  });

  it('knows every top-level field each store persists — a new persisted field must be added to its area, or backups would silently drop it', () => {
    const stores: Record<string, { getState: () => unknown; persist: { getOptions: () => { partialize?: (s: never) => unknown } } }> = {
      'pact-notes': useNotesStore,
      'pact-kanban': useKanbanStore,
      'pact-timer': useTimerStore,
      'pact-chat': useChatStore,
      'pact-user': useUserStore,
      'pact-home': useHomeStore,
      'pact-home-layout': useHomeLayoutStore,
      'pact-main-focus': useMainFocusStore,
      'pact-capture': useCaptureStore,
      'pact-omnibox': useOmniStore,
      'pact-tour': useTourStore,
      'pact-settings': useSettingsStore,
      'pact-appearance': useAppearanceStore,
      'pact-theme': useThemeStore,
      'pact-notifications': useNotificationStore,
      'pact-party': usePartyStore,
    } as never;
    // persisted on purpose but not backed up: a static directory the store rebuilds, and secrets
    const LEFT_OUT: Record<string, string[]> = { 'pact-user': ['teammates'], 'pact-party': ['recent'] };
    for (const a of AREAS) {
      const store = stores[a.key];
      const state = store?.getState() as Record<string, unknown>;
      const persisted = store?.persist.getOptions().partialize?.(state as never) ?? state;
      const keys = Object.keys(persisted as Record<string, unknown>).filter((k) => typeof (persisted as Record<string, unknown>)[k] !== 'function');
      const missing = keys.filter((k) => !areaFields(a).includes(k) && !(LEFT_OUT[a.key] ?? []).includes(k));
      expect(missing, a.key).toEqual([]);
    }
  });

  it('covers every key the old backup covered (STORAGE_KEYS)', () => {
    for (const k of STORAGE_KEYS) expect(AREA_KEYS, k).toContain(k);
  });

  it('every persisted key declared anywhere in the source is either backed up or deliberately left out', () => {
    // A new store added by any feature must make a decision here — silently missing from backups is data loss.
    const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const found = new Set<string>();
    for (const [path, text] of Object.entries(files)) {
      if (/\.test\.|\/src\/dev\/|\/src\/lib\/backup\//.test(path)) continue;
      for (const m of text.matchAll(/(?:name:\s*|_KEY\s*=\s*)'(pact-[a-z0-9-]+)'/g)) found.add(m[1] as string);
    }
    const missing = [...found].filter((k) => !AREA_KEYS.includes(k) && !(k in NOT_BACKED_UP));
    expect(missing).toEqual([]);
  });
});

describe('what a backup must never carry', () => {
  it('the auth session, owner marker and sync bookkeeping are not areas', () => {
    for (const k of ['pact-auth', 'pact-local-owner', 'pact-sync-notes', 'pact-appearance-boot']) expect(AREA_BY_KEY[k]).toBeUndefined();
  });

  it('VibeParty room codes are passwords — only the display name is kept', () => {
    const raw = env({ name: 'Ada', recent: [{ code: 'amber-lofi-k7q2x9dm', at: 1 }] }, 1);
    const scrubbed = JSON.parse(scrubForBackup('pact-party', raw));
    expect(scrubbed.state).toEqual({ name: 'Ada', recent: [] });
    expect(scrubForBackup('pact-notes', 'x')).toBe('x');
    const p = only('pact-party', { name: 'Ada'.repeat(20), recent: [{ code: 'secret' }] }, 1);
    expect(st(p)).toEqual({ name: 'AdaAdaAdaAdaAdaAdaAdaAdaAdaAda'.slice(0, 24) });
  });
});

describe('prepareBundle: never trust what is in a file', () => {
  it('reads valid notes and keeps their text', () => {
    const p = only(
      'pact-notes',
      {
        notebooks: [{ id: DEFAULT_NOTEBOOK, name: 'Personal', memberIds: [ME], nextNumber: 3, createdAt: NOW }],
        notes: [N('a', { title: 'Hello', body: 'World' })],
      },
      3,
    );
    expect(p.areas).toHaveLength(1);
    expect(p.areas[0]?.strict).toBe(true);
    expect((st(p).notes as Array<{ title: string }>)[0]?.title).toBe('Hello');
    expect(p.warnings).toEqual([]);
  });

  it('drops unreadable entries, keeps the rest, and says how many', () => {
    const p = only(
      'pact-notes',
      { notebooks: [{ id: 'nb', name: 'x' }], notes: [N('ok', { notebookId: 'nb' }), { id: 5 }, 'text', null, { title: 'no id' }, N('x'.repeat(100))] },
      3,
    );
    expect((st(p).notes as unknown[]).length).toBe(1);
    expect(p.warnings.join(' ')).toMatch(/5 unreadable entries in Notes were skipped/);
  });

  it('coerces wrong field types to safe defaults instead of letting them reach the stores', () => {
    const p = only(
      'pact-notes',
      {
        notebooks: [{ id: 'nb', name: 5, nextNumber: 'x' }],
        notes: [{ id: 'a', notebookId: 'nb', title: { x: 1 }, body: 7, pinned: 'yes', updatedAt: 'garbage', number: -3 }],
      },
      3,
    );
    const note = (st(p).notes as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(note.title).toBe('');
    expect(note.body).toBe('');
    expect(note.pinned).toBe(false);
    expect(typeof note.updatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(note.updatedAt as string))).toBe(false);
    expect(note.number).toBeGreaterThanOrEqual(0);
    const nb = (st(p).notebooks as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(nb.name).toBe('Notebook');
    expect(nb.nextNumber).toBeGreaterThanOrEqual(1);
  });

  it('repairs structure: a notebook always exists, orphan notes are re-homed, duplicate numbers are renumbered, the counter stays ahead', () => {
    const p = only(
      'pact-notes',
      {
        notebooks: [],
        notes: [N('a', { notebookId: 'gone', number: 4 }), N('b', { notebookId: 'gone', number: 4 }), N('c', { number: 2 })],
        activeNotebookId: 'nope',
        selectedId: 'nope',
      },
      3,
    );
    const s = st(p) as {
      notebooks: Array<Record<string, unknown>>;
      notes: Array<Record<string, unknown>>;
      activeNotebookId: string;
      selectedId: unknown;
    };
    expect(s.notebooks.map((b) => b.id)).toEqual([DEFAULT_NOTEBOOK]);
    expect(s.notes.every((n) => n.notebookId === DEFAULT_NOTEBOOK)).toBe(true);
    const numbers = s.notes.map((n) => n.number);
    expect(new Set(numbers).size).toBe(3);
    expect(s.notebooks[0]?.nextNumber).toBeGreaterThan(Math.max(...(numbers as number[])));
    expect(s.activeNotebookId).toBe(DEFAULT_NOTEBOOK);
    expect(s.selectedId).toBeNull();
  });

  it('skips an area that is not an object, or not valid JSON, without touching the others', () => {
    const p = prepareBundle(bundle({ 'pact-notes': '[1,2,3]', 'pact-kanban': 'not json', 'pact-theme': env({ mode: 'light' }, 2) }), NOW);
    expect(p.areas.map((a) => a.spec.key)).toEqual(['pact-theme']);
    expect(p.rejected.map((r) => r.spec.key).sort()).toEqual(['pact-kanban', 'pact-notes']);
  });

  it('a store saved by a NEWER version of the app is skipped with a clear warning (never half-read)', () => {
    const p = only('pact-notes', { notes: [] }, 99);
    expect(p.areas).toHaveLength(0);
    expect(p.rejected[0]?.reason).toBe('newer');
    expect(p.warnings.join(' ')).toMatch(/newer version of pact/);
  });

  it('an OLDER version is accepted leniently (the store upgrades it on load): ids optional, types still checked', () => {
    const p = only('pact-notes', { notes: [{ title: 'v1 note', body: 'x', pinned: 3 }, { id: 'keep' }, 'junk'] }, 1);
    expect(p.areas[0]?.strict).toBe(false);
    expect(p.areas[0]?.version).toBe(1);
    const notes = st(p).notes as Array<Record<string, unknown>>;
    expect(notes).toEqual([{ title: 'v1 note', body: 'x' }, { id: 'keep' }]);
    expect(st(p).notebooks).toBeUndefined(); // the store's migrate supplies it
  });

  describe('Home shortcuts', () => {
    it('only web links are accepted — a shortcut is rendered as a link', () => {
      const p = only(
        'pact-home',
        {
          pinned: [
            { id: 'a', title: 'ok', url: 'https://example.com/x' },
            { id: 'b', title: 'js', url: 'javascript:alert(1)' },
            { id: 'c', title: 'data', url: 'data:text/html,<script>1</script>' },
            { id: 'd', title: 'chrome', url: 'chrome://settings' },
            { id: 'e', title: 'plain', url: 'not a url' },
            { id: 'f', title: 'http', url: 'http://example.org' },
          ],
          hiddenHosts: ['a.com', 7, ''],
        },
        1,
      );
      expect((st(p).pinned as Array<{ id: string }>).map((x) => x.id)).toEqual(['a', 'f']);
      expect(st(p).hiddenHosts).toEqual(['a.com']);
    });
  });

  describe('Appearance: values end up inside a generated stylesheet', () => {
    it('colours must be exactly #rrggbb — CSS can’t be smuggled in', () => {
      const evil = 'red;} body{background:url(//evil.example/x)} .x{color:';
      const p = only('pact-appearance', { accent: { kind: 'custom', hex: evil }, wallpaper: { kind: 'solid', color: evil }, font: 'geist' }, 2);
      const s = st(p) as Record<string, unknown>;
      expect(s.accent).toBeUndefined();
      expect(s.wallpaper).toBeUndefined();
      expect(s.font).toBe('geist');
      const good = only(
        'pact-appearance',
        { accent: { kind: 'custom', hex: '#12abEF' }, wallpaper: { kind: 'gradient', from: '#000000', to: '#ffffff', angle: 90 } },
        2,
      );
      expect(st(good).accent).toEqual({ kind: 'custom', hex: '#12abEF' });
      expect(st(good).wallpaper).toEqual({ kind: 'gradient', from: '#000000', to: '#ffffff', angle: 90 });
    });

    it('unknown fonts, presets and meshes are dropped; numbers are range-checked; an image wallpaper always points at the one stored picture', () => {
      const p = only(
        'pact-appearance',
        {
          accent: { kind: 'preset', id: 'nope' },
          font: 'comic-sans-from-the-internet',
          monoFont: 5,
          wallpaper: { kind: 'mesh', id: 'nope' },
          dim: { light: 999, dark: 'x' },
          blur: 500,
        },
        2,
      );
      const s = st(p) as Record<string, unknown>;
      expect(s.accent).toBeUndefined();
      expect(s.font).toBeUndefined();
      expect(s.wallpaper).toBeUndefined();
      expect(s.blur).toBeUndefined();
      expect(s.dim).toEqual({ light: 0, dark: 0 });
      const img = only('pact-appearance', { wallpaper: { kind: 'image', id: '../../etc/passwd', name: 'n'.repeat(500) } }, 2);
      expect(st(img).wallpaper).toEqual({ kind: 'image', id: 'wallpaper-image', name: 'n'.repeat(200) });
    });
  });

  it('Settings and theme accept only their known values', () => {
    const s = only('pact-settings', { clock: '99h', showGreeting: 'yes', sounds: false, motion: 'full', extra: 1 }, 1).areas[0]?.state;
    expect(s).toEqual({ sounds: false, motion: 'full' });
    expect(only('pact-theme', { mode: 'neon' }, 2).areas[0]?.state).toEqual({});
  });

  it('a timer that was running when the backup was made is never revived', () => {
    const p = only(
      'pact-timer',
      {
        phase: 'focus',
        status: 'running',
        endsAt: 5,
        remainingMs: 7,
        durations: { focus: 30, short: 5, long: 15 },
        sessions: [{ id: 's1', phase: 'focus', minutes: 25, completedAt: NOW }],
        lastCompleted: { id: 'x' },
      },
      2,
    );
    const s = st(p) as Record<string, unknown>;
    expect(s.status).toBe('idle');
    expect(s.endsAt).toBeNull();
    expect(s.remainingMs).toBe(30 * 60_000);
    expect(s.lastCompleted).toBeNull();
    expect(s.sessions).toHaveLength(1);
  });

  it('profile: the id is forced to the local user, usernames are validated, email stays optional', () => {
    const p = only(
      'pact-user',
      {
        currentUser: { id: 'someone-else', displayName: 'Ada', username: 'NOT VALID!', email: 5 },
        friendIds: ['alex', 3],
        friendRequests: [{ id: 'r1', fromId: 'a', toId: 'b', status: 'weird' }, 'x'],
      },
      4,
    );
    const s = st(p) as { currentUser: Record<string, unknown>; friendIds: string[]; friendRequests: Array<Record<string, unknown>> };
    expect(s.currentUser).toMatchObject({ id: ME, displayName: 'Ada', username: 'you' });
    expect(s.currentUser.email).toBeUndefined();
    expect(s.friendIds).toEqual(['alex']);
    expect(s.friendRequests).toEqual([{ id: 'r1', fromId: 'a', toId: 'b', status: 'pending', createdAt: expect.any(String) }]);
  });

  it('chat: messages must belong to a conversation that is in the backup', () => {
    const conv = { id: 'c1', kind: 'dm', participantIds: [ME], createdAt: NOW, lastMessageAt: NOW, lastReadAt: NOW };
    const p = only(
      'pact-chat',
      {
        conversations: [conv],
        messages: [
          { id: 'm1', conversationId: 'c1', senderId: ME, body: 'hi', createdAt: NOW },
          { id: 'm2', conversationId: 'ghost', body: 'x' },
        ],
        activeId: 'ghost',
      },
      2,
    );
    const s = st(p) as { messages: unknown[]; activeId: unknown };
    expect(s.messages).toHaveLength(1);
    expect(s.activeId).toBeNull();
  });
});

describe('parseEnvelope', () => {
  it('needs { state: object }, defaults a missing version to 0, and never throws', () => {
    expect(parseEnvelope(env({ a: 1 }, 3))).toEqual({ state: { a: 1 }, version: 3 });
    expect(parseEnvelope(JSON.stringify({ state: {} }))).toEqual({ state: {}, version: 0 });
    for (const bad of [undefined, null, '', 'x', '[]', '{"state":[]}', '{"state":5}']) expect(parseEnvelope(bad)).toBeNull();
  });
});
