import { describe, expect, it } from 'vitest';
import { memorySnapshotDb } from './db';
import { describeCounts } from './describe';
import { parseBackupText } from './format';
import { createSnapshot, listSnapshots, planEviction, SNAPSHOT_LIMITS, shouldAutoSnapshot, snapshotBundle, snapshotFile } from './snapshots';
import type { Bundle, SnapshotKind, SnapshotMeta } from './types';

const day = (d: number, hour = 9) => new Date(2026, 10, d, hour, 0, 0);
let seq = 0;
const meta = (kind: SnapshotKind, when: Date, over: Partial<SnapshotMeta> = {}): SnapshotMeta => ({
  id: `s${++seq}`,
  createdAt: when.toISOString(),
  kind,
  label: kind,
  hash: `h${seq}`,
  bytes: 1000,
  appVersion: 't',
  account: null,
  counts: {},
  hasWallpaper: false,
  ...over,
});
const env = (state: unknown, version: number) => JSON.stringify({ state, version });
const bundle = (notes: number, when: Date, wallpaper: Bundle['wallpaper'] = null): Bundle => ({
  exportedAt: when.toISOString(),
  appVersion: '1.0.0',
  account: null,
  data: {
    'pact-notes': env({ notebooks: [], notes: Array.from({ length: notes }, (_, i) => ({ id: `n${i}` })) }, 3),
    'pact-theme': env({ mode: 'dark' }, 2),
  },
  wallpaper,
});

describe('planEviction', () => {
  it('keeps the last 7 automatic snapshots', () => {
    const metas = Array.from({ length: 10 }, (_, i) => meta('auto', day(1 + i)));
    const doomed = planEviction(metas);
    expect(doomed).toHaveLength(3);
    expect(doomed.sort()).toEqual(
      metas
        .slice(0, 3)
        .map((m) => m.id)
        .sort(),
    ); // the oldest three
  });

  it('manual snapshots are kept (up to their own cap) even when many automatic ones come and go', () => {
    const manual = Array.from({ length: 5 }, (_, i) => meta('manual', day(1 + i)));
    const autos = Array.from({ length: 12 }, (_, i) => meta('auto', day(10 + i)));
    const doomed = planEviction([...manual, ...autos]);
    for (const m of manual) expect(doomed).not.toContain(m.id);
    expect(doomed).toHaveLength(5);
    const lots = Array.from({ length: 15 }, (_, i) => meta('manual', day(1 + i)));
    expect(planEviction(lots)).toHaveLength(15 - SNAPSHOT_LIMITS.manual);
  });

  it('when total size or count runs out, automatic snapshots go first, then safety copies, then manual ones — oldest first', () => {
    const big = SNAPSHOT_LIMITS.totalBytes / 4 + 1;
    const manual = meta('manual', day(1), { bytes: big });
    const safety = meta('safety', day(2), { bytes: big });
    const auto1 = meta('auto', day(3), { bytes: big });
    const auto2 = meta('auto', day(4), { bytes: big });
    expect(planEviction([manual, safety, auto1, auto2])).toEqual([auto1.id]); // 4 × big > cap → drop the oldest auto
    expect(planEviction([manual, safety, auto2])).toEqual([]); // three fit
  });

  it('never evicts the snapshot that was just taken', () => {
    const fresh = meta('manual', day(20), { bytes: SNAPSHOT_LIMITS.totalBytes * 2 });
    const old = meta('auto', day(1));
    const doomed = planEviction([old, fresh], fresh.id);
    expect(doomed).toEqual([old.id]);
  });

  it('respects the total count', () => {
    const metas = [
      ...Array.from({ length: 7 }, (_, i) => meta('auto', day(1 + i))),
      ...Array.from({ length: 12 }, (_, i) => meta('manual', day(1 + i))),
      ...Array.from({ length: 6 }, (_, i) => meta('safety', day(1 + i))),
    ];
    expect(metas.length - planEviction(metas).length).toBeLessThanOrEqual(SNAPSHOT_LIMITS.totalCount);
  });
});

describe('shouldAutoSnapshot — at most once a day, only when something changed', () => {
  const base = { hash: 'new', hasContent: true };

  it('first ever: yes (if there is anything to save)', () => {
    expect(shouldAutoSnapshot({ ...base, now: day(10), metas: [] })).toBe(true);
    expect(shouldAutoSnapshot({ ...base, now: day(10), metas: [], hasContent: false })).toBe(false);
  });

  it('not twice in one calendar day', () => {
    expect(shouldAutoSnapshot({ ...base, now: day(10, 18), metas: [meta('auto', day(10, 8))] })).toBe(false);
    expect(shouldAutoSnapshot({ ...base, now: day(11, 8), metas: [meta('auto', day(10, 23))] })).toBe(true); // a new day, even an hour later
  });

  it('not when the data is identical to the newest snapshot of any kind', () => {
    expect(shouldAutoSnapshot({ ...base, now: day(11), metas: [meta('auto', day(10), { hash: 'new' })] })).toBe(false);
    expect(shouldAutoSnapshot({ ...base, now: day(11), metas: [meta('manual', day(10), { hash: 'new' })] })).toBe(false);
    expect(shouldAutoSnapshot({ ...base, now: day(11), metas: [meta('auto', day(10), { hash: 'old' })] })).toBe(true);
  });

  it('a manual snapshot today does not use up the day’s automatic one', () => {
    expect(shouldAutoSnapshot({ ...base, now: day(10, 18), metas: [meta('manual', day(10, 8), { hash: 'old' })] })).toBe(true);
  });
});

describe('createSnapshot', () => {
  it('stores the data, counts and size; identical data is never stored twice', async () => {
    const db = memorySnapshotDb();
    const first = await createSnapshot({ kind: 'manual', db, bundle: bundle(3, day(10)) });
    expect(first).toMatchObject({ kind: 'manual', hasWallpaper: false, appVersion: '1.0.0', counts: { 'pact-notes.notes': 3 } });
    expect(first?.bytes).toBeGreaterThan(0);
    expect(await createSnapshot({ kind: 'manual', db, bundle: bundle(3, day(11)) })).toBeNull(); // nothing changed
    expect(await createSnapshot({ kind: 'manual', db, bundle: bundle(4, day(11)) })).not.toBeNull();
    expect(await listSnapshots(db)).toHaveLength(2);
  });

  it('safety copies are always taken — even if nothing changed — so a restore can always be undone', async () => {
    const db = memorySnapshotDb();
    await createSnapshot({ kind: 'manual', db, bundle: bundle(3, day(10)) });
    expect(await createSnapshot({ kind: 'safety', label: 'Before restoring a snapshot', db, bundle: bundle(3, day(10)) })).toMatchObject({
      kind: 'safety',
      label: 'Before restoring a snapshot',
    });
  });

  it('automatic: once a day, only with content, only when changed', async () => {
    const db = memorySnapshotDb();
    const empty = bundle(0, day(10));
    empty.data = { 'pact-theme': env({ mode: 'dark' }, 2) };
    expect(await createSnapshot({ kind: 'auto', db, now: day(10), bundle: empty })).toBeNull(); // nothing worth saving
    expect(await createSnapshot({ kind: 'auto', db, now: day(10), bundle: bundle(2, day(10)) })).not.toBeNull();
    expect(await createSnapshot({ kind: 'auto', db, now: day(10, 20), bundle: bundle(5, day(10, 20)) })).toBeNull(); // already today
    expect(await createSnapshot({ kind: 'auto', db, now: day(11), bundle: bundle(5, day(11)) })).not.toBeNull(); // tomorrow, changed
    expect(await createSnapshot({ kind: 'auto', db, now: day(12), bundle: bundle(5, day(12)) })).toBeNull(); // tomorrow, but unchanged
  });

  it('keeps only the last 7 automatic snapshots as days go by', async () => {
    const db = memorySnapshotDb();
    for (let d = 1; d <= 12; d++) await createSnapshot({ kind: 'auto', db, now: day(d), bundle: bundle(d, day(d)) });
    const list = await listSnapshots(db);
    expect(list.filter((m) => m.kind === 'auto')).toHaveLength(7);
    expect(list[0]?.counts['pact-notes.notes']).toBe(12); // newest first
  });

  it('includes the wallpaper picture and notices when only the picture changed', async () => {
    const db = memorySnapshotDb();
    const pic = (n: number) => ({ blob: new Blob([new Uint8Array([1, 2, 3, n])], { type: 'image/webp' }), name: 'Wallpaper' });
    const a = await createSnapshot({ kind: 'manual', db, bundle: bundle(1, day(10), pic(1)) });
    expect(a?.hasWallpaper).toBe(true);
    expect(await createSnapshot({ kind: 'manual', db, bundle: bundle(1, day(10), pic(1)) })).toBeNull();
    expect(await createSnapshot({ kind: 'manual', db, bundle: bundle(1, day(10), pic(2)) })).not.toBeNull();
  });
});

describe('downloading a snapshot', () => {
  it('produces a normal backup file that imports anywhere, wallpaper included', async () => {
    const db = memorySnapshotDb();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const m = await createSnapshot({ kind: 'manual', db, bundle: bundle(2, day(10), { blob: new Blob([png], { type: 'image/png' }), name: 'Wallpaper' }) });
    const file = await snapshotFile(m?.id as string, db);
    expect(file?.name).toBe('pact-snapshot-2026-11-10.json');
    const parsed = parseBackupText(file?.text as string);
    expect(parsed.ok && Object.keys(parsed.bundle.data).sort()).toEqual(['pact-notes', 'pact-theme']);
    expect(parsed.ok && parsed.bundle.wallpaper?.blob.size).toBe(png.length);
    expect(await snapshotFile('missing', db)).toBeNull();
  });

  it('a stored snapshot converts back into a bundle for the restore preview', async () => {
    const db = memorySnapshotDb();
    const m = await createSnapshot({ kind: 'manual', db, bundle: bundle(2, day(10)) });
    const rec = await db.get(m?.id as string);
    expect(snapshotBundle(rec as NonNullable<typeof rec>)).toMatchObject({ exportedAt: day(10).toISOString(), appVersion: '1.0.0', wallpaper: null });
  });
});

describe('describeCounts', () => {
  it('summarises the headline numbers', () => {
    expect(describeCounts({ 'pact-notes.notes': 42, 'pact-kanban.tasks': 1, 'pact-timer.sessions': 0 }, true)).toBe('42 notes · 1 task · wallpaper');
    expect(describeCounts({}, false)).toBe('Settings only');
  });
});
