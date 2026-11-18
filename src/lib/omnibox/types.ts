import type { LucideIcon } from 'lucide-react';

/** Where the omnibox is shown: the inline box on Home, or the ⌘K palette. */
export type Surface = 'home' | 'palette';

/**
 * Result groups. The order here is the fallback display order; the engine moves a group up when it holds the best
 * match, keeps `answer` and `top` first and `web` last.
 */
export const GROUPS = [
  'answer',
  'top',
  'pinned',
  'recent',
  'suggestions',
  'pages',
  'actions',
  'tools',
  'commands',
  'notes',
  'tasks',
  'chats',
  'shortcuts',
  'web',
] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABEL: Record<Group, string> = {
  answer: 'Answer',
  top: 'Top hit',
  pinned: 'Pinned',
  recent: 'Recent',
  suggestions: 'Suggestions',
  pages: 'Pages',
  actions: 'Actions',
  tools: 'Tools',
  commands: 'Your commands',
  notes: 'Notes',
  tasks: 'Tasks',
  chats: 'Chats',
  shortcuts: 'Shortcuts',
  web: 'Web',
};

/** Something the user can do with a result: the primary one runs on ↵, the rest live in the action panel (⌘/ or →). */
export type OmniAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Key combo that runs it while the omnibox has focus, in `useHotkeys` notation: `mod+enter`, `mod+c`. */
  hotkey?: string;
  run: () => void | Promise<void>;
  /** Leave the omnibox open afterwards (copy, re-roll…). */
  keepOpen?: boolean;
  /** Close after this many ms instead of right away — long enough for a "Copied" animation to land. */
  closeDelay?: number;
  /** Picking it does not count towards frecency (remove / pin / copy-the-expression). Defaults to counting. */
  record?: boolean;
  destructive?: boolean;
  /** After running, flash this feedback on the row ("Copied" on an answer card). */
  feedback?: 'copied';
  /** Instead of running: turn the box into a chip for this bang (`youtube`). */
  scope?: string;
  /** Instead of running: put this text in the box (a suggestion the user can try). */
  fill?: string;
};

export type AnswerKind = 'math' | 'convert' | 'date' | 'time' | 'color' | 'random' | 'encode' | 'intent';

export type AnswerRow = { label: string; value: string; copy?: string };

/** An inline answer (calculator, conversion, colour…) shown as a card at the top of the results. */
export type Answer = {
  kind: AnswerKind;
  /** What was asked, small. */
  expression: string;
  /** The big result. */
  value: string;
  /** What ↵ / ⌘C copies. Empty for answers that do something instead (timer). */
  copy: string;
  caption?: string;
  rows?: AnswerRow[];
  /** A CSS colour for the swatch (colour answers). */
  swatch?: string;
  /** Monospaced result (ids, passwords, encodings). */
  mono?: boolean;
  /** Can be rolled again. */
  reroll?: boolean;
  /** What ↵ does when it isn't "copy" (e.g. "Start timer"). */
  cta?: string;
};

export type OmniResult = {
  /** Stable across keystrokes: React key, shared-layout id and frecency key all derive from it. */
  id: string;
  group: Group;
  title: string;
  subtitle?: string;
  /** Extra words the search matches (not shown). */
  keywords?: string;
  icon: LucideIcon;
  /** Show this emoji in the icon tile instead of `icon` (a custom command the user gave an emoji). */
  emoji?: string;
  /** Use a site's brand mark / favicon instead of `icon`. */
  site?: { url: string; title?: string };
  /** Right-aligned alias the user gave this result (`gh`): typing it finds the result. The engine fills it in for aliased built-ins. */
  hint?: string;
  /** Base relevance: ~1000 exact … 10 weak … 0 = hidden. The engine adds frecency and pin boosts. */
  score: number;
  /** Positions of `title` that matched the query — filled by `scoreFields`. */
  matches?: number[];
  /** Key hints for the row (`['G','N']`). */
  kbd?: string[];
  /** Runs on ↵. */
  primary: OmniAction;
  /** The action panel's other entries (a generic "Pin" is appended by the engine). */
  actions?: OmniAction[];
  answer?: Answer;
  /** Greyed-out hint for results that need an account the user doesn't have. */
  locked?: boolean;
  /** Frecency key; defaults to `id`, `null` opts out (answers, the web fallback). */
  frecencyKey?: string | null;
  /** Inline completion offered by Tab (`youtube`); `scope` turns it into a bang chip instead. */
  completion?: { text: string; scope?: string };
  /** If a better `top` hit takes the single Top hit slot, this one moves to this group instead of disappearing. */
  demoteTo?: Group;
  /** A recent-search row the user can remove with its ✕. */
  removable?: () => void;
};

export type Provider = (query: string, ctx: OmniCtx) => OmniResult[];

export type OmniCtx = {
  surface: Surface;
  now: Date;
  /** BCP-47 locale for number/date formatting; undefined = the browser's. */
  locale?: string;
  signedIn: boolean;
  /** Ask the host to recompute (after a re-roll). */
  refresh: () => void;
  /** The bang the user Tab-ed into (the chip). When set, only that site's search is offered. */
  scope: string | null;
  /** Frecency keys the user pinned: with an empty box, providers should include these even if they would otherwise stay quiet. */
  pinned: readonly string[];
  /**
   * Result ids the user aliased to exactly what is typed (alias `t` → `page:timer`). Set by the engine from
   * `EngineOptions.aliases`; a provider must return these results even if the text would not otherwise match them.
   */
  aliased?: ReadonlySet<string>;
};

export type OmniSection = {
  id: Group;
  title: string;
  results: OmniResult[];
  /** A small text button at the right of the header ("Clear"). */
  headerAction?: { label: string; run: () => void };
};

export type OmniView = {
  query: string;
  sections: OmniSection[];
  /** Every result in display order — the keyboard's view of the list. */
  results: OmniResult[];
  /** The top fuzzy match as inline completion for `query`, if any (precedence rules in `engine.ts`). */
  ghost: { text: string; resultId: string; scope?: string } | null;
};

/** Persisted usage of results the user picked — drives frecency and pins. */
export type UsageEntry = { n: number; t: number };
export type Usage = { entries: Record<string, UsageEntry>; pinned: string[] };
