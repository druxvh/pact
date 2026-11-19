import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProviders, type SourceOptions, staticActions } from '@/app/paletteSources';
import { aliasIndex, emptyDraft } from '@/features/commands/model';
import { useCommandsStore } from '@/features/commands/store';
import { ACTION_TARGETS, aliasTargets } from '@/features/commands/targets';
import { useCommandsUi } from '@/features/commands/ui';
import { chipFor } from '@/lib/omnibox/bangs';
import { type EngineOptions, runOmnibox } from '@/lib/omnibox/engine';
import { emptyUsage } from '@/lib/omnibox/frecency';
import { scopeProvider } from '@/lib/omnibox/providers';
import type { OmniCtx, OmniResult } from '@/lib/omnibox/types';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';

const ext = vi.hoisted(() => ({ openUrl: vi.fn(), webSearch: vi.fn(async () => {}), pactUrl: (h = '') => `chrome-extension://x/newtab.html${h}` }));
const clip = vi.hoisted(() => ({ copyText: vi.fn(async () => true) }));
const toast = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn(), undo: vi.fn() } }));
vi.mock('@/lib/ext', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/ext')>()), ...ext }));
vi.mock('@/lib/clipboard', () => clip);
vi.mock('@/lib/toast', () => toast);

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

/** The omnibox exactly as the app runs it: every provider, the user's aliases handed to the engine. */
const search = (q: string, o: SourceOptions = opts(), c: Partial<OmniCtx> = {}) => {
  const engine: EngineOptions = { recentFromUsage: o.surface === 'palette', aliases: aliasIndex(useCommandsStore.getState().items) };
  const cx = ctx(o, c);
  const providers = cx.scope ? [scopeProvider({ recordSearch: o.recordSearch })] : buildProviders(o);
  return runOmnibox(q, cx, providers, { ...emptyUsage(), pinned: [...(c.pinned ?? [])] }, engine);
};
const ids = (q: string, o?: SourceOptions) => search(q, o).results.map((r) => r.id);
const find = (rs: OmniResult[], id: string) => rs.find((r) => r.id === id);
const add = (d: Partial<ReturnType<typeof emptyDraft>> & { kind: 'quicklink' | 'snippet' | 'alias' }) => {
  const r = useCommandsStore.getState().add({ ...emptyDraft(d.kind), ...d });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.item;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useCommandsStore.getState().clear();
  setUser(true);
  useNavStore.setState({ section: 'home', sub: null });
  useUiStore.setState({ cameraOpen: false, paletteOpen: false });
  useCommandsUi.getState().close();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn(async () => 'from clipboard') } });
});

describe('quicklinks in the omnibox', () => {
  it('finds one by name, shows its alias on the row, and Enter opens it', () => {
    add({ kind: 'quicklink', name: 'Work wiki', alias: 'kb', url: 'https://wiki.example.com/home' });
    const v = search('work');
    const row = find(v.results, v.results[0]?.id ?? '');
    expect(row).toMatchObject({ title: 'Work wiki', group: 'commands', hint: 'kb', subtitle: 'wiki.example.com/home' });
    void row?.primary.run();
    expect(ext.openUrl).toHaveBeenCalledWith('https://wiki.example.com/home');
  });

  it('typing the alias in full makes it the Top hit', () => {
    const q = add({ kind: 'quicklink', name: 'Work wiki', alias: 'kb', url: 'https://wiki.example.com/' });
    const v = search('kb');
    expect(v.sections[0]).toMatchObject({ id: 'top' });
    expect(v.results[0]).toMatchObject({ id: `ql:${q.id}`, hint: 'kb' });
  });

  it('`alias text` and `!alias text` search the site with the text URL-encoded', () => {
    add({ kind: 'quicklink', name: 'Repos', alias: 'repo', url: 'https://github.com/search?q={query}&type=repositories' });
    for (const typed of ['repo react & vue', '!repo react & vue']) {
      const v = search(typed);
      expect(v.results[0], typed).toMatchObject({ id: 'top-bang', title: 'Open Repos with “react & vue”' });
      void v.results[0]?.primary.run();
      expect(ext.openUrl).toHaveBeenLastCalledWith('https://github.com/search?q=react%20%26%20vue&type=repositories');
    }
    // and never twice
    expect(ids('repo react').filter((i) => i.includes('top-bang') || i.startsWith('ql:'))).toEqual(['top-bang']);
  });

  it('a bare alias opens the site’s home when there is nothing to search for', () => {
    const q = add({ kind: 'quicklink', name: 'Repos', alias: 'repo', url: 'https://github.com/search?q={query}' });
    void find(search('repo').results, `ql:${q.id}`)?.primary.run();
    expect(ext.openUrl).toHaveBeenCalledWith('https://github.com/');
  });

  it('Tab: alias → chip, partial alias → ghost completion that becomes a chip, text after alias → chip with the text', () => {
    const q = add({ kind: 'quicklink', name: 'Repos', alias: 'repo', url: 'https://github.com/search?q={query}' });
    expect(chipFor('repo')).toMatchObject({ bang: { id: `ql:${q.id}`, custom: true }, rest: '' });
    expect(chipFor('!repo')).toMatchObject({ rest: '' });
    expect(chipFor('repo react hooks')).toMatchObject({ rest: 'react hooks' });
    expect(search('re').ghost).toEqual({ text: 'repo', resultId: `ql:${q.id}`, scope: `ql:${q.id}` });
    // a built-in trigger keeps its meaning: `gh react` is a plain search unless the user owns "gh" (they can't)
    expect(chipFor('gh react')).toBeNull();
  });

  it('inside the chip only that quicklink is searched, and Enter opens the encoded address', () => {
    const q = add({ kind: 'quicklink', name: 'Repos', alias: 'repo', url: 'https://github.com/search?q={query}' });
    const v = search('react', opts(), { scope: `ql:${q.id}` });
    expect(v.results.map((r) => r.id)).toEqual(['top-bang']);
    void v.results[0]?.primary.run();
    expect(ext.openUrl).toHaveBeenCalledWith('https://github.com/search?q=react');
  });

  it('a link without {query} is a plain link: `!alias` finds it, and there is no chip', () => {
    const q = add({ kind: 'quicklink', name: 'Docs', alias: 'docs', url: 'https://docs.example.com/' });
    expect(chipFor('docs')).toBeNull();
    expect(search('!docs').results[0]).toMatchObject({ id: `ql:${q.id}`, group: 'top' });
    expect(search('docs').results[0]).toMatchObject({ id: `ql:${q.id}`, group: 'top' });
  });

  it('{clipboard} reads the clipboard on Enter; when that is refused it still opens, empty, and says so', async () => {
    const q = add({ kind: 'quicklink', name: 'Search copied', alias: 'sc', url: 'https://www.google.com/search?q={clipboard}' });
    await find(search('sc').results, `ql:${q.id}`)?.primary.run();
    await vi.waitFor(() => expect(ext.openUrl).toHaveBeenCalledWith('https://www.google.com/search?q=from%20clipboard'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    await find(search('sc').results, `ql:${q.id}`)?.primary.run();
    await vi.waitFor(() => expect(ext.openUrl).toHaveBeenLastCalledWith('https://www.google.com/search?q='));
    expect(toast.notify.error).toHaveBeenCalledWith('Couldn’t read the clipboard', expect.any(String));
  });

  it('never opens anything that is not http(s), even if a bad address got into storage', () => {
    const q = add({ kind: 'quicklink', name: 'Fine', alias: 'fine', url: 'https://ok.example/' });
    useCommandsStore.setState({ items: [{ ...q, url: 'javascript:alert(1)' } as never] });
    void find(search('fine').results, `ql:${q.id}`)?.primary.run();
    expect(ext.openUrl).not.toHaveBeenCalled();
    expect(toast.notify.error).toHaveBeenCalled();
  });

  it('the action panel offers new tab, copy link and Edit (which opens the edit dialog)', () => {
    const q = add({ kind: 'quicklink', name: 'Docs', alias: 'docs', url: 'https://docs.example.com/' });
    const row = find(search('docs').results, `ql:${q.id}`);
    expect(row?.actions?.map((a) => a.id)).toEqual(['open-new-tab', 'copy-link', 'edit']);
    void row?.actions?.find((a) => a.id === 'open-new-tab')?.run();
    expect(ext.openUrl).toHaveBeenCalledWith('https://docs.example.com/', { newTab: true });
    void row?.actions?.find((a) => a.id === 'edit')?.run();
    expect(useCommandsUi.getState().dialog).toEqual({ type: 'edit', id: q.id });
  });

  it('an emoji or glyph icon replaces the favicon; the default is the site’s', () => {
    const a = add({ kind: 'quicklink', name: 'Tea', alias: 'tea', url: 'https://tea.example/', icon: 'emoji:🍵' });
    const b = add({ kind: 'quicklink', name: 'Rocket', alias: 'rkt', url: 'https://rocket.example/', icon: 'icon:rocket' });
    const c = add({ kind: 'quicklink', name: 'Plain', alias: 'pln', url: 'https://plain.example/x' });
    const rows = search('', opts()).results;
    expect(find(rows, `ql:${a.id}`)).toMatchObject({ emoji: '🍵', site: undefined });
    expect(find(rows, `ql:${b.id}`)?.site).toBeUndefined();
    expect(find(rows, `ql:${c.id}`)?.site).toEqual({ url: 'https://plain.example/', title: 'Plain' });
  });

  it('works for guests, and the empty palette lists them while empty Home lists only pinned ones', () => {
    setUser(false);
    const q = add({ kind: 'quicklink', name: 'Docs', alias: 'docs', url: 'https://docs.example.com/' });
    expect(ids('docs', opts({ signedIn: false }))).toContain(`ql:${q.id}`);
    expect(ids('', opts({ signedIn: false }))).toContain(`ql:${q.id}`);
    expect(ids('', opts({ signedIn: false, surface: 'home' }))).not.toContain(`ql:${q.id}`);
    expect(search('', opts({ signedIn: false, surface: 'home' }), { pinned: [`ql:${q.id}`] }).results.map((r) => r.id)).toContain(`pinned:ql:${q.id}`);
  });
});

describe('snippets in the omnibox', () => {
  it('shows a one-line preview, and Enter copies the expanded text', async () => {
    const s = add({ kind: 'snippet', name: 'Sign-off', alias: 'sig', text: 'Thanks!\n\n— Ada, {date}' });
    const row = find(search('sig').results, `sn:${s.id}`);
    expect(row).toMatchObject({ title: 'Sign-off', subtitle: 'Thanks! — Ada, Nov 17, 2026', hint: 'sig', group: 'top' });
    expect(row?.primary).toMatchObject({ id: 'copy', label: 'Copy snippet' });
    await row?.primary.run();
    expect(clip.copyText).toHaveBeenCalledWith(
      expect.stringMatching(/^Thanks!\n\n— Ada, [A-Z][a-z]{2} \d{1,2}, \d{4}$/),
      'Copied “Sign-off” — paste it anywhere',
    );
  });

  it('fills {clipboard} from the clipboard', async () => {
    const s = add({ kind: 'snippet', name: 'Quote', alias: 'qt', text: '> {clipboard}' });
    await find(search('qt').results, `sn:${s.id}`)?.primary.run();
    expect(clip.copyText).toHaveBeenCalledWith('> from clipboard', expect.any(String));
  });

  it('the secondary action copies the text exactly as typed', async () => {
    const s = add({ kind: 'snippet', name: 'Quote', alias: 'qt', text: '{date} {x}' });
    const row = find(search('qt').results, `sn:${s.id}`);
    await row?.actions?.find((a) => a.id === 'copy-raw')?.run();
    expect(clip.copyText).toHaveBeenCalledWith('{date} {x}', expect.any(String));
  });
});

describe('aliases for pages, tools and actions', () => {
  it('typing an alias ranks that item first, even when the text would never match it', () => {
    add({ kind: 'alias', name: 'Focus', alias: 'zz', target: 'page:timer' });
    const v = search('zz');
    expect(v.results[0]).toMatchObject({ id: 'page:timer', group: 'top', hint: 'zz' });
    void v.results[0]?.primary.run();
    expect(useNavStore.getState().section).toBe('timer');
  });

  it('works for tools and actions too', () => {
    add({ kind: 'alias', name: 'Split PDF', alias: 'pdf', target: 'tool:pdf-split' });
    add({ kind: 'alias', name: 'Theme', alias: 'dark', target: 'action:theme' });
    expect(search('pdf').results[0]).toMatchObject({ id: 'tool:pdf-split', hint: 'pdf' });
    expect(search('dark').results[0]).toMatchObject({ id: 'action:theme', hint: 'dark' });
  });

  it('shows the alias on the row whenever the item appears, not only when it is typed', () => {
    add({ kind: 'alias', name: 'Focus', alias: 'zz', target: 'page:timer' });
    expect(find(search('focus').results, 'page:timer')?.hint).toBe('zz');
    expect(find(search('').results, 'page:timer')?.hint).toBe('zz');
  });

  it('a partly typed alias does not hijack the ranking', () => {
    add({ kind: 'alias', name: 'Focus', alias: 'zzz', target: 'page:timer' });
    expect(ids('zz')).not.toContain('page:timer');
  });

  it('every action target is a real palette action (the two lists cannot drift)', () => {
    const real = new Set(staticActions().map((a) => `action:${a.id}`));
    for (const t of ACTION_TARGETS) expect(real.has(t.id), t.id).toBe(true);
    for (const id of real)
      expect(
        ACTION_TARGETS.map((t) => t.id),
        id,
      ).toContain(id);
    expect(aliasTargets().filter((t) => t.group === 'Pages').length).toBeGreaterThanOrEqual(8);
  });
});

describe('creating and managing from the omnibox', () => {
  it.each([
    ['create quicklink', 'action:create-quicklink', { type: 'create', kind: 'quicklink' }],
    ['create snippet', 'action:create-snippet', { type: 'create', kind: 'snippet' }],
    ['create alias', 'action:create-alias', { type: 'create', kind: 'alias' }],
    ['manage commands', 'action:manage-commands', { type: 'manage' }],
  ] as const)('“%s” opens its dialog, for guests too', (q, id, dialog) => {
    setUser(false);
    const row = find(search(q, opts({ signedIn: false })).results, id);
    expect(row, id).toBeDefined();
    void row?.primary.run();
    expect(useCommandsUi.getState().dialog).toMatchObject(dialog);
  });
});

describe('the camera command', () => {
  it.each(['cam', '!cam', 'camera', 'selfie', 'CAM', ' cam '])('“%s” offers Open camera first, with its hint, and opens the studio', (q) => {
    for (const signedIn of [true, false]) {
      setUser(signedIn);
      useUiStore.setState({ cameraOpen: false });
      const v = search(q, opts({ signedIn, surface: signedIn ? 'palette' : 'home' }));
      expect(v.results[0], `${q} signedIn=${signedIn}`).toMatchObject({
        id: 'action:camera',
        group: 'top',
        title: 'Open camera',
        subtitle: 'Take a photo or record a video — on this device only',
      });
      void v.results[0]?.primary.run();
      expect(useUiStore.getState().cameraOpen).toBe(true);
    }
  });

  it('is also an ordinary palette action, found by what it does', () => {
    for (const q of ['photo', 'record video', 'webcam']) expect(ids(q), q).toContain('action:camera');
  });

  it('leaves words that merely contain it alone', () => {
    expect(search('campus').results[0]?.id).not.toBe('action:camera');
  });
});
