import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDraft } from '@/features/commands/model';
import { COMMANDS_KEY, useCommandsStore } from '@/features/commands/store';
import { findBang, getCustomBangs, parseBang } from '@/lib/omnibox/bangs';
import { useOmniStore } from '@/lib/omnibox/store';

const link = (over = {}) => ({ ...emptyDraft('quicklink'), name: 'Repos', alias: 'repo', url: 'https://github.com/search?q={query}', ...over });
const snip = (over = {}) => ({ ...emptyDraft('snippet'), name: 'Sig', alias: 'sig', text: 'Best,\nMe', ...over });
const items = () => useCommandsStore.getState().items;
const stored = () => JSON.parse(localStorage.getItem(COMMANDS_KEY) ?? 'null') as { state: { items: unknown[] }; version: number } | null;

beforeEach(() => {
  useCommandsStore.getState().clear();
  useOmniStore.getState().clear();
});

describe('commands store', () => {
  it('adds, edits and removes — and persists as pact-commands, versioned', () => {
    const r = useCommandsStore.getState().add(link());
    expect(r.ok).toBe(true);
    expect(items()).toHaveLength(1);
    expect(stored()?.version).toBe(1);
    expect(stored()?.state.items).toHaveLength(1);

    const id = items()[0]?.id ?? '';
    const u = useCommandsStore.getState().update(id, link({ name: 'Renamed' }));
    expect(u.ok).toBe(true);
    expect(items()[0]).toMatchObject({ id, name: 'Renamed' });

    expect(useCommandsStore.getState().remove(id)?.name).toBe('Renamed');
    expect(items()).toEqual([]);
    expect(useCommandsStore.getState().remove(id)).toBeUndefined();
  });

  it('refuses a clash without changing anything, and says why', () => {
    useCommandsStore.getState().add(link());
    const r = useCommandsStore.getState().add(snip({ alias: 'repo' }));
    expect(r).toMatchObject({ ok: false, errors: { alias: expect.stringContaining('already used') } });
    expect(useCommandsStore.getState().add(link({ name: 'GH', alias: 'gh' }))).toMatchObject({
      ok: false,
      errors: { alias: expect.stringContaining('built-in') },
    });
    expect(items()).toHaveLength(1);
    expect(useCommandsStore.getState().update('missing', link())).toMatchObject({ ok: false });
  });

  it('duplicate gives a copy with its own alias; restore (undo) puts a deletion back where it was', () => {
    useCommandsStore.getState().add(link());
    useCommandsStore.getState().add(snip());
    const first = items()[0];
    expect(useCommandsStore.getState().duplicate(first?.id ?? '').ok).toBe(true);
    expect(items().map((c) => [c.name, c.alias])).toEqual([
      ['Repos', 'repo'],
      ['Sig', 'sig'],
      ['Repos (copy)', 'repo-2'],
    ]);
    const gone = useCommandsStore.getState().remove(first?.id ?? '');
    expect(items()[0]?.name).toBe('Sig');
    if (gone) useCommandsStore.getState().restore(gone, 0);
    expect(items()[0]?.name).toBe('Repos');
    if (gone) useCommandsStore.getState().restore(gone, 0); // idempotent
    expect(items()).toHaveLength(3);
  });

  it('removing a command forgets what the omnibox remembered about it', () => {
    useCommandsStore.getState().add(link());
    const id = items()[0]?.id ?? '';
    useOmniStore.getState().record(`ql:${id}`);
    useOmniStore.getState().togglePin(`ql:${id}`);
    useCommandsStore.getState().remove(id);
    expect(useOmniStore.getState().entries[`ql:${id}`]).toBeUndefined();
    expect(useOmniStore.getState().pinned).not.toContain(`ql:${id}`);
  });

  it('import adds new ones and reports the rest', () => {
    useCommandsStore.getState().add(link());
    const dup = {
      id: 'x',
      kind: 'quicklink',
      name: 'Repos',
      alias: '',
      url: 'https://github.com/search?q={query}',
      icon: '',
      createdAt: '',
      updatedAt: '',
    } as const;
    const fresh = { ...dup, id: 'y', name: 'Fresh', url: 'https://fresh.example/' };
    const report = useCommandsStore.getState().importItems([dup, fresh] as never, 1);
    expect(report).toMatchObject({ added: 1, duplicates: 1, invalid: 1 });
    expect(items().map((c) => c.name)).toEqual(['Repos', 'Fresh']);
  });
});

describe('loading from storage', () => {
  it('cleans whatever is in localStorage: bad addresses and clashing aliases never get into play', async () => {
    localStorage.setItem(
      COMMANDS_KEY,
      JSON.stringify({
        version: 1,
        state: {
          items: [
            {
              id: 'a',
              kind: 'quicklink',
              name: 'Ok',
              alias: 'ok',
              url: 'https://example.com/{query}',
              icon: '',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            { id: 'b', kind: 'quicklink', name: 'Evil', alias: 'evil', url: 'javascript:alert(1)', icon: '' },
            { id: 'c', kind: 'quicklink', name: 'Clash', alias: 'ok', url: 'https://clash.example/', icon: '' },
          ],
        },
      }),
    );
    await useCommandsStore.persist.rehydrate();
    expect(items().map((c) => [c.id, c.alias])).toEqual([
      ['a', 'ok'],
      ['c', ''],
    ]);
  });

  it('upgrades an older version through migrate', async () => {
    localStorage.setItem(COMMANDS_KEY, JSON.stringify({ version: 0, state: { snippets: [{ id: 's', name: 'S', alias: 'sig', text: 'hi' }] } }));
    await useCommandsStore.persist.rehydrate();
    expect(items()).toMatchObject([{ id: 's', kind: 'snippet', alias: 'sig' }]);
  });

  it('survives corrupt storage', async () => {
    localStorage.setItem(COMMANDS_KEY, '{not json');
    await useCommandsStore.persist.rehydrate();
    expect(items()).toEqual([]);
  });

  it('another tab’s change arrives through the storage event', async () => {
    const stateWith = JSON.stringify({
      version: 1,
      state: {
        items: [
          { id: 'z', kind: 'snippet', name: 'From tab B', alias: '', text: 'x', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    });
    localStorage.setItem(COMMANDS_KEY, stateWith);
    window.dispatchEvent(new StorageEvent('storage', { key: COMMANDS_KEY, newValue: stateWith, storageArea: window.localStorage }));
    await new Promise((r) => setTimeout(r, 0));
    expect(items().map((c) => c.name)).toEqual(['From tab B']);
  });
});

describe('the bang table follows the store', () => {
  it('a quicklink with {query} and an alias becomes a chip-able bang, and is gone when deleted', () => {
    useCommandsStore.getState().add(link());
    expect(getCustomBangs().map((b) => b.triggers[0])).toEqual(['repo']);
    expect(findBang('repo')?.custom).toBe(true);
    expect(parseBang('!repo react')).toMatchObject({ rest: 'react', bang: { name: 'Repos' } });
    useCommandsStore.getState().remove(items()[0]?.id ?? '');
    expect(findBang('repo')).toBeUndefined();
  });

  it('links without {query} or an alias are not bangs; built-in triggers always win', () => {
    useCommandsStore.getState().add(link({ name: 'Docs', alias: 'docs', url: 'https://docs.example.com/' }));
    useCommandsStore.getState().add(link({ name: 'Nameless', alias: '' }));
    expect(getCustomBangs()).toEqual([]);
    expect(findBang('gh')?.id).toBe('github');
  });
});
