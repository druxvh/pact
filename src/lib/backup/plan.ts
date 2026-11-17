/**
 * Working out what an import / restore would do — as a pure function of (what's in the backup, what's on this
 * device, Replace or Merge). The preview dialog shows exactly this, and applying it writes exactly this; nothing is
 * decided anywhere else, so what the person confirms is what happens.
 */
import type { AreaId, AreaSpec, Coll } from '@/lib/backup/areas';
import { type PreparedArea, type PreparedBundle, parseEnvelope } from '@/lib/backup/prepare';
import { isRecord, type Rec } from '@/lib/backup/schema';
import type { ImportMode, WallpaperMedia } from '@/lib/backup/types';

// ── comparing collections ────────────────────────────────────────────────────

export type CollDiff = {
  coll: Coll;
  /** Items in the backup / on this device. */
  incoming: number;
  local: number;
  /** In the backup only. */
  added: number;
  identical: number;
  /** Different, and the backup's copy was edited later. */
  updated: number;
  /** Different, and ours is later or they tie — "newer local edits" in Replace mode, "kept" in Merge. */
  localNewer: number;
  tie: number;
  /** On this device only. */
  onlyLocal: number;
};

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (isRecord(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const keyOf = (item: unknown, c: Coll): string | null =>
  c.primitive ? (typeof item === 'string' ? item : null) : isRecord(item) && typeof item.id === 'string' ? item.id : null;
const stampOf = (item: unknown, c: Coll): number =>
  c.stamp && isRecord(item) && typeof item[c.stamp] === 'string' ? Date.parse(item[c.stamp] as string) : Number.NaN;

export function diffColl(c: Coll, local: unknown, incoming: unknown): CollDiff {
  const L = asList(local);
  const I = asList(incoming);
  const byKey = new Map<string, unknown>();
  for (const it of L) {
    const k = keyOf(it, c);
    if (k !== null) byKey.set(k, it);
  }
  const d: CollDiff = { coll: c, incoming: I.length, local: L.length, added: 0, identical: 0, updated: 0, localNewer: 0, tie: 0, onlyLocal: 0 };
  const seen = new Set<string>();
  for (const it of I) {
    const k = keyOf(it, c);
    if (k === null) continue;
    seen.add(k);
    if (!byKey.has(k)) {
      d.added++;
      continue;
    }
    const mine = byKey.get(k);
    if (c.primitive || stable(mine) === stable(it)) {
      d.identical++;
      continue;
    }
    const a = stampOf(it, c);
    const b = stampOf(mine, c);
    if (a > b) d.updated++;
    else if (b > a) d.localNewer++;
    else d.tie++;
  }
  for (const k of byKey.keys()) if (!seen.has(k)) d.onlyLocal++;
  return d;
}

/** Union of two lists: ours stay (and keep their order); the backup's new items are appended; the backup's copy replaces ours only where it is newer. */
export function mergeColl(c: Coll, local: unknown, incoming: unknown): unknown[] {
  const out = [...asList(local)];
  const index = new Map<string, number>();
  out.forEach((it, i) => {
    const k = keyOf(it, c);
    if (k !== null) index.set(k, i);
  });
  for (const it of asList(incoming)) {
    const k = keyOf(it, c);
    if (k === null) continue;
    const at = index.get(k);
    if (at === undefined) {
      index.set(k, out.length);
      out.push(it);
    } else if (!c.primitive && stable(out[at]) !== stable(it) && stampOf(it, c) > stampOf(out[at], c)) {
      out[at] = it;
    }
  }
  if (c.order && c.stamp) {
    const dir = c.order === 'asc' ? 1 : -1;
    out.sort((a, b) => dir * ((stampOf(a, c) || 0) - (stampOf(b, c) || 0)));
  }
  return out;
}

export function mergeState(spec: AreaSpec, local: Rec, incoming: Rec, now: string): Rec {
  const merged: Rec = { ...local };
  for (const c of spec.colls) if (Array.isArray(incoming[c.field])) merged[c.field] = mergeColl(c, local[c.field], incoming[c.field]);
  return spec.repair ? spec.repair(merged, now) : merged;
}

// ── the plan ─────────────────────────────────────────────────────────────────

export type AreaAction = 'replace' | 'merge' | 'keep' | 'skip';

export type AreaPreview = {
  id: AreaId;
  label: string;
  action: AreaAction;
  /** What the backup holds, e.g. "42 notes · 3 notebooks" (or "included"). */
  contents: string;
  /** What this device holds now, in the same words. */
  here: string;
  /** Concrete consequences for this mode. */
  lines: string[];
  diffs: CollDiff[];
};

export type NotesChange = { prev: { notebooks: unknown[]; notes: unknown[] }; next: { notebooks: unknown[]; notes: unknown[] } };

export type Plan = {
  mode: ImportMode;
  /** storage key → persisted JSON to write. */
  writes: Record<string, string>;
  wallpaper: { action: 'keep' } | { action: 'set'; media: WallpaperMedia } | { action: 'remove' };
  /** Set when the notes area is written, so sync can be told what changed. */
  notes: NotesChange | null;
  areas: AreaPreview[];
  warnings: string[];
};

const n = (count: number, noun: readonly [string, string]) => `${count.toLocaleString('en-US')} ${count === 1 ? noun[0] : noun[1]}`;

function describe(mode: ImportMode, diffs: CollDiff[]): string[] {
  const lines: string[] = [];
  for (const d of diffs) {
    if (d.incoming === 0 && d.local === 0) continue;
    const parts: string[] = [];
    if (mode === 'merge') {
      if (d.added) parts.push(`${d.added} new`);
      if (d.updated) parts.push(`${d.updated} updated (the backup’s copy is newer)`);
      if (d.localNewer) parts.push(`${d.localNewer} stay as they are here (yours is newer)`);
      if (d.tie) parts.push(`${d.tie} stay as they are here`);
      if (d.identical) parts.push(`${d.identical} identical`);
      if (d.onlyLocal) parts.push(`${d.onlyLocal} only on this device (kept)`);
    } else {
      if (d.added) parts.push(`${d.added} new`);
      if (d.updated) parts.push(`${d.updated} replaced by newer copies`);
      if (d.localNewer) parts.push(`${d.localNewer} would overwrite newer local edits`);
      if (d.tie) parts.push(`${d.tie} changed`);
      if (d.identical) parts.push(`${d.identical} identical`);
      if (d.onlyLocal) parts.push(`${d.onlyLocal} on this device that ${d.onlyLocal === 1 ? 'isn’t' : 'aren’t'} in the backup would be removed`);
    }
    if (parts.length === 0) parts.push('nothing to do');
    const name = d.coll.noun[1];
    lines.push(`${name[0]?.toUpperCase()}${name.slice(1)}: ${parts.join(' · ')}`);
  }
  return lines;
}

const summarize = (spec: AreaSpec, state: Rec | null): string => {
  if (!state) return '—';
  if (spec.colls.length === 0) return 'included';
  return spec.colls.map((c) => n(asList(state[c.field]).length, c.noun)).join(' · ');
};

const envelope = (state: Rec, version: number) => JSON.stringify({ state, version });

/** Wallpaper handling that goes with replacing the Appearance area. */
function wallpaperPlan(
  area: PreparedArea | undefined,
  media: WallpaperMedia | null,
  hereHasImage: boolean,
  warnings: string[],
): { state: Rec | null; wallpaper: Plan['wallpaper'] } {
  if (!area) return { state: null, wallpaper: { action: 'keep' } };
  const wp = area.state.wallpaper;
  if (isRecord(wp) && wp.kind === 'image') {
    if (media) return { state: area.state, wallpaper: { action: 'set', media } };
    warnings.push('This backup’s wallpaper was a picture, but the picture isn’t in the file — the wallpaper is set to none.');
    return { state: { ...area.state, wallpaper: { kind: 'none' } }, wallpaper: hereHasImage ? { action: 'remove' } : { action: 'keep' } };
  }
  return { state: area.state, wallpaper: hereHasImage ? { action: 'remove' } : { action: 'keep' } };
}

export function planImport(
  prepared: PreparedBundle,
  localData: Record<string, string>,
  mode: ImportMode,
  ctx: { now: string; hereHasWallpaperImage: boolean },
): Plan {
  const writes: Record<string, string> = {};
  const areas: AreaPreview[] = [];
  const warnings = [...prepared.warnings];
  let notes: NotesChange | null = null;
  let wallpaper: Plan['wallpaper'] = { action: 'keep' };

  for (const r of prepared.rejected) {
    areas.push({
      id: r.spec.id,
      label: r.spec.label,
      action: 'skip',
      contents: '—',
      here: '—',
      lines: [r.reason === 'newer' ? 'Made by a newer version of pact — skipped.' : 'Couldn’t be read — skipped.'],
      diffs: [],
    });
  }

  for (const area of prepared.areas) {
    const spec = area.spec;
    const localEnv = parseEnvelope(localData[spec.key]);
    const localState = localEnv && isRecord(localEnv.state) ? localEnv.state : null;
    const diffs = spec.colls.map((c) => diffColl(c, localState?.[c.field], area.state[c.field]));
    const base = { id: spec.id, label: spec.label, contents: summarize(spec, area.state), here: summarize(spec, localState), diffs };

    if (mode === 'merge') {
      if (!spec.mergeable) {
        areas.push({ ...base, action: 'keep', lines: ['Settings aren’t merged — yours stay as they are.'] });
        continue;
      }
      if (!area.strict) {
        areas.push({ ...base, action: 'skip', lines: ['From an older version of pact, which can’t be merged — choose Replace to restore it.'] });
        continue;
      }
      if (!localState || localEnv?.version !== spec.version) {
        writes[spec.key] = envelope(area.state, spec.version);
        areas.push({ ...base, action: 'replace', lines: ['Nothing here yet — the backup’s data is added as it is.'] });
        if (spec.id === 'notes')
          notes = { prev: { notebooks: [], notes: [] }, next: { notebooks: asList(area.state.notebooks), notes: asList(area.state.notes) } };
        continue;
      }
      const merged = mergeState(spec, localState, area.state, ctx.now);
      writes[spec.key] = envelope(merged, spec.version);
      areas.push({ ...base, action: 'merge', lines: describe(mode, diffs) });
      if (spec.id === 'notes')
        notes = {
          prev: { notebooks: asList(localState.notebooks), notes: asList(localState.notes) },
          next: { notebooks: asList(merged.notebooks), notes: asList(merged.notes) },
        };
      continue;
    }

    // Replace
    let state = area.state;
    if (spec.id === 'appearance') {
      const wp = wallpaperPlan(area, prepared.wallpaper, ctx.hereHasWallpaperImage, warnings);
      state = wp.state ?? state;
      wallpaper = wp.wallpaper;
    }
    writes[spec.key] = envelope(state, area.version);
    const lines = spec.colls.length ? describe(mode, diffs) : ['Replaced with the backup’s.'];
    areas.push({ ...base, action: 'replace', lines: lines.length ? lines : ['Replaced with the backup’s.'] });
    if (spec.id === 'notes' && area.strict) {
      notes = {
        prev: { notebooks: asList(localState?.notebooks), notes: asList(localState?.notes) },
        next: { notebooks: asList(state.notebooks), notes: asList(state.notes) },
      };
    }
  }

  return { mode, writes, wallpaper, notes, areas, warnings };
}

/** Does a plan change anything at all? (A Merge of identical data is a no-op.) */
export function planChangesAnything(plan: Plan, localData: Record<string, string>): boolean {
  if (plan.wallpaper.action !== 'keep') return true;
  return Object.entries(plan.writes).some(([k, v]) => stable(parseEnvelope(localData[k])) !== stable(parseEnvelope(v)));
}
