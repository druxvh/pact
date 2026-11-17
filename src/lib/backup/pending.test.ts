import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyPlan: vi.fn(),
  loadSnapshot: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/lib/backup/apply', () => ({ applyPlan: mocks.applyPlan }));
vi.mock('@/lib/backup/snapshots', async (orig) => ({ ...(await orig<typeof import('@/lib/backup/snapshots')>()), loadSnapshot: mocks.loadSnapshot }));
vi.mock('@/lib/toast', () => ({ notify: { error: mocks.error, success: mocks.success, info: vi.fn() } }));

import { buildPlan, closeImportPreview, confirmImport, startImportFromFile, startRestoreSnapshot, useImportPreview } from './pending';

const env = (state: unknown, version: number) => JSON.stringify({ state, version });
const file = (body: unknown, name = 'backup.json') => new File([typeof body === 'string' ? body : JSON.stringify(body)], name, { type: 'application/json' });
const NOW = '2026-11-17T12:00:00.000Z';
const note = (id: string, body: string) => ({
  id,
  notebookId: 'nb',
  number: 1,
  title: id,
  body,
  pinned: false,
  assigneeId: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const validBackup = {
  app: 'pact',
  version: 1,
  exportedAt: NOW,
  data: {
    'pact-notes': env({ notebooks: [{ id: 'nb', name: 'N', memberIds: [], nextNumber: 2, createdAt: NOW }], notes: [note('a', 'from the file')] }, 3),
    'pact-theme': env({ mode: 'light' }, 2),
  },
};

describe('importing a file', () => {
  beforeEach(() => {
    closeImportPreview();
    mocks.applyPlan.mockReset().mockResolvedValue({ ok: true });
    mocks.loadSnapshot.mockReset();
    mocks.error.mockReset();
    mocks.success.mockReset();
    localStorage.setItem('pact-notes', env({ notebooks: [], notes: [note('mine', 'on this device')] }, 3));
  });

  it('shows a preview and applies NOTHING until it is confirmed', async () => {
    const before = localStorage.getItem('pact-notes');
    await startImportFromFile(file(validBackup));
    const { pending } = useImportPreview.getState();
    expect(pending?.source).toMatchObject({ kind: 'file', name: 'backup.json', fileVersion: 1 });
    expect(pending?.prepared.areas.map((a) => a.spec.key).sort()).toEqual(['pact-notes', 'pact-theme']);
    expect(localStorage.getItem('pact-notes')).toBe(before);
    expect(localStorage.getItem('pact-theme')).toBeNull();
    expect(mocks.applyPlan).not.toHaveBeenCalled();
    // …and the dialog can show both modes' consequences up front
    const merge = buildPlan(pending as NonNullable<typeof pending>, 'merge');
    const replace = buildPlan(pending as NonNullable<typeof pending>, 'replace');
    expect(merge.areas.find((a) => a.id === 'notes')?.lines[0]).toMatch(/1 new .* 1 only on this device/);
    expect(replace.areas.find((a) => a.id === 'notes')?.lines[0]).toMatch(/1 new .* would be removed/);
  });

  it('rejects garbage with a clear message and opens no preview', async () => {
    for (const bad of [
      'not json',
      '{"app":"other"}',
      { app: 'pact', version: 7, data: {} },
      { app: 'pact', version: 1, data: {} },
      { app: 'pact', version: 1, data: { 'pact-notes': '{"state":5}' } },
    ]) {
      mocks.error.mockClear();
      await startImportFromFile(file(bad));
      expect(useImportPreview.getState().pending).toBeNull();
      expect(mocks.error).toHaveBeenCalledOnce();
      expect(String(mocks.error.mock.calls[0]?.[1])).not.toBe('undefined');
    }
    expect(mocks.applyPlan).not.toHaveBeenCalled();
  });

  it('confirming applies the plan for the chosen mode, with a safety-copy label, and nothing else', async () => {
    await startImportFromFile(file(validBackup));
    await confirmImport('replace');
    expect(mocks.applyPlan).toHaveBeenCalledOnce();
    const [plan, opts] = mocks.applyPlan.mock.calls[0] ?? [];
    expect(plan.mode).toBe('replace');
    expect(Object.keys(plan.writes).sort()).toEqual(['pact-notes', 'pact-theme']);
    expect(opts.snapshotLabel).toMatch(/Before importing/);
    expect(mocks.success).toHaveBeenCalled();
  });

  it('a failed apply re-enables the dialog and reports why', async () => {
    mocks.applyPlan.mockResolvedValue({ ok: false, error: 'There wasn’t enough room' });
    await startImportFromFile(file(validBackup));
    await confirmImport('merge');
    expect(useImportPreview.getState().busy).toBe(false);
    expect(useImportPreview.getState().pending).not.toBeNull();
    expect(mocks.error).toHaveBeenCalledWith('Nothing was changed', 'There wasn’t enough room');
  });

  it('a second confirm while one is running is ignored', async () => {
    let finish: (v: { ok: true }) => void = () => {};
    mocks.applyPlan.mockReturnValue(new Promise((r) => (finish = r)));
    await startImportFromFile(file(validBackup));
    const first = confirmImport('merge');
    await confirmImport('merge');
    expect(mocks.applyPlan).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await first;
  });

  it('confirming with nothing pending does nothing', async () => {
    await confirmImport('merge');
    expect(mocks.applyPlan).not.toHaveBeenCalled();
  });
});

describe('restoring a snapshot goes through the same preview', () => {
  beforeEach(() => {
    closeImportPreview();
    mocks.error.mockReset();
  });
  const meta = {
    id: 's1',
    createdAt: NOW,
    kind: 'manual',
    label: 'Manual snapshot',
    hash: 'h',
    bytes: 10,
    appVersion: '1',
    account: null,
    counts: {},
    hasWallpaper: false,
  } as const;

  it('opens the preview for the snapshot and applies nothing', async () => {
    mocks.loadSnapshot.mockResolvedValue({ ...meta, data: validBackup.data, wallpaper: null });
    await startRestoreSnapshot(meta);
    expect(useImportPreview.getState().pending?.source).toMatchObject({ kind: 'snapshot' });
    expect(mocks.applyPlan).not.toHaveBeenCalled();
  });

  it('says so when the snapshot has gone', async () => {
    mocks.loadSnapshot.mockResolvedValue(undefined);
    await startRestoreSnapshot(meta);
    expect(useImportPreview.getState().pending).toBeNull();
    expect(mocks.error).toHaveBeenCalled();
  });
});
