/**
 * The backup file: reading it safely and writing it compactly.
 *
 * Format 2 (this build) is one JSON document:
 *   { app: 'pact', version: 2, exportedAt, appVersion, account, data: { <storage key>: "<persisted JSON>" },
 *     media: { wallpaper?: { mime, name, base64 } } }
 * Format 1 (every earlier export) is the same without `appVersion`, `account` and `media`, so it simply reads as a
 * format-2 file with no wallpaper — old backups keep importing. A file is untrusted input: it is size-capped, every
 * field is type-checked, unknown keys are ignored, a newer format is refused with a clear message, and the wallpaper
 * is accepted only if its *bytes* are a raster image (never trusting the declared type) and small enough.
 */
import { AREA_KEYS } from '@/lib/backup/areas';
import type { Bundle } from '@/lib/backup/types';

export const BACKUP_FORMAT = 2;
export const FILE_MAX_CHARS = 48 * 1024 * 1024;
export const KEY_MAX_CHARS = 12 * 1024 * 1024;
/** Largest wallpaper picture a backup may carry (decoded). Exports shrink anything bigger. */
export const WALLPAPER_MAX_BYTES = 3 * 1024 * 1024;
/** What an import will still accept (a little more than we write). */
const WALLPAPER_IMPORT_MAX_BYTES = 6 * 1024 * 1024;

export type ParsedFile = { bundle: Bundle; fileVersion: number; warnings: string[] };
export type ParseResult = ({ ok: true } & ParsedFile) | { ok: false; error: string };

type Mime = 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif';

/** Identify a raster image from its first bytes. SVG (which can carry script) is deliberately not recognised. */
export function sniffImage(b: Uint8Array): Mime | null {
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'image/webp';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

export function parseBackupText(textIn: string): ParseResult {
  if (textIn.length > FILE_MAX_CHARS) return { ok: false, error: 'That file is far too large to be a pact backup (over 48 MB).' };
  let root: unknown;
  try {
    root = JSON.parse(textIn);
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON, so it can’t be a pact backup.' };
  }
  if (!isObj(root) || root.app !== 'pact') return { ok: false, error: 'This doesn’t look like a pact backup file.' };
  const version = root.version === undefined ? 1 : root.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, error: 'This backup has an unreadable format version.' };
  if (version > BACKUP_FORMAT) {
    return {
      ok: false,
      error: `This backup was made by a newer version of pact (backup format ${version}; this one reads up to ${BACKUP_FORMAT}). Update pact and try again.`,
    };
  }
  if (!isObj(root.data)) return { ok: false, error: 'The backup has no data in it.' };

  const warnings: string[] = [];
  const data: Record<string, string> = {};
  for (const key of AREA_KEYS) {
    if (!Object.hasOwn(root.data, key)) continue;
    const v = root.data[key];
    if (typeof v !== 'string') warnings.push(`“${key}” wasn’t stored in a readable form and was skipped.`);
    else if (v.length > KEY_MAX_CHARS) warnings.push(`“${key}” is unusually large and was skipped.`);
    else data[key] = v;
  }
  if (Object.keys(data).length === 0) return { ok: false, error: 'The backup is empty — there’s nothing in it to restore.' };

  const exportedRaw = text(root.exportedAt, 40);
  const exportedAt = exportedRaw && !Number.isNaN(Date.parse(exportedRaw)) ? exportedRaw : '';
  const bundle: Bundle = {
    exportedAt,
    appVersion: text(root.appVersion, 40) ?? 'unknown',
    account: text(root.account, 64),
    data,
    wallpaper: null,
  };

  const media = isObj(root.media) ? root.media : null;
  const wp = media && isObj(media.wallpaper) ? media.wallpaper : null;
  if (wp) {
    const decoded = decodeImage(wp.base64);
    if (decoded === 'too-big') warnings.push('The wallpaper picture in this backup is too large and was skipped.');
    else if (!decoded) warnings.push('The wallpaper picture in this backup couldn’t be read and was skipped.');
    else bundle.wallpaper = { blob: new Blob([decoded.bytes as BlobPart], { type: decoded.mime }), name: text(wp.name, 200) ?? 'Wallpaper' };
  }
  return { ok: true, bundle, fileVersion: version, warnings };
}

function decodeImage(b64: unknown): { bytes: Uint8Array; mime: Mime } | 'too-big' | null {
  if (typeof b64 !== 'string' || b64.length === 0) return null;
  if (b64.length > Math.ceil((WALLPAPER_IMPORT_MAX_BYTES * 4) / 3) + 8) return 'too-big';
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const mime = sniffImage(bytes);
  return mime ? { bytes, mime } : null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The file contents for a bundle (compact JSON; the wallpaper, if any, as base64). */
export async function serializeBundle(bundle: Bundle): Promise<string> {
  const media: Record<string, unknown> = {};
  if (bundle.wallpaper) media.wallpaper = { mime: bundle.wallpaper.blob.type, name: bundle.wallpaper.name, base64: await blobToBase64(bundle.wallpaper.blob) };
  return JSON.stringify(
    { app: 'pact', version: BACKUP_FORMAT, exportedAt: bundle.exportedAt, appVersion: bundle.appVersion, account: bundle.account, data: bundle.data, media },
    null,
    1,
  );
}

export const backupFileName = (iso: string, kind = 'backup') => `pact-${kind}-${iso.slice(0, 10)}.json`;
