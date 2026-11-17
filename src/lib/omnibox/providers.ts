import {
  Braces,
  Calculator,
  CalendarDays,
  Clock,
  Copy,
  Dices,
  ExternalLink,
  Globe,
  type LucideIcon,
  Palette,
  RefreshCw,
  Ruler,
  Search,
  Timer,
} from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { openUrl, webSearch } from '@/lib/ext';
import { type Computed, computeAnswer } from '@/lib/omnibox/answers';
import { BANG_BY_ID, type Bang, bangsMatching, bangUrl, parseBang } from '@/lib/omnibox/bangs';
import { scoreFields } from '@/lib/omnibox/engine';
import type { Answer, AnswerKind, OmniAction, OmniCtx, OmniResult, Provider } from '@/lib/omnibox/types';
import { hostnameOf, resolveInput } from '@/lib/url';

/** What the host app lends to the built-in providers (so this module never imports a feature store). */
export type CoreDeps = {
  /** Remember a search in the user's recent searches. */
  recordSearch?: (query: string) => void;
  /** Open a tool page for an answer ("Open in Calculator"). Leave out for guests — the Tools pages need an account. */
  openTool?: (toolId: string) => void;
};

export const ANSWER_ICON: Record<AnswerKind, LucideIcon> = {
  math: Calculator,
  convert: Ruler,
  date: CalendarDays,
  time: Clock,
  color: Palette,
  random: Dices,
  encode: Braces,
  intent: Timer,
};

const TOOL_NAME: Record<string, string> = {
  calc: 'Calculator',
  convert: 'Unit converter',
  color: 'Colour & contrast',
  encode: 'Encode & format',
  password: 'Password & IDs',
  random: 'Dice, coin & picker',
};

function toolFor(a: Answer): string | null {
  switch (a.kind) {
    case 'math':
      return 'calc';
    case 'convert':
      return 'convert';
    case 'color':
      return 'color';
    case 'encode':
      return 'encode';
    case 'random':
      return /^(?:UUID|Password)/.test(a.expression) ? 'password' : 'random';
    default:
      return null;
  }
}

/**
 * Copy to the clipboard without disturbing the box: when the Clipboard API refuses (no permission, page not
 * focused) `copyText` falls back to a hidden textarea, which steals focus and would collapse the Home dropdown.
 */
export async function copyKeepingFocus(text: string, label?: string): Promise<void> {
  const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await copyText(text, label);
  if (el && document.activeElement !== el) el.focus({ preventScroll: true });
}

/** The ↵ / ⌘↵ / ⌘C trio every link-like result shares. */
export function linkActions(url: string, label = 'Open'): { primary: OmniAction; actions: OmniAction[] } {
  return {
    primary: { id: 'open', label, icon: ExternalLink, run: () => openUrl(url) },
    actions: [
      { id: 'open-new-tab', label: `${label} in new tab`, icon: ExternalLink, hotkey: 'mod+enter', run: () => openUrl(url, { newTab: true }) },
      { id: 'copy-link', label: 'Copy link', icon: Copy, hotkey: 'mod+c', record: false, run: () => void copyKeepingFocus(url, 'Link copied') },
    ],
  };
}

/** Run whatever the user typed the way the omnibox would: a bang, an address, or a web search. */
export function submitText(text: string, deps: CoreDeps = {}, opts: { newTab?: boolean } = {}): void {
  const q = text.trim();
  if (!q) return;
  const bang = parseBang(q);
  if (bang) {
    openUrl(bangUrl(bang.bang, bang.rest), opts);
    if (bang.rest) deps.recordSearch?.(q);
    return;
  }
  const r = resolveInput(q);
  if (r.kind === 'url') openUrl(r.url, opts);
  else {
    deps.recordSearch?.(r.query);
    void webSearch(r.query, opts);
  }
}

/** The answer card for calculators, conversions, dates, colours, random things and encoders. */
export function answerResult(c: Computed | null, ctx: OmniCtx, deps: CoreDeps, query: string): OmniResult | null {
  if (c?.type !== 'answer') return null;
  const a = c.answer;
  const home = ctx.surface === 'home';
  const copy: OmniAction = {
    id: 'copy',
    label: 'Copy result',
    icon: Copy,
    hotkey: 'mod+c',
    feedback: 'copied',
    keepOpen: home,
    closeDelay: home ? undefined : 700,
    record: false,
    run: () => void copyKeepingFocus(a.copy, ''),
  };
  const actions: OmniAction[] = [];
  if (a.expression && a.expression !== a.copy) {
    actions.push({
      id: 'copy-expression',
      label: 'Copy expression',
      icon: Copy,
      record: false,
      run: () => void copyKeepingFocus(a.expression, 'Expression copied'),
    });
  }
  for (const row of (a.rows ?? []).slice(0, 6)) {
    if (!row.copy) continue;
    actions.push({
      id: `copy-${row.label}`,
      label: `Copy ${row.label}`,
      icon: Copy,
      record: false,
      run: () => void copyKeepingFocus(row.copy ?? '', `${row.label} copied`),
    });
  }
  if (a.reroll) actions.push({ id: 'reroll', label: 'Roll again', icon: RefreshCw, keepOpen: true, record: false, run: () => ctx.refresh() });
  const tool = toolFor(a);
  if (tool && deps.openTool)
    actions.push({ id: 'open-tool', label: `Open in ${TOOL_NAME[tool] ?? 'Tools'}`, icon: ExternalLink, run: () => deps.openTool?.(tool) });
  actions.push({ id: 'search-web', label: 'Search the web instead', icon: Search, record: false, run: () => submitText(query, deps) });

  return {
    id: 'answer',
    group: 'answer',
    title: a.value,
    subtitle: a.expression,
    icon: ANSWER_ICON[a.kind],
    score: 5000,
    answer: a,
    primary: copy,
    actions,
    frecencyKey: null,
  };
}

export function coreProviders(deps: CoreDeps = {}): Provider[] {
  const answers: Provider = (q, ctx) => {
    const r = answerResult(computeAnswer(q, { now: ctx.now, locale: ctx.locale }), ctx, deps, q);
    return r ? [r] : [];
  };

  const url: Provider = (q) => {
    const r = resolveInput(q);
    if (r.kind !== 'url') return [];
    const shown = r.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const { primary, actions } = linkActions(r.url, 'Open');
    return [
      {
        id: 'top-url',
        group: 'top',
        title: `Open ${shown}`,
        subtitle: 'Go to address',
        icon: Globe,
        site: /^https?:/.test(r.url) ? { url: r.url, title: hostnameOf(r.url) } : undefined,
        score: 1500,
        primary,
        actions,
        frecencyKey: null,
      },
    ];
  };

  const bangs: Provider = (q) => {
    const parsed = parseBang(q);
    if (parsed) return [bangResult(parsed.bang, parsed.rest, 'top', 1600, deps)];
    const bare = q.toLowerCase();
    const prefix = bare.startsWith('!') ? bare.slice(1) : bare;
    if (!prefix || /\s/.test(prefix) || (!bare.startsWith('!') && prefix.length < 2)) return [];
    const out: OmniResult[] = [];
    for (const bang of bangsMatching(prefix).slice(0, bare.startsWith('!') ? 8 : 3)) {
      const trigger = bang.triggers.find((t) => t.startsWith(prefix)) ?? bang.triggers[0] ?? bang.id;
      const exact = bang.triggers.includes(prefix);
      const starts = bang.triggers.some((t) => t.startsWith(prefix)) || bang.name.toLowerCase().startsWith(prefix);
      const { score } = scoreFields(prefix, bang.triggers.join(' '), [bang.name]);
      out.push({
        id: `bang:${bang.id}`,
        group: 'web',
        title: `Search ${bang.name}`,
        subtitle: `Tab to search from here · !${bang.triggers[0]}`,
        keywords: bang.triggers.join(' '),
        icon: Search,
        site: { url: bang.home, title: bang.name },
        // a bang you are typing the start of outranks a same-named shortcut for the inline completion, so one Tab makes the chip
        score: exact ? 950 : starts ? 920 : Math.max(300, score),
        primary: { id: 'scope', label: `Search ${bang.name}`, icon: Search, scope: bang.id, run: () => {} },
        actions: [{ id: 'open-site', label: `Open ${bang.name}`, icon: ExternalLink, run: () => openUrl(bang.home) }],
        completion: { text: bare.startsWith('!') ? `!${trigger}` : trigger, scope: bang.id },
        frecencyKey: `bang:${bang.id}`,
      });
    }
    return out;
  };

  const web: Provider = (q, ctx) => {
    if (!q || parseBang(q) || resolveInput(q).kind === 'url') return [];
    const home = ctx.surface === 'home';
    return [
      {
        id: 'web-search',
        group: home ? 'top' : 'web',
        demoteTo: 'web',
        title: `Search the web for “${q}”`,
        subtitle: home ? 'Uses your default search engine' : undefined,
        icon: Search,
        score: home ? 100 : 1,
        primary: { id: 'search', label: 'Search the web', icon: Search, run: () => submitText(q, deps) },
        actions: [
          { id: 'search-new-tab', label: 'Search in new tab', icon: ExternalLink, hotkey: 'mod+enter', run: () => submitText(q, deps, { newTab: true }) },
          { id: 'copy-query', label: 'Copy search text', icon: Copy, hotkey: 'mod+c', record: false, run: () => void copyKeepingFocus(q, 'Copied') },
        ],
        frecencyKey: null,
      },
    ];
  };

  return [answers, url, bangs, web];
}

function bangResult(bang: Bang, rest: string, group: OmniResult['group'], score: number, deps: CoreDeps, scoped = false): OmniResult {
  const target = bangUrl(bang, rest);
  const trigger = bang.triggers[0] ?? bang.id;
  return {
    id: group === 'top' ? 'top-bang' : `bang-run:${bang.id}`,
    group,
    title: rest ? `Search ${bang.name} for “${rest}”` : `Open ${bang.name}`,
    subtitle: rest ? `!${trigger}` : scoped ? 'Start typing to search this site' : 'Press Tab, then type to search here',
    icon: Search,
    site: { url: bang.home, title: bang.name },
    score,
    primary: {
      id: 'open',
      label: rest ? `Search ${bang.name}` : `Open ${bang.name}`,
      icon: ExternalLink,
      run: () => {
        openUrl(target);
        if (rest) deps.recordSearch?.(`!${trigger} ${rest}`);
      },
    },
    actions: [
      { id: 'open-new-tab', label: 'Open in new tab', icon: ExternalLink, hotkey: 'mod+enter', run: () => openUrl(target, { newTab: true }) },
      { id: 'copy-link', label: 'Copy link', icon: Copy, hotkey: 'mod+c', record: false, run: () => void copyKeepingFocus(target, 'Link copied') },
    ],
    frecencyKey: `bang:${bang.id}`,
  };
}

/** While a bang chip is active the box searches that one site and nothing else. */
export function scopeProvider(deps: CoreDeps = {}): Provider {
  return (q, ctx) => {
    const bang = ctx.scope ? BANG_BY_ID[ctx.scope] : undefined;
    if (!bang) return [];
    return [bangResult(bang, q, 'top', 1000, deps, true)];
  };
}
