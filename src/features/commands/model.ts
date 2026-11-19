/**
 * The user's own omnibox commands — quicklinks, snippets and aliases — as plain data plus every rule about them:
 * validation (with messages for the person), clean-up of anything read from storage or a file, collision checks, import
 * and export. No React and no store in here, so the store, the omnibox provider, the manager UI and the backup
 * validator all share one set of rules and each is unit-tested through it.
 */
import { emojiOf } from '@/features/timer/presets';
import { BANGS, type Bang } from '@/lib/omnibox/bangs';
import {
  ALIAS_MAX,
  aliasFormatProblem,
  hasPlaceholder,
  isValidAlias,
  normalizeAlias,
  SNIPPET_MAX,
  templateHome,
  URL_MAX,
  urlTemplateProblem,
} from '@/lib/omnibox/templates';

export const MAX_COMMANDS = 100;
export const NAME_MAX = 40;
/** The biggest file an import reads. */
export const IMPORT_MAX_BYTES = 512 * 1024;
/** How many entries of an imported file are looked at. */
const IMPORT_SCAN_MAX = 1000;

export type CommandKind = 'quicklink' | 'snippet' | 'alias';
export const KINDS: readonly CommandKind[] = ['quicklink', 'snippet', 'alias'];

export const KIND_LABEL: Record<CommandKind, { one: string; many: string }> = {
  quicklink: { one: 'Quicklink', many: 'Quicklinks' },
  snippet: { one: 'Snippet', many: 'Snippets' },
  alias: { one: 'Alias', many: 'Aliases' },
};

type Base = { id: string; name: string; alias: string; createdAt: string; updatedAt: string };
/** A link with an optional `{query}` / `{clipboard}` in it. `icon` is `''` (the site's favicon), `emoji:🍵` or `icon:rocket`. */
export type Quicklink = Base & { kind: 'quicklink'; url: string; icon: string };
/** Text that is copied to the clipboard, with `{date}` `{time}` `{datetime}` `{clipboard}` filled in. */
export type Snippet = Base & { kind: 'snippet'; text: string };
/** A short name for one of pact's own pages, tools or actions (`target` is the omnibox result id: `page:timer`). */
export type AliasCommand = Base & { kind: 'alias'; target: string };
export type CustomCommand = Quicklink | Snippet | AliasCommand;

/** The icons a quicklink can wear besides a favicon or an emoji (the map to real icons is in `CommandIcon.tsx`). */
export const COMMAND_ICON_KEYS = [
  'link',
  'globe',
  'search',
  'bookmark',
  'star',
  'code',
  'mail',
  'music',
  'video',
  'book',
  'cart',
  'map',
  'calendar',
  'chat',
  'file',
  'folder',
  'image',
  'heart',
  'home',
  'rocket',
  'zap',
  'wrench',
  'school',
  'briefcase',
] as const;
export type CommandIconKey = (typeof COMMAND_ICON_KEYS)[number];

const ICON_PREFIX = 'icon:';
const EMOJI_PREFIX = 'emoji:';
export const iconValue = (key: CommandIconKey) => `${ICON_PREFIX}${key}`;
export const emojiValue = (emoji: string) => `${EMOJI_PREFIX}${emoji}`;

/** `''` / `emoji:🍵` / `icon:rocket` → the cleaned value (anything else becomes `''`, the site's favicon). */
export function cleanIcon(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  if (raw.startsWith(EMOJI_PREFIX)) {
    const e = emojiOf(raw.slice(EMOJI_PREFIX.length));
    return e ? emojiValue(e) : '';
  }
  if (raw.startsWith(ICON_PREFIX)) {
    const key = raw.slice(ICON_PREFIX.length);
    return (COMMAND_ICON_KEYS as readonly string[]).includes(key) ? raw : '';
  }
  return '';
}

/* ───────────────────────────── aliases and who owns them ───────────────────────────── */

/** Every trigger of the built-in site searches (`gh`, `yt`, `w`…) → the search's name. Taken for good: a quicklink can't reuse them. */
const BUILTIN_OWNER = new Map<string, string>();
for (const b of BANGS) for (const t of b.triggers) if (!BUILTIN_OWNER.has(t)) BUILTIN_OWNER.set(t, b.name);

export const isBuiltinAlias = (alias: string): boolean => BUILTIN_OWNER.has(alias);

const KIND_NOUN: Record<CommandKind, string> = { quicklink: 'quicklink', snippet: 'snippet', alias: 'alias' };

/** Who already uses `alias` (already normalised), as a phrase for an error message — or `null` when it is free. */
export function aliasOwner(alias: string, items: readonly CustomCommand[], exceptId?: string): string | null {
  const builtin = BUILTIN_OWNER.get(alias);
  if (builtin) return `the built-in ${builtin} search`;
  const mine = items.find((c) => c.id !== exceptId && c.alias === alias);
  return mine ? `your ${KIND_NOUN[mine.kind]} “${mine.name}”` : null;
}

/** `gh` → `gh-2`, `gh-3`… the first alias based on `base` that nothing uses (within the length limit). */
export function freeAlias(base: string, items: readonly CustomCommand[]): string {
  const root = normalizeAlias(base)
    .slice(0, ALIAS_MAX - 3)
    .replace(/-+$/, '');
  if (root && !aliasOwner(root, items) && isValidAlias(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root || 'cmd'}-${n}`;
    if (!aliasOwner(candidate, items)) return candidate;
  }
  return '';
}

/** alias → the result ids it names, for the engine (`EngineOptions.aliases`). */
export function aliasIndex(items: readonly CustomCommand[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of items) {
    if (c.kind !== 'alias' || !c.alias) continue;
    const list = out[c.alias] ?? [];
    list.push(c.target);
    out[c.alias] = list;
  }
  return out;
}

/** A quicklink as a "bang": what the chip, `!alias` and the ghost completion work with. */
export function quicklinkToBang(c: Quicklink): Bang {
  return { id: `ql:${c.id}`, name: c.name, triggers: c.alias ? [c.alias] : [], url: c.url, home: templateHome(c.url), custom: true, icon: c.icon || undefined };
}

/** The quicklinks that can be searched from a chip: they have an alias, and the address has a `{query}` to fill. */
export function customBangsFrom(items: readonly CustomCommand[]): Bang[] {
  return items.flatMap((c) => (c.kind === 'quicklink' && c.alias && !isBuiltinAlias(c.alias) && hasPlaceholder(c.url, 'query') ? [quicklinkToBang(c)] : []));
}

/* ───────────────────────────── a form's draft → a command ───────────────────────────── */

/** What a form holds: loose text, before it is validated. One shape for every kind (unused fields stay empty). */
export type CommandDraft = { kind: CommandKind; name: string; alias: string; url: string; icon: string; text: string; target: string };

export const emptyDraft = (kind: CommandKind): CommandDraft => ({ kind, name: '', alias: '', url: '', icon: '', text: '', target: '' });

export function draftOf(c: CustomCommand): CommandDraft {
  return {
    ...emptyDraft(c.kind),
    name: c.name,
    alias: c.alias,
    url: c.kind === 'quicklink' ? c.url : '',
    icon: c.kind === 'quicklink' ? c.icon : '',
    text: c.kind === 'snippet' ? c.text : '',
    target: c.kind === 'alias' ? c.target : '',
  };
}

export type DraftField = 'name' | 'alias' | 'url' | 'text' | 'target' | 'form';
export type DraftErrors = Partial<Record<DraftField, string>>;
export type DraftResult = { ok: true; item: CustomCommand } | { ok: false; errors: DraftErrors };

const TARGET_RE = /^(?:page|tool|action):[a-z0-9-]{1,60}$/;
export const isTargetId = (v: unknown): v is string => typeof v === 'string' && TARGET_RE.test(v);

const tidy = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Check a form's draft against the commands that already exist and build the command. `id` makes it an edit (the command
 * keeps its id and creation time; its own alias is not a clash). Nothing is thrown: problems come back per field.
 */
export function validateDraft(
  draft: CommandDraft,
  existing: readonly CustomCommand[],
  opts: { now: string; id?: string; createdAt?: string; makeId?: () => string },
): DraftResult {
  const errors: DraftErrors = {};
  const name = tidy(draft.name, NAME_MAX + 1);
  if (!name) errors.name = 'Give it a name.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters or fewer.`;

  const alias = normalizeAlias(draft.alias);
  if (alias || draft.kind === 'alias') {
    const bad = aliasFormatProblem(alias);
    if (bad) errors.alias = bad;
    else {
      const owner = aliasOwner(alias, existing, opts.id);
      if (owner) errors.alias = `“${alias}” is already used by ${owner}. Pick another.`;
    }
  }

  let url = '';
  if (draft.kind === 'quicklink') {
    url = draft.url.trim();
    const bad = urlTemplateProblem(url);
    if (bad) errors.url = bad;
  }
  let text = '';
  if (draft.kind === 'snippet') {
    text = draft.text.replace(/\r\n?/g, '\n');
    if (!text.trim()) errors.text = 'Type the text to copy.';
    else if (text.length > SNIPPET_MAX) errors.text = `That’s too long (up to ${SNIPPET_MAX} characters).`;
  }
  if (draft.kind === 'alias' && !isTargetId(draft.target)) errors.target = 'Choose what the alias opens.';

  if (!opts.id && existing.length >= MAX_COMMANDS) errors.form = `You can have up to ${MAX_COMMANDS} commands. Delete one to make room.`;
  if (Object.keys(errors).length) return { ok: false, errors };

  const base = {
    id: opts.id ?? opts.makeId?.() ?? `cmd_${Math.random().toString(36).slice(2, 12)}`,
    name,
    alias,
    createdAt: opts.createdAt ?? opts.now,
    updatedAt: opts.now,
  };
  switch (draft.kind) {
    case 'quicklink':
      return { ok: true, item: { ...base, kind: 'quicklink', url, icon: cleanIcon(draft.icon) } };
    case 'snippet':
      return { ok: true, item: { ...base, kind: 'snippet', text } };
    default:
      return { ok: true, item: { ...base, kind: 'alias', target: draft.target } };
  }
}

/** The draft for "Duplicate": a copy that can be saved as it is (its alias is made unique; the name says it's a copy). */
export function duplicateDraft(c: CustomCommand, items: readonly CustomCommand[]): CommandDraft {
  const d = draftOf(c);
  const suffix = ' (copy)';
  d.name = `${c.name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
  d.alias = c.alias ? freeAlias(c.alias, items) : '';
  return d;
}

/* ───────────────────────────── anything from storage, a backup or a file ───────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

/**
 * One command from untrusted data (localStorage, a backup, an imported file): every field is checked, nothing unknown
 * rides along, and an item that can't be repaired is dropped (`null`) rather than half-kept. Alias *uniqueness* is not
 * decided here (see `repairCommands`). `makeId` supplies an id when the data has none (imports).
 */
export function sanitizeCommand(raw: unknown, opts: { now?: string; makeId?: () => string } = {}): CustomCommand | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (kind !== 'quicklink' && kind !== 'snippet' && kind !== 'alias') return null;
  const id = typeof raw.id === 'string' && raw.id.length >= 1 && raw.id.length <= 64 ? raw.id : opts.makeId?.();
  if (!id) return null;
  const now = opts.now ?? new Date().toISOString();
  const name = tidy(raw.name, NAME_MAX);
  if (!name) return null;
  const alias = typeof raw.alias === 'string' ? normalizeAlias(raw.alias) : '';
  const base = {
    id,
    name,
    alias: isValidAlias(alias) ? alias : '',
    createdAt: isStamp(raw.createdAt) ? raw.createdAt : now,
    updatedAt: isStamp(raw.updatedAt) ? raw.updatedAt : now,
  };
  if (kind === 'quicklink') {
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (url.length > URL_MAX || urlTemplateProblem(url)) return null;
    return { ...base, kind, url, icon: cleanIcon(raw.icon) };
  }
  if (kind === 'snippet') {
    const text = typeof raw.text === 'string' ? raw.text.replace(/\r\n?/g, '\n') : '';
    if (!text.trim() || text.length > SNIPPET_MAX) return null;
    return { ...base, kind, text };
  }
  if (!base.alias || !isTargetId(raw.target)) return null; // an alias command without an alias or a target is nothing
  return { ...base, kind, target: raw.target };
}

/**
 * Make a list consistent: unique ids; unique aliases (the first one keeps it — a later quicklink or snippet just loses its
 * alias, an alias command is dropped); no alias that a built-in search owns; at most `MAX_COMMANDS`.
 */
export function repairCommands(items: readonly CustomCommand[]): CustomCommand[] {
  const ids = new Set<string>();
  const aliases = new Set<string>();
  const out: CustomCommand[] = [];
  for (const c of items) {
    if (out.length >= MAX_COMMANDS) break;
    if (ids.has(c.id)) continue;
    let item = c;
    if (item.alias && (isBuiltinAlias(item.alias) || aliases.has(item.alias))) {
      if (item.kind === 'alias') continue;
      item = { ...item, alias: '' };
    }
    ids.add(item.id);
    if (item.alias) aliases.add(item.alias);
    out.push(item);
  }
  return out;
}

/** A persisted state of any age → this version's. (Older shapes kept three separate lists; today there is one.) */
export function migrateCommands(persisted: unknown, _fromVersion: number): { items: CustomCommand[] } {
  const p = isRecord(persisted) ? persisted : {};
  const legacy: Array<[string, CommandKind]> = [
    ['quicklinks', 'quicklink'],
    ['snippets', 'snippet'],
    ['aliases', 'alias'],
  ];
  const raw: unknown[] = Array.isArray(p.items)
    ? p.items
    : legacy.flatMap(([key, kind]) => (Array.isArray(p[key]) ? (p[key] as unknown[]).map((x) => (isRecord(x) ? { ...x, kind } : x)) : []));
  const items: CustomCommand[] = [];
  for (const r of raw.slice(0, IMPORT_SCAN_MAX)) {
    const c = sanitizeCommand(r);
    if (c) items.push(c);
  }
  return { items: repairCommands(items) };
}

/* ───────────────────────────── import / export ───────────────────────────── */

export const EXPORT_TYPE = 'pact-commands';

export function exportCommands(items: readonly CustomCommand[], now = new Date()): string {
  return JSON.stringify({ app: 'pact', type: EXPORT_TYPE, version: 1, exportedAt: now.toISOString(), items }, null, 2);
}

export type ParsedImport = { ok: true; items: CustomCommand[]; invalid: number } | { ok: false; error: string };

/** Read an exported file. Size-capped, tolerant of a bare array, and strict about every entry (bad ones are counted, not kept). */
export function parseImport(text: string, makeId: () => string, now = new Date().toISOString()): ParsedImport {
  if (text.length > IMPORT_MAX_BYTES)
    return { ok: false, error: `That file is too big to be a pact commands export (over ${Math.round(IMPORT_MAX_BYTES / 1024)} KB).` };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That isn’t a JSON file.' };
  }
  const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.items) ? data.items : null;
  if (!list) return { ok: false, error: 'No commands found in that file. Use a file exported from pact.' };
  const items: CustomCommand[] = [];
  let invalid = Math.max(0, list.length - IMPORT_SCAN_MAX);
  for (const raw of list.slice(0, IMPORT_SCAN_MAX)) {
    // always a fresh id: importing a file twice (or on another device) must never overwrite what is already there
    const c = sanitizeCommand(isRecord(raw) ? { ...raw, id: undefined } : raw, { now, makeId });
    if (c) items.push(c);
    else invalid++;
  }
  return { ok: true, items, invalid };
}

export type ImportReport = { added: number; duplicates: number; invalid: number; aliasDropped: number; overLimit: number };

const sameThing = (a: CustomCommand, b: CustomCommand): boolean =>
  a.kind === b.kind &&
  a.name === b.name &&
  (a.kind === 'quicklink' ? a.url === (b as Quicklink).url : a.kind === 'snippet' ? a.text === (b as Snippet).text : a.target === (b as AliasCommand).target);

/** Add imported commands to the list: ones already there are skipped, a clashing alias is dropped (alias commands are skipped), the cap holds. */
export function mergeImported(
  existing: readonly CustomCommand[],
  incoming: readonly CustomCommand[],
  invalid = 0,
): { items: CustomCommand[]; report: ImportReport } {
  const items = [...existing];
  const report: ImportReport = { added: 0, duplicates: 0, invalid, aliasDropped: 0, overLimit: 0 };
  for (const c of incoming) {
    if (items.some((x) => sameThing(x, c))) {
      report.duplicates++;
      continue;
    }
    if (items.length >= MAX_COMMANDS) {
      report.overLimit++;
      continue;
    }
    let item = c;
    if (item.alias && aliasOwner(item.alias, items)) {
      if (item.kind === 'alias') {
        report.aliasDropped++;
        continue;
      }
      item = { ...item, alias: '' };
      report.aliasDropped++;
    }
    items.push(item);
    report.added++;
  }
  return { items, report };
}

/* ───────────────────────────── ideas for an empty list ───────────────────────────── */

export type Suggestion = { id: string; draft: CommandDraft /** How you would use it, shown under the name. */; example: string };

/** (The built-in searches already cover `gh`, `maps`, `mdn`…: these do something *different* with the same sites.) */
export const SUGGESTIONS: readonly Suggestion[] = [
  {
    id: 'repo',
    example: 'repo react',
    draft: {
      ...emptyDraft('quicklink'),
      name: 'GitHub repositories',
      alias: 'repo',
      url: 'https://github.com/search?q={query}&type=repositories',
      icon: iconValue('code'),
    },
  },
  {
    id: 'dir',
    example: 'dir Central Station',
    draft: {
      ...emptyDraft('quicklink'),
      name: 'Google Maps directions',
      alias: 'dir',
      url: 'https://www.google.com/maps/dir/?api=1&destination={query}',
      icon: iconValue('map'),
    },
  },
  {
    id: 'css',
    example: 'css grid-template-columns',
    draft: {
      ...emptyDraft('quicklink'),
      name: 'MDN CSS reference',
      alias: 'css',
      url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/{query}',
      icon: iconValue('book'),
    },
  },
  {
    id: 'sig',
    example: 'sig',
    draft: { ...emptyDraft('snippet'), name: 'Email signature', alias: 'sig', text: 'Best regards,\nYour name\nyour@email.com' },
  },
  {
    id: 'today',
    example: 'today',
    draft: { ...emptyDraft('snippet'), name: 'Today’s date', alias: 'today', text: '{date}' },
  },
];

/** The suggestions that still make sense: their alias is not taken, and the same one isn't already here. */
export function availableSuggestions(items: readonly CustomCommand[]): Suggestion[] {
  return SUGGESTIONS.filter((s) => !aliasOwner(s.draft.alias, items) && !items.some((c) => c.name === s.draft.name));
}
