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
import { type Bang, bangById, bangNeedsClipboard, bangsMatching, bangUrl, parseBang, parseCustomAlias } from '@/lib/omnibox/bangs';
import { scoreFields } from '@/lib/omnibox/engine';
import { readClipboardText } from '@/lib/omnibox/templates';
import type { Answer, AnswerKind, OmniAction, OmniCtx, OmniResult, Provider } from '@/lib/omnibox/types';
import { notify } from '@/lib/toast';
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

/**
 * The address a bang opens for `rest`. A quicklink whose address holds `{clipboard}` reads the clipboard first (that needs
 * the click that got us here); when the browser refuses, the placeholder is left empty and the person is told.
 * Synchronous for everything else — the promise is already settled.
 */
export async function resolveBangUrl(bang: Bang, rest: string): Promise<string> {
  if (!bangNeedsClipboard(bang)) return bangUrl(bang, rest);
  const clip = await readClipboardText();
  if (clip === null) notify.error('Couldn’t read the clipboard', 'Allow clipboard access for pact, or copy something first.');
  return bangUrl(bang, rest, clip ?? '');
}

/** Run whatever the user typed the way the omnibox would: a bang, an address, or a web search. */
export function submitText(text: string, deps: CoreDeps = {}, opts: { newTab?: boolean } = {}): void {
  const q = text.trim();
  if (!q) return;
  const bang = parseBang(q) ?? parseCustomAlias(q);
  if (bang) {
    if (bangNeedsClipboard(bang.bang)) void resolveBangUrl(bang.bang, bang.rest).then((url) => openUrl(url, opts));
    else openUrl(bangUrl(bang.bang, bang.rest), opts);
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
    const own = parseCustomAlias(q); // the user's own quicklink alias followed by text: `jira PACT-12`
    if (own) return [bangResult(own.bang, own.rest, 'top', 1550, deps)];
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
    if (!q || parseBang(q) || parseCustomAlias(q) || resolveInput(q).kind === 'url') return [];
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
  const trigger = bang.triggers[0] ?? bang.id;
  // The user's own quicklinks read as "Open <name>" (their name is not necessarily a website: "Jira issue", "Docs").
  const own = Boolean(bang.custom);
  const title = own ? (rest ? `Open ${bang.name} with “${rest}”` : `Open ${bang.name}`) : rest ? `Search ${bang.name} for “${rest}”` : `Open ${bang.name}`;
  // Synchronous unless the address needs the clipboard (then it waits for the read).
  const withTarget = (fn: (url: string) => void) => () => {
    if (bangNeedsClipboard(bang)) void resolveBangUrl(bang, rest).then(fn);
    else fn(bangUrl(bang, rest));
  };
  return {
    id: group === 'top' ? 'top-bang' : `bang-run:${bang.id}`,
    group,
    title,
    subtitle: rest ? `!${trigger}` : scoped ? 'Start typing to search this site' : 'Press Tab, then type to search here',
    icon: Search,
    site: { url: bang.home, title: bang.name },
    emoji: own ? emojiOfIcon(bang.icon) : undefined,
    score,
    primary: {
      id: 'open',
      label: own ? `Open ${bang.name}` : rest ? `Search ${bang.name}` : `Open ${bang.name}`,
      icon: ExternalLink,
      run: withTarget((url) => {
        openUrl(url);
        if (rest) deps.recordSearch?.(`!${trigger} ${rest}`);
      }),
    },
    actions: [
      { id: 'open-new-tab', label: 'Open in new tab', icon: ExternalLink, hotkey: 'mod+enter', run: withTarget((url) => openUrl(url, { newTab: true })) },
      {
        id: 'copy-link',
        label: 'Copy link',
        icon: Copy,
        hotkey: 'mod+c',
        record: false,
        run: withTarget((url) => void copyKeepingFocus(url, 'Link copied')),
      },
    ],
    frecencyKey: `bang:${bang.id}`,
  };
}

/** `emoji:🍵` → `🍵` (a custom quicklink's icon), otherwise nothing. */
const emojiOfIcon = (icon?: string): string | undefined => (icon?.startsWith('emoji:') ? icon.slice('emoji:'.length) || undefined : undefined);

/** While a bang chip is active the box searches that one site and nothing else. */
export function scopeProvider(deps: CoreDeps = {}): Provider {
  return (q, ctx) => {
    const bang = ctx.scope ? bangById(ctx.scope) : undefined;
    if (!bang) return [];
    return [bangResult(bang, q, 'top', 1000, deps, true)];
  };
}
