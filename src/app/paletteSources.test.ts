import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProviders, type SourceOptions } from '@/app/paletteSources';
import { useKanbanStore } from '@/features/kanban/store';
import { useNotesStore } from '@/features/notes/store';
import { useTimerStore } from '@/features/timer/store';
import { runOmnibox } from '@/lib/omnibox/engine';
import { emptyUsage } from '@/lib/omnibox/frecency';
import type { OmniCtx, OmniResult } from '@/lib/omnibox/types';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';

const toast = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn(), undo: vi.fn() } }));
vi.mock('@/lib/toast', () => toast);
vi.mock('@/lib/ext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ext')>()),
  openUrl: vi.fn(),
  webSearch: vi.fn(async () => {}),
  pactUrl: (h = '') => `chrome-extension://x/newtab.html${h}`,
}));
vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn(async () => true) }));

const setUser = (signedIn: boolean) =>
  useAuthStore.setState(signedIn ? { status: 'signedIn', user: { id: 'u1', email: 'a@b.c', provider: 'github', name: 'A' } } : { status: 'guest', user: null });

const opts = (over: Partial<SourceOptions> = {}): SourceOptions => ({
  surface: 'palette',
  signedIn: true,
  links: [],
  recent: [],
  removeRecent: vi.fn(),
  recordSearch: vi.fn(),
  ...over,
});
const ctx = (o: SourceOptions, over: Partial<OmniCtx> = {}) =>
  ({
    surface: o.surface,
    now: new Date(2026, 10, 17, 9, 30),
    locale: 'en-US',
    signedIn: o.signedIn,
    refresh: vi.fn(),
    scope: null,
    pinned: [],
    ...over,
  }) as OmniCtx;
const search = (q: string, o: SourceOptions, c: Partial<OmniCtx> = {}) =>
  runOmnibox(q, ctx(o, c), buildProviders(o), { ...emptyUsage(), pinned: [...(c.pinned ?? [])] }, { recentFromUsage: o.surface === 'palette' });
const find = (results: OmniResult[], id: string) => results.find((r) => r.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setUser(true);
  useNavStore.setState({ section: 'home', sub: null });
  useUiStore.setState({ signInOpen: false, paletteOpen: false, pendingNewTask: false, pendingTaskId: null });
  useNotesStore.setState({ notes: [], selectedId: null });
  useKanbanStore.setState({ tasks: [] });
  useTimerStore.getState().reset();
});

describe('guests', () => {
  const o = opts({ signedIn: false });

  it('see locked rows for account sections that open the sign-in dialog', async () => {
    setUser(false);
    const { results } = search('notes', o);
    const row = find(results, 'lock:notes');
    expect(row).toMatchObject({ group: 'pages', locked: true, subtitle: 'Sign in to unlock' });
    await row?.primary.run();
    expect(useUiStore.getState().signInOpen).toBe(true);
  });

  it('never get notes, tasks, tools or chats', () => {
    useNotesStore.getState().addNote({ title: 'Secret plans' });
    const groups = new Set(search('secret', o).results.map((r) => r.group));
    expect(groups.has('notes')).toBe(false);
    expect(search('calc', o).results.some((r) => r.group === 'tools')).toBe(false);
  });

  it('get a locked note/timer card instead of creating anything', async () => {
    const note = search('note: buy milk', o).results[0];
    expect(note).toMatchObject({ id: 'intent:note', group: 'top', locked: true });
    await note?.primary.run();
    expect(useUiStore.getState().signInOpen).toBe(true);
    expect(useNotesStore.getState().notes).toHaveLength(0);

    const timer = search('timer 25', o).results[0];
    expect(timer).toMatchObject({ id: 'answer', locked: true });
    expect(timer?.answer?.cta).toBe('Sign in to use');
    await timer?.primary.run();
    expect(useTimerStore.getState().status).toBe('idle');
  });

  it('can still use sums, bangs and the Home-only actions', () => {
    expect(search('2+2', opts({ surface: 'home', signedIn: false })).results[0]?.answer?.value).toBe('4');
    expect(search('theme', o).results.some((r) => r.id === 'action:theme')).toBe(true);
    expect(search('new note', o).results.some((r) => r.id === 'action:new-note')).toBe(false);
  });

  it('get a single invitation, not seven locked rows, in an empty palette', () => {
    const ids = search('', o).results.map((r) => r.id);
    expect(ids[0]).toBe('try:sign-in');
    expect(ids.some((id) => id.startsWith('lock:'))).toBe(false);
  });

  it('see examples and a sign-in row on an empty Home box', () => {
    const { results } = search('', opts({ surface: 'home', signedIn: false }));
    expect(results.map((r) => r.id)).toEqual(['try:calc', 'try:unit', 'try:time', 'try:bang', 'try:sign-in']);
    expect(results[0]?.primary).toMatchObject({ fill: '12*(3+4)/2' });
  });
});

describe('signed in', () => {
  const o = opts();

  it('finds pages, but not the one you are on', () => {
    useNavStore.setState({ section: 'notes', sub: null });
    const ids = search('notes', o).results.map((r) => r.id);
    expect(ids).not.toContain('page:notes');
    expect(search('kanban', o).results[0]).toMatchObject({ id: 'page:kanban', kbd: ['G', 'K'] });
  });

  it('finds notes and tasks, highlights the title match, and opens them', async () => {
    const id = useNotesStore.getState().addNote({ title: 'Trip to Tokyo', body: 'ramen' });
    useKanbanStore.getState().addTask(useKanbanStore.getState().activeBoardId, 'todo', 'Book Tokyo flights');
    const { results } = search('tokyo', o);
    const note = find(results, `note:${id}`);
    expect(note).toMatchObject({ group: 'notes', title: 'Trip to Tokyo', matches: [8, 9, 10, 11, 12] });
    expect(results.some((r) => r.group === 'tasks' && r.title === 'Book Tokyo flights')).toBe(true);
    await note?.primary.run();
    expect(useNavStore.getState().section).toBe('notes');
    expect(useNotesStore.getState().selectedId).toBe(id);
  });

  it('can mark a task done from the action panel', () => {
    const board = useKanbanStore.getState().activeBoardId;
    const tid = useKanbanStore.getState().addTask(board, 'todo', 'Ship it');
    const row = find(search('ship', o).results, `task:${tid}`);
    void row?.actions?.find((a) => a.id === 'done')?.run();
    expect(useKanbanStore.getState().tasks.find((t) => t.id === tid)?.columnId).toBe('done');
  });

  it('only searches tools when something is typed', () => {
    expect(search('', o).results.some((r) => r.group === 'tools')).toBe(false);
    expect(search('qr', o).results.find((r) => r.group === 'tools')?.title).toBe('QR code');
  });

  it('empty palette: pages and actions in browsing order, plus your latest notes', () => {
    useNotesStore.getState().addNote({ title: 'Latest idea' });
    const v = search('', o);
    expect(v.sections.map((s) => s.id)).toEqual(['pages', 'actions', 'notes']);
    expect(v.results.map((r) => r.id)).toContain('action:new-note');
  });

  it('a pinned tool or note shows up in an empty box', () => {
    const v = search('', o, { pinned: ['tool:qr'] });
    expect(v.results.map((r) => r.id)).toContain('pinned:tool:qr');
    const home = search('', opts({ surface: 'home' }), { pinned: ['page:kanban'] });
    expect(home.sections.map((s) => s.id)).toEqual(['pinned', 'suggestions']);
  });

  it('suggestions on an empty Home box are capture shortcuts', () => {
    expect(search('', opts({ surface: 'home' })).results.map((r) => r.primary.fill)).toEqual(['note: ', 'task: ', 'timer 25']);
  });
});

describe('quick capture', () => {
  const o = opts();

  it('"note: …" is the default action; plain "note …" is an Action row below it', () => {
    expect(search('note: buy milk', o).results[0]).toMatchObject({ id: 'intent:note', group: 'top', title: 'Create note “buy milk”' });
    // On Home the literal web search stays the default, so searching "note taking apps" can never create a note by accident…
    const home = search('note buy milk', opts({ surface: 'home' }));
    expect(home.results.find((r) => r.id === 'intent:note')).toMatchObject({ group: 'actions' });
    expect(home.results[0]?.id).toBe('web-search');
    // …while in the command palette the create-note command is the first result.
    expect(search('note buy milk', o).results[0]).toMatchObject({ id: 'intent:note', group: 'actions' });
  });

  it('creates a note (title from the text, long text goes to the body) and offers to open it', async () => {
    await search('note: buy milk', o).results[0]?.primary.run();
    expect(useNotesStore.getState().notes[0]).toMatchObject({ title: 'buy milk', body: '' });
    expect(toast.notify.action).toHaveBeenCalledWith('Note saved', 'Open', expect.any(Function), 'buy milk');
    const long = 'a'.repeat(100);
    await search(`note: ${long}`, o).results[0]?.primary.run();
    expect(useNotesStore.getState().notes[0]?.title).toBe(`${'a'.repeat(60)}…`);
    expect(useNotesStore.getState().notes[0]?.body).toBe(long);
  });

  it('"create and open" also navigates', async () => {
    const row = search('note: buy milk', o).results[0];
    await row?.actions?.find((a) => a.hotkey === 'mod+enter')?.run();
    expect(useNavStore.getState().section).toBe('notes');
    expect(useNotesStore.getState().notes).toHaveLength(1);
  });

  it('adds a task to the active board, in To do', async () => {
    const before = useKanbanStore.getState().tasks.length;
    await search('task: fix the login redirect', o).results[0]?.primary.run();
    const t = useKanbanStore.getState().tasks.at(-1);
    expect(useKanbanStore.getState().tasks).toHaveLength(before + 1);
    expect(t).toMatchObject({ title: 'fix the login redirect', columnId: 'todo', boardId: useKanbanStore.getState().activeBoardId });
  });

  it('starts the focus timer for the typed length', async () => {
    const card = search('timer 45', o).results[0];
    expect(card).toMatchObject({ id: 'answer', group: 'answer', title: '45 min' });
    expect(card?.answer).toMatchObject({ kind: 'intent', cta: 'Start timer' });
    await card?.primary.run();
    const t = useTimerStore.getState();
    expect(t.status).toBe('running');
    expect(t.phase).toBe('focus');
    expect(t.durations.focus).toBe(45);
    expect(Math.round(((t.endsAt ?? 0) - Date.now()) / 60_000)).toBe(45);
    // asking again says it will replace the running one
    expect(search('timer 10', o).results[0]?.answer?.caption).toBe('Replaces the timer that is running now');
    await search('timer 10', o).results[0]?.primary.run();
    expect(useTimerStore.getState().durations.focus).toBe(10);
    expect(Math.round(((useTimerStore.getState().endsAt ?? 0) - Date.now()) / 60_000)).toBe(10);
  });
});

describe('Home shortcuts and history', () => {
  const home = opts({
    surface: 'home',
    links: [
      { id: 'a', title: 'GitHub', url: 'https://github.com/' },
      { id: 'b', title: 'GitHub Gist', url: 'https://github.com/gist' },
    ],
  });

  it('lists matching shortcuts once per site, with the title highlighted and a completion', () => {
    const rows = search('gith', home).results.filter((r) => r.group === 'shortcuts');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'site:github.com', title: 'GitHub', matches: [0, 1, 2, 3], completion: { text: 'GitHub' } });
  });

  it('recent searches: shown when empty, prefix-matched when typing, removable', () => {
    const removeRecent = vi.fn();
    const o = opts({ surface: 'home', recent: ['how to sourdough', 'react 19'], removeRecent });
    expect(search('', o).results.map((r) => r.title)).toEqual(['how to sourdough', 'react 19', 'Capture a note', 'Add a task', 'Start a timer']);
    const typed = search('how', o).results.find((r) => r.group === 'recent');
    expect(typed?.title).toBe('how to sourdough');
    typed?.removable?.();
    expect(removeRecent).toHaveBeenCalledWith('how to sourdough');
    expect(search('how', o).ghost?.text).toBe('how to sourdough');
  });

  it('the Home box shows a section action to clear history only through engine options', () => {
    const o = opts({ surface: 'home', recent: ['x'] });
    const clear = { label: 'Clear', run: vi.fn() };
    const v = runOmnibox('', ctx(o), buildProviders(o), emptyUsage(), { sectionActions: { recent: clear } });
    expect(v.sections[0]?.headerAction).toBe(clear);
  });
});
