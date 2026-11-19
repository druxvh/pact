import { describe, expect, it } from 'vitest';
import type { Coll } from './areas';
import { diffColl, mergeColl, planChangesAnything, planImport } from './plan';
import { prepareBundle } from './prepare';
import type { Bundle } from './types';

const NOW = '2026-11-17T12:00:00.000Z';
const at = (min: number) => new Date(Date.UTC(2026, 10, 17, 12, min)).toISOString();
const env = (state: unknown, version: number) => JSON.stringify({ state, version });
const notebook = { id: 'nb-personal', name: 'Personal', memberIds: ['local-user'], nextNumber: 100, createdAt: at(0) };
const N = (id: string, minutes: number, over: Record<string, unknown> = {}) => ({
  id,
  notebookId: 'nb-personal',
  number: Number(id.replace(/\D/g, '')) || 1,
  title: id,
  body: `${id} @${minutes}`,
  pinned: false,
  assigneeId: null,
  createdAt: at(0),
  updatedAt: at(minutes),
  ...over,
});
const notesEnv = (notes: unknown[]) => env({ notebooks: [notebook], notes, activeNotebookId: 'nb-personal', selectedId: null }, 3);
const bundle = (data: Record<string, string>, wallpaper: Bundle['wallpaper'] = null): Bundle => ({
  exportedAt: NOW,
  appVersion: 't',
  account: null,
  data,
  wallpaper,
});
const plan = (
  incoming: Record<string, string>,
  local: Record<string, string>,
  mode: 'merge' | 'replace',
  wallpaper: Bundle['wallpaper'] = null,
  hereHasWallpaperImage = false,
) => planImport(prepareBundle(bundle(incoming, wallpaper), NOW), local, mode, { now: NOW, hereHasWallpaperImage });
const notesOf = (json: string) => (JSON.parse(json).state.notes as Array<{ id: string; body: string }>).map((n) => `${n.id}:${n.body}`);

const COLL: Coll = { field: 'notes', noun: ['note', 'notes'], stamp: 'updatedAt' };

describe('diffColl', () => {
  it('classifies every item', () => {
    const local = [N('n1', 5), N('n2', 5), N('n3', 9), N('n4', 5), N('n5', 5)];
    const incoming = [N('n1', 5), N('n2', 9), N('n3', 5), N('n4', 5, { body: 'differs at same age' }), N('n6', 1), N('n7', 1)];
    const d = diffColl(COLL, local, incoming);
    expect(d).toMatchObject({ incoming: 6, local: 5, added: 2, identical: 1, updated: 1, localNewer: 1, tie: 1, onlyLocal: 1 });
  });

  it('treats missing or non-array data as empty', () => {
    expect(diffColl(COLL, undefined, [N('a', 1)])).toMatchObject({ added: 1, onlyLocal: 0 });
    expect(diffColl(COLL, [N('a', 1)], 'junk')).toMatchObject({ added: 0, onlyLocal: 1 });
  });

  it('compares primitive lists by value', () => {
    const c: Coll = { field: 'friendIds', noun: ['friend', 'friends'], primitive: true };
    expect(diffColl(c, ['a', 'b'], ['b', 'c'])).toMatchObject({ added: 1, identical: 1, onlyLocal: 1 });
  });
});

describe('mergeColl', () => {
  it('keeps ours, adds theirs, and takes their copy only where it is newer', () => {
    const out = mergeColl(
      COLL,
      [N('n1', 5), N('n2', 5), N('n3', 9)],
      [N('n2', 9, { body: 'theirs' }), N('n3', 5, { body: 'old theirs' }), N('n4', 1)],
    ) as Array<{ id: string; body: string }>;
    expect(out.map((n) => `${n.id}:${n.body}`)).toEqual(['n1:n1 @5', 'n2:theirs', 'n3:n3 @9', 'n4:n4 @1']);
  });

  it('sorts when the collection is ordered, and unions primitives', () => {
    const c: Coll = { field: 'sessions', noun: ['s', 's'], stamp: 'completedAt', order: 'desc' };
    const out = mergeColl(c, [{ id: 'a', completedAt: at(1) }], [{ id: 'b', completedAt: at(5) }]) as Array<{ id: string }>;
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
    expect(mergeColl({ field: 'x', noun: ['a', 'a'], primitive: true }, ['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('planImport — what the preview shows is what gets written', () => {
  const local = { 'pact-notes': notesEnv([N('n1', 5), N('n2', 20), N('n3', 5), N('n9', 5)]) };
  // backup: n1 identical, n2 older than ours, n3 newer than ours, n4/n5 new
  const incoming = { 'pact-notes': notesEnv([N('n1', 5), N('n2', 3), N('n3', 30), N('n4', 1), N('n5', 1)]) };

  it('Merge: concrete counts, and the written data is the union keeping the newer copy of each note', () => {
    const p = plan(incoming, local, 'merge');
    const a = p.areas.find((x) => x.id === 'notes');
    expect(a?.action).toBe('merge');
    expect(a?.lines.join('\n')).toContain(
      'Notes: 2 new · 1 updated (the backup’s copy is newer) · 1 stay as they are here (yours is newer) · 1 identical · 1 only on this device (kept)',
    );
    expect(notesOf(p.writes['pact-notes'] as string).sort()).toEqual(['n1:n1 @5', 'n2:n2 @20', 'n3:n3 @30', 'n4:n4 @1', 'n5:n5 @1', 'n9:n9 @5']);
    expect(p.notes?.prev.notes).toHaveLength(4);
    expect(p.notes?.next.notes).toHaveLength(6);
  });

  it('Replace: says it would overwrite newer local edits and remove what is not in the backup, and writes exactly the backup', () => {
    const p = plan(incoming, local, 'replace');
    const a = p.areas.find((x) => x.id === 'notes');
    expect(a?.action).toBe('replace');
    expect(a?.lines.join('\n')).toContain(
      'Notes: 2 new · 1 replaced by newer copies · 1 would overwrite newer local edits · 1 identical · 1 on this device that isn’t in the backup would be removed',
    );
    expect(notesOf(p.writes['pact-notes'] as string).sort()).toEqual(['n1:n1 @5', 'n2:n2 @3', 'n3:n3 @30', 'n4:n4 @1', 'n5:n5 @1']);
    expect(p.notes?.prev.notes).toHaveLength(4);
    expect(p.notes?.next.notes).toHaveLength(5);
  });

  it('Merge never touches preferences; Replace does', () => {
    const data = { 'pact-theme': env({ mode: 'light' }, 2), 'pact-settings': env({ sounds: false }, 1) };
    const m = plan(data, { 'pact-theme': env({ mode: 'dark' }, 2) }, 'merge');
    expect(m.writes).toEqual({});
    expect(m.areas.every((a) => a.action === 'keep')).toBe(true);
    const r = plan(data, { 'pact-theme': env({ mode: 'dark' }, 2) }, 'replace');
    expect(Object.keys(r.writes).sort()).toEqual(['pact-settings', 'pact-theme']);
    expect(JSON.parse(r.writes['pact-theme'] as string)).toEqual({ state: { mode: 'light' }, version: 2 });
  });

  it('merging into an area that does not exist here yet just adds it', () => {
    const p = plan(incoming, {}, 'merge');
    expect(notesOf(p.writes['pact-notes'] as string)).toHaveLength(5);
    expect(p.areas[0]?.action).toBe('replace');
  });

  it('a backup from an older version can only Replace (the store upgrades it on load) — Merge skips it and says why', () => {
    const old = { 'pact-notes': env({ notes: [{ id: 'a', title: 'old', body: '' }] }, 1) };
    const m = plan(old, local, 'merge');
    expect(m.areas[0]?.action).toBe('skip');
    expect(m.areas[0]?.lines[0]).toMatch(/older version.*Replace/);
    expect(m.writes).toEqual({});
    const r = plan(old, local, 'replace');
    expect(JSON.parse(r.writes['pact-notes'] as string).version).toBe(1); // untouched version → migrated by the store
    expect(r.notes).toBeNull(); // not tracked for sync: the shape isn't current
  });

  it('areas that could not be used are listed as skipped, not silently missing', () => {
    const p = plan({ 'pact-notes': env({ notes: [] }, 99), 'pact-theme': env({ mode: 'dark' }, 2) }, {}, 'replace');
    const skipped = p.areas.find((a) => a.id === 'notes');
    expect(skipped?.action).toBe('skip');
    expect(skipped?.lines[0]).toMatch(/newer version/);
    expect(Object.keys(p.writes)).toEqual(['pact-theme']);
  });

  it('merging a timer keeps the local running timer (a stale incoming one is never revived, a live one is never stopped)', () => {
    const running = env({ phase: 'focus', status: 'running', endsAt: 123, remainingMs: 5, durations: { focus: 25, short: 5, long: 15 }, sessions: [] }, 2);
    const theirs = env(
      {
        phase: 'focus',
        status: 'running',
        endsAt: 1,
        remainingMs: 1,
        durations: { focus: 25, short: 5, long: 15 },
        sessions: [{ id: 's1', phase: 'focus', minutes: 25, completedAt: at(1) }],
      },
      2,
    );
    const p = plan({ 'pact-timer': theirs }, { 'pact-timer': running }, 'merge');
    const written = JSON.parse(p.writes['pact-timer'] as string).state;
    expect(written.status).toBe('running');
    expect(written.endsAt).toBe(123);
    expect(written.sessions).toHaveLength(1);
  });

  it('numbers stay unique when two sets of notes are merged into one notebook', () => {
    const p = plan({ 'pact-notes': notesEnv([N('x1', 1, { number: 7 })]) }, { 'pact-notes': notesEnv([N('l1', 1, { number: 7 })]) }, 'merge');
    const written = JSON.parse(p.writes['pact-notes'] as string).state;
    expect(new Set(written.notes.map((n: { number: number }) => n.number)).size).toBe(2);
    expect(written.notebooks[0].nextNumber).toBeGreaterThan(Math.max(...written.notes.map((n: { number: number }) => n.number)));
  });
});

describe('planImport — the wallpaper picture', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
  const appearance = (wallpaper: unknown) => env({ wallpaper, dim: { light: 10, dark: 20 } }, 2);

  it('an image wallpaper in the backup brings its picture along (Replace)', () => {
    const p = plan({ 'pact-appearance': appearance({ kind: 'image', id: 'wallpaper-image', name: 'a' }) }, {}, 'replace', { blob, name: 'a' });
    expect(p.wallpaper).toEqual({ action: 'set', media: { blob, name: 'a' } });
  });

  it('…and if the file has no picture, the wallpaper is set to none rather than left pointing at nothing', () => {
    const p = plan({ 'pact-appearance': appearance({ kind: 'image', id: 'wallpaper-image', name: 'a' }) }, {}, 'replace', null, true);
    expect(JSON.parse(p.writes['pact-appearance'] as string).state.wallpaper).toEqual({ kind: 'none' });
    expect(p.wallpaper).toEqual({ action: 'remove' });
    expect(p.warnings.join(' ')).toMatch(/picture isn’t in the file/);
  });

  it('replacing a picture wallpaper with a colour frees the stored picture; with nothing stored there is nothing to do', () => {
    expect(plan({ 'pact-appearance': appearance({ kind: 'solid', color: '#112233' }) }, {}, 'replace', null, true).wallpaper).toEqual({ action: 'remove' });
    expect(plan({ 'pact-appearance': appearance({ kind: 'solid', color: '#112233' }) }, {}, 'replace', null, false).wallpaper).toEqual({ action: 'keep' });
  });

  it('Merge leaves the wallpaper alone', () => {
    expect(
      plan({ 'pact-appearance': appearance({ kind: 'image', id: 'wallpaper-image', name: 'a' }) }, {}, 'merge', { blob, name: 'a' }, true).wallpaper,
    ).toEqual({ action: 'keep' });
  });
});

describe('planChangesAnything', () => {
  it('a Merge of identical data is a no-op, so the dialog can say so instead of reloading for nothing', () => {
    const data = { 'pact-notes': notesEnv([N('n1', 5)]) };
    const p = plan(data, data, 'merge');
    expect(planChangesAnything(p, data)).toBe(false);
    expect(planChangesAnything(plan({ 'pact-notes': notesEnv([N('n1', 5), N('n2', 5)]) }, data, 'merge'), data)).toBe(true);
  });
});
