/**
 * Rolling local snapshots of everything the person has made.
 *
 *  • automatic — at most one per calendar day, taken a few seconds after the app opens, only if something changed
 *    since the newest snapshot (the contents are hashed; identical data is never stored twice);
 *  • manual — "Snapshot now";
 *  • safety — taken automatically right before a restore, an import or a sign-out, so those can be undone.
 * Kept in IndexedDB, on this device only. The policy (what to keep, what to evict first) is pure and tested.
 */
import { collectBundle, contentBytes, hasContent, hashBundleContents, summarizeCounts } from '@/lib/backup/collect';
import { idbSnapshotDb, type SnapshotDb } from '@/lib/backup/db';
import { backupFileName, serializeBundle } from '@/lib/backup/format';
import type { Bundle, SnapshotKind, SnapshotMeta, SnapshotRecord } from '@/lib/backup/types';
import { uid } from '@/lib/format';
import { useAuthStore } from '@/store/useAuthStore';

const MB = 1024 * 1024;

/** What is kept. Automatic snapshots go first when space or count runs out, then safety ones, and manual ones last. */
export const SNAPSHOT_LIMITS = { auto: 7, manual: 12, safety: 6, totalCount: 24, totalBytes: 120 * MB } as const;

const byNewest = (a: SnapshotMeta, b: SnapshotMeta) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/** Ids to delete so that `metas` fits the limits. `protectId` (the snapshot just taken) is never evicted. */
export function planEviction(metas: readonly SnapshotMeta[], protectId?: string, limits: typeof SNAPSHOT_LIMITS = SNAPSHOT_LIMITS): string[] {
  const kept = [...metas].sort(byNewest);
  const doomed = new Set<string>();
  // 1. per-kind caps: keep the newest N of each
  for (const kind of ['auto', 'manual', 'safety'] as const) {
    const mine = kept.filter((m) => m.kind === kind);
    for (const m of mine.slice(limits[kind])) if (m.id !== protectId) doomed.add(m.id);
  }
  // 2. total count / size: drop the oldest, automatic first, then safety, then manual
  const rank: Record<SnapshotKind, number> = { auto: 0, safety: 1, manual: 2 };
  const survivors = () => kept.filter((m) => !doomed.has(m.id));
  const over = () => survivors().length > limits.totalCount || survivors().reduce((n, m) => n + m.bytes, 0) > limits.totalBytes;
  while (over()) {
    const victim = survivors()
      .filter((m) => m.id !== protectId)
      .sort((a, b) => rank[a.kind] - rank[b.kind] || Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (!victim) break;
    doomed.add(victim.id);
  }
  return [...doomed];
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** At most one automatic snapshot per (local) day, only when there is something to save and it differs from the newest snapshot. */
export function shouldAutoSnapshot(input: { now: Date; metas: readonly SnapshotMeta[]; hash: string; hasContent: boolean }): boolean {
  if (!input.hasContent) return false;
  const newest = [...input.metas].sort(byNewest)[0];
  if (newest?.hash === input.hash) return false;
  const lastAuto = [...input.metas].filter((m) => m.kind === 'auto').sort(byNewest)[0];
  return !(lastAuto && dayKey(new Date(lastAuto.createdAt)) === dayKey(input.now));
}

export async function listSnapshots(db: SnapshotDb = idbSnapshotDb()): Promise<SnapshotMeta[]> {
  return (await db.list()).sort(byNewest);
}

export type CreateOptions = {
  kind: SnapshotKind;
  label?: string;
  db?: SnapshotDb;
  now?: Date;
  /** Don't store it if the newest snapshot already holds exactly this data (default for auto and manual). */
  skipIfIdentical?: boolean;
  /** For tests: use this instead of reading the device. */
  bundle?: Bundle;
};

const DEFAULT_LABEL: Record<SnapshotKind, string> = { auto: 'Automatic', manual: 'Manual snapshot', safety: 'Safety copy' };

/** Take a snapshot of what's on this device now. Returns null when nothing changed since the newest one (or there's nothing to save). */
export async function createSnapshot(opts: CreateOptions): Promise<SnapshotMeta | null> {
  const db = opts.db ?? idbSnapshotDb();
  const bundle = opts.bundle ?? (await collectBundle(opts.now)).bundle;
  const counts = summarizeCounts(bundle.data);
  const hash = await hashBundleContents(bundle.data, bundle.wallpaper);
  const metas = await db.list();
  const skip = opts.skipIfIdentical ?? opts.kind !== 'safety';
  if (skip && [...metas].sort(byNewest)[0]?.hash === hash) return null;
  if (opts.kind === 'auto' && !shouldAutoSnapshot({ now: opts.now ?? new Date(), metas, hash, hasContent: hasContent(counts, bundle.wallpaper !== null) }))
    return null;
  const meta: SnapshotMeta = {
    id: uid('snap'),
    createdAt: bundle.exportedAt,
    kind: opts.kind,
    label: opts.label ?? DEFAULT_LABEL[opts.kind],
    hash,
    bytes: contentBytes(bundle.data, bundle.wallpaper),
    appVersion: bundle.appVersion,
    account: bundle.account,
    counts,
    hasWallpaper: bundle.wallpaper !== null,
  };
  await db.put({ ...meta, data: bundle.data, wallpaper: bundle.wallpaper });
  const doomed = planEviction([...metas, meta], meta.id);
  if (doomed.length) await db.delete(doomed);
  return meta;
}

export async function loadSnapshot(id: string, db: SnapshotDb = idbSnapshotDb()): Promise<SnapshotRecord | undefined> {
  return db.get(id);
}

export const snapshotBundle = (r: SnapshotRecord): Bundle => ({
  exportedAt: r.createdAt,
  appVersion: r.appVersion,
  account: r.account,
  data: r.data,
  wallpaper: r.wallpaper,
});

export async function deleteSnapshot(id: string, db: SnapshotDb = idbSnapshotDb()): Promise<void> {
  await db.delete([id]);
}

/** The snapshot as a downloadable backup file (the same format as an export, so it imports anywhere). */
export async function snapshotFile(id: string, db: SnapshotDb = idbSnapshotDb()): Promise<{ name: string; text: string } | null> {
  const rec = await db.get(id);
  if (!rec) return null;
  return { name: backupFileName(rec.createdAt, rec.kind === 'auto' ? 'auto' : 'snapshot'), text: await serializeBundle(snapshotBundle(rec)) };
}

// ── automatic, once a day ────────────────────────────────────────────────────

const AUTO_DELAY_MS = 8000;
let autoStarted = false;

/** Take today's automatic snapshot if it's due. Never throws. */
export async function maybeAutoSnapshot(db?: SnapshotDb): Promise<SnapshotMeta | null> {
  try {
    return await createSnapshot({ kind: 'auto', ...(db ? { db } : null) });
  } catch (err) {
    console.warn('[pact] automatic snapshot failed:', err);
    return null;
  }
}

/**
 * Call once at startup. Waits until sign-in has settled (so an account switch — which wipes and reloads — doesn't
 * snapshot the wrong person's data), then a few idle seconds, then takes the day's snapshot in ONE tab (a Web Lock),
 * not in every open new-tab page.
 */
export function startAutoSnapshots(): void {
  if (autoStarted || typeof window === 'undefined') return;
  autoStarted = true;
  const go = () => {
    const run = () => {
      const locks = (navigator as Navigator & { locks?: LockManager }).locks;
      if (!locks) {
        void maybeAutoSnapshot();
        return;
      }
      void locks.request('pact-auto-snapshot', { ifAvailable: true }, async (lock) => {
        if (lock) await maybeAutoSnapshot();
      });
    };
    window.setTimeout(run, AUTO_DELAY_MS);
  };
  if (useAuthStore.getState().status !== 'loading') {
    go();
    return;
  }
  const unsubscribe = useAuthStore.subscribe((s) => {
    if (s.status === 'loading') return;
    unsubscribe();
    go();
  });
}
