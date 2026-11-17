import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSnapshot: vi.fn(),
  putAsset: vi.fn(),
  deleteAsset: vi.fn(),
  haltNotesSync: vi.fn(),
  order: [] as string[],
}));
vi.mock('@/lib/backup/snapshots', () => ({ createSnapshot: mocks.createSnapshot }));
vi.mock('@/lib/assets', () => ({ putAsset: mocks.putAsset, deleteAsset: mocks.deleteAsset }));
vi.mock('@/features/notes/sync/engine', () => ({ haltNotesSync: mocks.haltNotesSync }));

import { SYNC_STATE_KEY } from '@/features/notes/sync/model';
import { BOOT_KEY } from '@/lib/appearance/apply';
import { persistenceFrozen, resetPersistenceForTests } from '@/lib/persist';
import { useAuthStore } from '@/store/useAuthStore';
import { applyPlan } from './apply';
import type { Plan } from './plan';

const plan = (over: Partial<Plan> = {}): Plan => ({
  mode: 'replace',
  writes: { 'pact-theme': '{"state":{"mode":"light"},"version":2}', 'pact-settings': '{"state":{"sounds":false},"version":1}' },
  wallpaper: { action: 'keep' },
  notes: null,
  areas: [],
  warnings: [],
  ...over,
});

describe('applyPlan', () => {
  const reload = vi.fn();
  beforeEach(() => {
    resetPersistenceForTests();
    mocks.createSnapshot.mockReset().mockImplementation(async () => {
      mocks.order.push('snapshot');
      return {};
    });
    mocks.putAsset.mockReset().mockResolvedValue(undefined);
    mocks.deleteAsset.mockReset().mockResolvedValue(undefined);
    mocks.haltNotesSync.mockReset().mockImplementation(() => mocks.order.push('halt'));
    mocks.order.length = 0;
    useAuthStore.setState({ status: 'guest', user: null });
    localStorage.setItem('pact-theme', '{"state":{"mode":"dark"},"version":2}');
    localStorage.setItem(BOOT_KEY, 'cached');
  });

  it('takes the safety copy FIRST, then stops sync and freezes persistence, then writes, then reloads', async () => {
    const r = await applyPlan(plan(), { snapshotLabel: 'Before restoring a snapshot', reload });
    expect(r).toEqual({ ok: true });
    expect(mocks.createSnapshot).toHaveBeenCalledWith({ kind: 'safety', label: 'Before restoring a snapshot' });
    expect(mocks.order).toEqual(['snapshot', 'halt']);
    expect(persistenceFrozen()).toBe(true);
    expect(localStorage.getItem('pact-theme')).toBe('{"state":{"mode":"light"},"version":2}');
    expect(localStorage.getItem('pact-settings')).toBe('{"state":{"sounds":false},"version":1}');
    expect(localStorage.getItem(BOOT_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('if the safety copy cannot be saved, NOTHING is changed', async () => {
    mocks.createSnapshot.mockRejectedValue(new Error('quota'));
    const r = await applyPlan(plan(), { snapshotLabel: 'x', reload });
    expect(r.ok).toBe(false);
    expect(localStorage.getItem('pact-theme')).toBe('{"state":{"mode":"dark"},"version":2}');
    expect(localStorage.getItem('pact-settings')).toBeNull();
    expect(persistenceFrozen()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a failure part-way (storage full) rolls every key back', async () => {
    const real = window.localStorage;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => real.getItem(k),
      removeItem: (k: string) => real.removeItem(k),
      setItem: (k: string, v: string) => {
        if (k === 'pact-settings') throw new Error('QuotaExceededError');
        real.setItem(k, v);
      },
    });
    const r = await applyPlan(plan(), { snapshotLabel: 'x', reload });
    vi.unstubAllGlobals();
    expect(r.ok).toBe(false);
    expect(localStorage.getItem('pact-theme')).toBe('{"state":{"mode":"dark"},"version":2}'); // restored
    expect(localStorage.getItem('pact-settings')).toBeNull();
    expect(reload).toHaveBeenCalledOnce(); // persistence is frozen now, so the page must reload to be usable
  });

  it('the wallpaper picture is stored before anything else changes, and a failure there changes nothing', async () => {
    const media = { blob: new Blob([new Uint8Array([1])], { type: 'image/webp' }), name: 'w' };
    mocks.putAsset.mockRejectedValue(new Error('idb'));
    const r = await applyPlan(plan({ wallpaper: { action: 'set', media } }), { snapshotLabel: 'x', reload });
    expect(r.ok).toBe(false);
    expect(localStorage.getItem('pact-settings')).toBeNull();
    expect(persistenceFrozen()).toBe(false);

    mocks.putAsset.mockResolvedValue(undefined);
    expect((await applyPlan(plan({ wallpaper: { action: 'set', media } }), { snapshotLabel: 'x', reload })).ok).toBe(true);
    expect(mocks.putAsset).toHaveBeenLastCalledWith('wallpaper-image', media.blob);
  });

  it('removes the stored picture when the plan says so', async () => {
    await applyPlan(plan({ wallpaper: { action: 'remove' } }), { snapshotLabel: 'x', reload });
    expect(mocks.deleteAsset).toHaveBeenCalledWith('wallpaper-image');
  });

  it('tells notes sync what the restore changed (so restored notes upload and removed ones are reported), but only when signed in', async () => {
    const nb = { id: 'nb1', name: 'n', memberIds: [], nextNumber: 3, createdAt: 'x' };
    const note = (id: string, body: string) => ({
      id,
      notebookId: 'nb1',
      number: 1,
      title: id,
      body,
      pinned: false,
      assigneeId: null,
      createdAt: 'x',
      updatedAt: 'x',
    });
    const notes = {
      prev: { notebooks: [nb], notes: [note('a', 'old'), note('gone', 'x')] },
      next: { notebooks: [nb], notes: [note('a', 'restored'), note('new', 'y')] },
    };

    await applyPlan(plan({ notes }), { snapshotLabel: 'x', reload });
    expect(localStorage.getItem(SYNC_STATE_KEY)).toBeNull(); // guest: nothing to sync

    useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: null, provider: null, name: null } });
    resetPersistenceForTests();
    await applyPlan(plan({ notes }), { snapshotLabel: 'x', reload });
    const st = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) as string);
    expect(Object.keys(st.dirtyNotes).sort()).toEqual(['a', 'new']);
    expect(Object.keys(st.goneNotes)).toEqual(['gone']);
    expect(st.owner).toBe('u1');
  });
});
