import { bestMatch } from '@/lib/fuzzy';
import { usageBoost } from '@/lib/omnibox/frecency';
import {
  GROUP_LABEL,
  GROUPS,
  type Group,
  type OmniCtx,
  type OmniResult,
  type OmniSection,
  type OmniView,
  type Provider,
  type Usage,
} from '@/lib/omnibox/types';

/* ───────────────────────────── extension point ─────────────────────────────
   Any feature can add results to the omnibox: register a provider (a pure-ish function of the query) and it shows
   up in both the ⌘K palette and the Home search box. A provider must be fast (it runs on every keystroke), return
   `score: 0` or nothing for what doesn't match, and may use `scoreFields()` to rank by the same fuzzy rules.

     const off = registerProvider('quick-capture', (query, ctx) => query.startsWith('+') ? [ … ] : []);
     // later: off();
*/
const registry = new Map<string, Provider>();

/** Add (or replace) a provider. Returns a function that removes it again. */
export function registerProvider(id: string, provider: Provider): () => void {
  registry.set(id, provider);
  return () => {
    if (registry.get(id) === provider) registry.delete(id);
  };
}

export const registeredProviders = (): Provider[] => [...registry.values()];

/** Fuzzy-rank `title` (and weaker `extra` fields) against `query`: the score plus which title characters matched. */
export function scoreFields(query: string, title: string, extra: Array<string | undefined> = []): { score: number; matches: number[] } {
  const m = bestMatch(query, [title, ...extra]);
  return { score: m.score, matches: m.indices };
}

export type EngineOptions = {
  /** Most results shown per group (default 6). */
  caps?: Partial<Record<Group, number>>;
  defaultCap?: number;
  /** Hard limit across all groups. */
  maxTotal?: number;
  /** A small button at the right of a section header (Recent → "Clear"). */
  sectionActions?: Partial<Record<Group, { label: string; run: () => void }>>;
  /** With an empty box, promote what the user picked before into a "Recent" section (the palette does; Home shows search history). */
  recentFromUsage?: boolean;
  /**
   * The user's aliases for built-in results: alias → result ids (`{ t: ['page:timer'] }`). Typing exactly an alias makes
   * that result the Top hit (providers are told through `ctx.aliased`, so it is offered even when the text would not
   * match it); an aliased result always shows its alias as `hint`.
   */
  aliases?: Readonly<Record<string, readonly string[]>>;
};

/** Score an aliased result gets when its alias is typed in full: above a plain match, below the answer / a typed `!bang` / an address. */
export const ALIAS_SCORE = 1450;

/** Browsing order (empty box). */
const EMPTY_ORDER: readonly Group[] = ['pinned', 'recent', 'suggestions', 'pages', 'actions', 'tools', 'commands', 'shortcuts', 'notes', 'tasks', 'chats'];
/** Groups whose members make sense as "recent" / "pinned" shortcuts. */
const PROMOTABLE: ReadonlySet<Group> = new Set(['pages', 'actions', 'tools', 'commands', 'notes', 'tasks', 'chats', 'shortcuts']);

const keyOf = (r: OmniResult): string | null => (r.frecencyKey === undefined ? r.id : r.frecencyKey);
const orderOf = (g: Group) => GROUPS.indexOf(g);

/**
 * Run every provider and turn their results into what the UI shows:
 *   1. collect (a throwing provider is skipped, duplicate ids keep the better score),
 *   2. boost by frecency/pins (bounded, so a habit never beats a clearly better match),
 *   3. group: Answer → Top hit → the rest (best-matching group first) → Web; with an empty box the browsing order,
 *      with pinned and recently used things promoted,
 *   4. cap each group, and work out the inline completion ("ghost") for Tab.
 */
export function runOmnibox(rawQuery: string, ctx: OmniCtx, providers: readonly Provider[], usage: Usage, opts: EngineOptions = {}): OmniView {
  const q = rawQuery.trim();
  const now = ctx.now.getTime();

  // The user's aliases: which result ids the typed text names exactly, and which alias to show on each aliased result.
  const aliasOf = new Map<string, string>();
  for (const [alias, ids] of Object.entries(opts.aliases ?? {})) for (const id of ids) if (!aliasOf.has(id)) aliasOf.set(id, alias);
  const typed = opts.aliases && q ? opts.aliases[q.toLowerCase()] : undefined;
  const aliased = typed?.length ? new Set(typed) : undefined;
  const pctx: OmniCtx = aliased ? { ...ctx, aliased } : ctx;

  const collected = new Map<string, OmniResult>();
  for (const provider of providers) {
    let out: OmniResult[];
    try {
      out = provider(q, pctx);
    } catch {
      continue; // one broken provider must never take the whole box down
    }
    for (const r0 of out) {
      let r = r0;
      const alias = aliasOf.get(r.id);
      if (alias && !r.hint) r = { ...r, hint: alias };
      if (aliased?.has(r.id)) {
        // typing the alias in full: this result is the Top hit (it falls back to its own group if something outranks it)
        r = { ...r, score: Math.max(r.score, ALIAS_SCORE), demoteTo: r.group === 'top' ? r.demoteTo : r.group, group: 'top' };
      }
      if (!(r.score > 0)) continue;
      const prev = collected.get(r.id);
      if (!prev || prev.score < r.score) collected.set(r.id, r);
    }
  }

  let results = [...collected.values()].map((r) => {
    const key = keyOf(r);
    if (key === null) return r;
    const bonus = usageBoost(usage, key, r.score, now);
    return bonus > 0 ? { ...r, score: r.score + bonus } : r;
  });

  // One Top hit: the best `top` result keeps the slot; the others move to their fallback group (or are dropped).
  const tops = results.filter((r) => r.group === 'top').sort((a, b) => b.score - a.score);
  if (tops.length > 1) {
    const lost = new Set(tops.slice(1));
    results = results.flatMap((r) => (!lost.has(r) ? [r] : r.demoteTo ? [{ ...r, group: r.demoteTo, demoteTo: undefined }] : []));
  }

  const cap = (g: Group) => opts.caps?.[g] ?? (g === 'answer' || g === 'top' ? 1 : (opts.defaultCap ?? 6));
  const buckets = new Map<Group, OmniResult[]>();
  const put = (r: OmniResult) => {
    const list = buckets.get(r.group) ?? [];
    list.push(r);
    buckets.set(r.group, list);
  };

  if (!q) {
    const pinnedResults: OmniResult[] = [];
    const taken = new Set<string>();
    for (const key of usage.pinned) {
      const hit = results.find((r) => PROMOTABLE.has(r.group) && keyOf(r) === key && !r.locked);
      if (hit && !taken.has(hit.id)) {
        taken.add(hit.id);
        pinnedResults.push({ ...hit, id: `pinned:${hit.id}`, group: 'pinned', frecencyKey: key });
      }
    }
    const recentResults: OmniResult[] = [];
    if (opts.recentFromUsage) {
      const used = results
        .filter((r) => PROMOTABLE.has(r.group) && !r.locked && !taken.has(r.id))
        .map((r) => ({ r, t: usage.entries[keyOf(r) ?? '']?.t ?? 0 }))
        .filter((x) => x.t > 0)
        .sort((a, b) => b.t - a.t)
        .slice(0, cap('recent'));
      for (const { r } of used) {
        taken.add(r.id);
        recentResults.push({ ...r, id: `recent:${r.id}`, group: 'recent', frecencyKey: keyOf(r) });
      }
    }
    for (const r of pinnedResults) put(r);
    for (const r of results) if (!taken.has(r.id)) put(r);
    for (const r of recentResults) put(r);
    results = [...buckets.values()].flat();
  } else {
    for (const r of results) put(r);
  }

  // Recent and pinned keep their own order (most recent first / the order they were pinned in); the rest rank by score.
  for (const [g, list] of buckets) {
    if (q || (g !== 'recent' && g !== 'pinned')) list.sort((a, b) => b.score - a.score);
  }

  const best = (g: Group) => buckets.get(g)?.[0]?.score ?? 0;
  const names = [...buckets.keys()];
  const order = q
    ? names.sort((a, b) => {
        const rank = (g: Group) => (g === 'answer' ? 0 : g === 'top' ? 1 : g === 'web' ? 3 : 2);
        return rank(a) - rank(b) || best(b) - best(a) || orderOf(a) - orderOf(b);
      })
    : names.sort((a, b) => EMPTY_ORDER.indexOf(a) - EMPTY_ORDER.indexOf(b));

  let budget = opts.maxTotal ?? Number.POSITIVE_INFINITY;
  const sections: OmniSection[] = [];
  for (const g of order) {
    const list = (buckets.get(g) ?? []).slice(0, Math.min(cap(g), budget));
    if (!list.length) continue;
    budget -= list.length;
    sections.push({ id: g, title: GROUP_LABEL[g], results: list, headerAction: opts.sectionActions?.[g] });
  }

  const flat = sections.flatMap((s) => s.results);
  return { query: q, sections, results: flat, ghost: ghostFor(rawQuery, flat) };
}

/**
 * Inline completion. Only the top-scoring result that *extends* what was typed qualifies, two or more characters
 * have to be typed, and a trailing space means "I'm moving on" — no ghost.
 *
 * Tab precedence (the footer shows whichever applies):
 *   1. the input is a bang (`!yt …`, `yt`/`gh` typed in full, or one of the user's own quicklink aliases — bare, with
 *      `!`, or followed by text: `gh react`)                      → it becomes a chip (the user's quicklinks join the
 *                                                                  built-in table; a built-in trigger always wins),
 *   2. a ghost is showing                                         → accept it (a bang ghost becomes a chip),
 *   3. otherwise                                                  → Tab keeps its normal job and moves focus on.
 */
export function ghostFor(rawQuery: string, results: readonly OmniResult[]): OmniView['ghost'] {
  const typed = rawQuery.replace(/^\s+/, '');
  if (typed.length < 2 || /\s$/.test(typed)) return null;
  const lower = typed.toLowerCase();
  let best: OmniResult | undefined;
  for (const r of results) {
    const c = r.completion;
    if (!c || c.text.length <= typed.length || !c.text.toLowerCase().startsWith(lower)) continue;
    if (!best || r.score > best.score) best = r;
  }
  return best?.completion ? { text: best.completion.text, resultId: best.id, scope: best.completion.scope } : null;
}
