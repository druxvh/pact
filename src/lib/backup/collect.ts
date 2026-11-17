/**
 * Reading everything worth backing up from this device: the persisted JSON of each store (straight from
 * localStorage, so it is the exact, atomic thing the app itself would load) plus the wallpaper picture from IndexedDB.
 */

import { IMAGE_ASSET_ID, shrinkWallpaperBlob } from '@/lib/appearance/wallpaper';
import { getAsset } from '@/lib/assets';
import { AREA_KEYS, AREAS, scrubForBackup } from '@/lib/backup/areas';
import { WALLPAPER_MAX_BYTES } from '@/lib/backup/format';
import { parseEnvelope } from '@/lib/backup/prepare';
import { isRecord } from '@/lib/backup/schema';
import type { Bundle, Counts } from '@/lib/backup/types';
import { appVersion } from '@/lib/ext';
import { localOwner } from '@/lib/supabase/owner';

/** The persisted value of every backed-up store that exists on this device. */
export function readLocalData(): Record<string, string> {
  const data: Record<string, string> = {};
  try {
    for (const key of AREA_KEYS) {
      const v = localStorage.getItem(key);
      if (v !== null) data[key] = scrubForBackup(key, v);
    }
  } catch {
    /* storage unavailable */
  }
  return data;
}

/** Does the Appearance data on this device point at a picture wallpaper? */
export function usesImageWallpaper(data: Record<string, string>): boolean {
  const env = parseEnvelope(data['pact-appearance']);
  const wp = env && isRecord(env.state) ? env.state.wallpaper : null;
  return isRecord(wp) && wp.kind === 'image';
}

export async function sha256Hex(parts: Array<string | Uint8Array>): Promise<string> {
  const enc = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const total = chunks.reduce((n, c) => n + c.length + 8, 0);
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    new DataView(buf.buffer).setUint32(at, c.length >>> 0, false); // length-prefix, so ("ab","c") ≠ ("a","bc")
    at += 8;
    buf.set(c, at);
    at += c.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A short, one-way tag for the account that owned the data — enough to say "this backup is from a different account". */
export async function accountFingerprint(userId: string | null = localOwner()): Promise<string | null> {
  return userId ? (await sha256Hex([`pact-account:${userId}`])).slice(0, 12) : null;
}

export async function hashBundleContents(data: Record<string, string>, wallpaper: Bundle['wallpaper']): Promise<string> {
  const parts: Array<string | Uint8Array> = [];
  for (const k of Object.keys(data).sort()) parts.push(k, data[k] as string);
  if (wallpaper) parts.push('wallpaper', new Uint8Array(await wallpaper.blob.arrayBuffer()));
  return sha256Hex(parts);
}

/** `${storageKey}.${field}` → how many, for every collection that exists. */
export function summarizeCounts(data: Record<string, string>): Counts {
  const counts: Counts = {};
  for (const spec of AREAS) {
    const env = parseEnvelope(data[spec.key]);
    if (!env || !isRecord(env.state)) continue;
    for (const c of spec.colls) {
      const v = env.state[c.field];
      if (Array.isArray(v)) counts[`${spec.key}.${c.field}`] = v.length;
    }
  }
  return counts;
}

export const hasContent = (counts: Counts, wallpaper: boolean) => wallpaper || Object.values(counts).some((n) => n > 0);

export const contentBytes = (data: Record<string, string>, wallpaper: Bundle['wallpaper']) =>
  Object.entries(data).reduce((n, [k, v]) => n + k.length + v.length, 0) + (wallpaper?.blob.size ?? 0);

/**
 * The custom wallpaper picture, kept small enough for a backup. Pictures are stored downscaled already (≤ 2560 px WebP),
 * but if one is still over the cap it is shrunk further; if that fails it is left out (and the caller says so).
 */
export async function readWallpaperForBackup(data: Record<string, string>): Promise<{ media: Bundle['wallpaper']; skipped: boolean }> {
  if (!usesImageWallpaper(data)) return { media: null, skipped: false };
  try {
    const blob = await getAsset(IMAGE_ASSET_ID);
    if (!blob) return { media: null, skipped: false };
    const small = blob.size <= WALLPAPER_MAX_BYTES ? blob : await shrinkWallpaperBlob(blob, WALLPAPER_MAX_BYTES);
    return { media: { blob: small, name: 'Wallpaper' }, skipped: false };
  } catch {
    return { media: null, skipped: true };
  }
}

export async function collectBundle(now = new Date()): Promise<{ bundle: Bundle; wallpaperSkipped: boolean }> {
  const data = readLocalData();
  const { media, skipped } = await readWallpaperForBackup(data);
  return {
    bundle: { exportedAt: now.toISOString(), appVersion: appVersion(), account: await accountFingerprint(), data, wallpaper: media },
    wallpaperSkipped: skipped,
  };
}
