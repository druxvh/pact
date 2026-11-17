/**
 * From a parsed file to clean, typed areas: each store's persisted value is parsed, validated against its schema,
 * repaired, and given a verdict (current version / older / newer than this build). Nothing here touches storage.
 */
import { AREAS, type AreaSpec } from '@/lib/backup/areas';
import { isRecord, newCounter, type Rec } from '@/lib/backup/schema';
import type { Bundle } from '@/lib/backup/types';

export type PreparedArea = {
  spec: AreaSpec;
  /** The persist version the backup holds this store in. */
  version: number;
  /** Same version as this build: can be merged; older ones can only replace (the store upgrades them on load). */
  strict: boolean;
  state: Rec;
  /** Entries that were unreadable and left out. */
  dropped: number;
};

export type RejectedArea = { spec: AreaSpec; reason: 'newer' | 'unreadable' };

export type PreparedBundle = {
  areas: PreparedArea[];
  rejected: RejectedArea[];
  wallpaper: Bundle['wallpaper'];
  warnings: string[];
  exportedAt: string;
  appVersion: string;
  account: string | null;
};

export type Envelope = { state: unknown; version: number };

/** A store's persisted value: zustand writes `{ state, version }`. */
export function parseEnvelope(raw: string | undefined | null): Envelope | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isRecord(v) || !isRecord(v.state)) return null;
    const version = typeof v.version === 'number' && Number.isInteger(v.version) && v.version >= 0 ? v.version : 0;
    return { state: v.state, version };
  } catch {
    return null;
  }
}

export function prepareBundle(bundle: Bundle, now: string): PreparedBundle {
  const areas: PreparedArea[] = [];
  const rejected: RejectedArea[] = [];
  const warnings: string[] = [];
  for (const spec of AREAS) {
    const raw = bundle.data[spec.key];
    if (raw === undefined) continue;
    const env = parseEnvelope(raw);
    if (!env) {
      rejected.push({ spec, reason: 'unreadable' });
      warnings.push(`${spec.label} couldn’t be read and was skipped.`);
      continue;
    }
    if (env.version > spec.version) {
      rejected.push({ spec, reason: 'newer' });
      warnings.push(`${spec.label} was saved by a newer version of pact and was skipped — update pact to restore it.`);
      continue;
    }
    const strict = env.version === spec.version;
    const counter = newCounter();
    const parsed = spec.parse(env.state, strict, counter);
    if (!parsed) {
      rejected.push({ spec, reason: 'unreadable' });
      warnings.push(`${spec.label} couldn’t be read and was skipped.`);
      continue;
    }
    if (counter.dropped > 0)
      warnings.push(
        `${counter.dropped} unreadable ${counter.dropped === 1 ? 'entry' : 'entries'} in ${spec.label} ${counter.dropped === 1 ? 'was' : 'were'} skipped.`,
      );
    areas.push({
      spec,
      version: env.version,
      strict,
      state: strict ? (spec.normalize ?? ((x: Rec) => x))(spec.repair ? spec.repair(parsed, now) : parsed) : parsed,
      dropped: counter.dropped,
    });
  }
  return { areas, rejected, wallpaper: bundle.wallpaper, warnings, exportedAt: bundle.exportedAt, appVersion: bundle.appVersion, account: bundle.account };
}
