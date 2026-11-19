export type WallpaperMedia = { blob: Blob; name: string };

/**
 * Everything a backup, snapshot or export carries.
 * `data` maps a storage key to the persisted JSON of that store (zustand's `{ state, version }` envelope).
 */
export type Bundle = {
  exportedAt: string;
  appVersion: string;
  /** Short one-way fingerprint of the account the data belonged to (null = nobody had claimed it: guest data). */
  account: string | null;
  data: Record<string, string>;
  wallpaper: WallpaperMedia | null;
};

export type SnapshotKind = 'auto' | 'manual' | 'safety';

/** Counts keyed `${storageKey}.${field}` — enough to show "42 notes · 12 tasks" without loading the snapshot. */
export type Counts = Record<string, number>;

export type SnapshotMeta = {
  id: string;
  createdAt: string;
  kind: SnapshotKind;
  label: string;
  /** SHA-256 of the contents: identical data is never snapshotted twice. */
  hash: string;
  bytes: number;
  appVersion: string;
  account: string | null;
  counts: Counts;
  hasWallpaper: boolean;
};

export type SnapshotRecord = SnapshotMeta & { data: Record<string, string>; wallpaper: WallpaperMedia | null };

export type ImportMode = 'merge' | 'replace';
