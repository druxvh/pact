import { Pin, PinOff, X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildProviders, type SiteLink } from '@/app/paletteSources';
import { aliasIndex } from '@/features/commands/model';
import { useCommandsStore } from '@/features/commands/store';
import { useHomeStore } from '@/features/home/store';
import { getTopSites } from '@/lib/ext';
import { IS_MAC, MOD_KEY } from '@/lib/hotkeys';
import { type Bang, bangById, chipFor } from '@/lib/omnibox/bangs';
import { type EngineOptions, registeredProviders, runOmnibox } from '@/lib/omnibox/engine';
import { hotkeyCaps, matchesHotkey } from '@/lib/omnibox/keys';
import { scopeProvider, submitText } from '@/lib/omnibox/providers';
import { useOmniStore } from '@/lib/omnibox/store';
import type { Group, OmniAction, OmniResult, OmniView, Surface } from '@/lib/omnibox/types';
import { hostnameOf } from '@/lib/url';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';

const ENGINE: Record<Surface, EngineOptions> = {
  home: {
    defaultCap: 3,
    caps: { shortcuts: 4, recent: 5, suggestions: 4, commands: 4, notes: 3, tasks: 3 },
    maxTotal: 10,
  },
  palette: { defaultCap: 6, caps: { recent: 5, pinned: 8 }, maxTotal: 40, recentFromUsage: true },
};

export type FooterHint = { keys: string[]; label: string /** Makes the hint clickable (the footer's "Actions" opens the action panel). */; run?: () => void };

/** Everything both surfaces share: the query + chip, the ranked results, the keyboard, the action panel. */
export type Omnibox = ReturnType<typeof useOmnibox>;

let topSitesCache: SiteLink[] | undefined;

/** The palette has no Home layout to borrow shortcuts from: pinned shortcuts plus most-visited sites, fetched once. */
function usePaletteLinks(enabled: boolean): SiteLink[] {
  const pinned = useHomeStore((s) => s.pinned);
  const hidden = useHomeStore((s) => s.hiddenHosts);
  const [top, setTop] = useState<SiteLink[]>(topSitesCache ?? []);
  useEffect(() => {
    if (!enabled || topSitesCache) return;
    let live = true;
    void getTopSites().then((sites) => {
      topSitesCache = sites.map((s) => ({ id: `top-${hostnameOf(s.url)}`, title: s.title || hostnameOf(s.url), url: s.url }));
      if (live) setTop(topSitesCache);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return useMemo(() => [...pinned, ...top.filter((t) => !hidden.includes(hostnameOf(t.url)))], [pinned, top, hidden]);
}

/** Results that make sense to keep at the top of an empty box. */
const PINNABLE: ReadonlySet<Group> = new Set(['pages', 'actions', 'tools', 'commands', 'notes', 'tasks', 'chats', 'shortcuts', 'pinned', 'recent']);

/** ⌘/ (Ctrl+/) — the actions panel. On layouts where `/` needs Shift the key is still `/`; `code` covers the rest. */
const isActionsKey = (e: { key: string; code: string; altKey: boolean }, mod: boolean) => mod && !e.altKey && (e.key === '/' || e.code === 'Slash');

/** An action that throws or rejects must never leave the box half-open; the failure is logged, not swallowed silently. */
function runSafely(action: OmniAction): void {
  try {
    void Promise.resolve(action.run()).catch((e) => console.error(`omnibox action “${action.id}” failed`, e));
  } catch (e) {
    console.error(`omnibox action “${action.id}” failed`, e);
  }
}

const keyOf = (r: OmniResult) => (r.frecencyKey === undefined ? r.id : r.frecencyKey);

/** Rows get an `id` that is safe in the DOM and in `aria-activedescendant`. */
const domId = (prefix: string, id: string) => `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

export function useOmnibox({ surface, links, active, onDone }: { surface: Surface; links?: readonly SiteLink[]; active: boolean; onDone: () => void }) {
  const signedIn = useAuthStore(selectSignedIn);
  const recent = useHomeStore((s) => s.recent);
  const pushRecent = useHomeStore((s) => s.pushRecent);
  const removeRecent = useHomeStore((s) => s.removeRecent);
  const clearRecent = useHomeStore((s) => s.clearRecent);
  const entries = useOmniStore((s) => s.entries);
  const pinned = useOmniStore((s) => s.pinned);
  const commands = useCommandsStore((s) => s.items);
  const paletteLinks = usePaletteLinks(surface === 'palette' && active);
  const siteLinks = links ?? paletteLinks;

  const [query, setQueryState] = useState('');
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [index, setIndex] = useState(surface === 'home' ? -1 : 0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelIndex, setPanelIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const copiedTimer = useRef<number | undefined>(undefined);
  const doneTimer = useRef<number | undefined>(undefined);

  const scope: Bang | null = scopeId ? (bangById(scopeId) ?? null) : null;
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const providers = useMemo(
    () =>
      scope
        ? [scopeProvider({ recordSearch: pushRecent })]
        : [...buildProviders({ surface, signedIn, links: siteLinks, recent, removeRecent, recordSearch: pushRecent }), ...registeredProviders()],
    [scope, surface, signedIn, siteLinks, recent, removeRecent, pushRecent],
  );

  const engineOpts = useMemo<EngineOptions>(
    () => ({
      ...ENGINE[surface],
      sectionActions: surface === 'home' ? { recent: { label: 'Clear', run: clearRecent } } : undefined,
      aliases: aliasIndex(commands),
    }),
    [surface, clearRecent, commands],
  );

  // `nonce` is deliberately a dependency: bumping it re-runs the providers (a new dice roll) for the same text.
  // `active` is a dependency too: opening the box re-reads notes/tasks/etc. that changed while it was closed. The view is
  // never blanked on close, so the exit animation fades the list the user was looking at.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const view = useMemo<OmniView>(() => {
    return runOmnibox(query, { surface, now: new Date(), signedIn, refresh, scope: scopeId, pinned }, providers, { entries, pinned }, engineOpts);
  }, [active, query, surface, signedIn, refresh, scopeId, providers, entries, pinned, engineOpts, nonce]);

  const results = view.results;
  const selected: OmniResult | undefined = results[index];
  const defaultIndex = surface === 'home' && !query.trim() && !scope ? -1 : 0;

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      setPanelOpen(false);
      setIndex(surface === 'home' && !q.trim() && !scopeId ? -1 : 0);
    },
    [surface, scopeId],
  );

  // keep the highlight on a real row when the list shrinks under it (a recent search was removed)
  useEffect(() => {
    setIndex((i) => (results.length === 0 ? defaultIndex : Math.min(i, results.length - 1)));
  }, [results.length, defaultIndex]);

  useEffect(
    () => () => {
      window.clearTimeout(copiedTimer.current);
      window.clearTimeout(doneTimer.current);
    },
    [],
  );

  const reset = useCallback(() => {
    setQueryState('');
    setScopeId(null);
    setIndex(surface === 'home' ? -1 : 0);
    setPanelOpen(false);
    setCopiedId(null);
  }, [surface]);

  /** The panel's list: the primary action first, then the result's own, then pin / remove. */
  const actionsFor = useCallback(
    (r: OmniResult | undefined): OmniAction[] => {
      if (!r) return [];
      const out: OmniAction[] = [r.primary, ...(r.actions ?? [])];
      const key = keyOf(r);
      const store = useOmniStore.getState();
      if (r.removable)
        out.push({ id: 'remove-recent', label: 'Remove from recent searches', icon: X, destructive: true, keepOpen: true, record: false, run: r.removable });
      if (key !== null && PINNABLE.has(r.group) && !r.locked) {
        const isPinned = pinned.includes(key);
        out.push({
          id: 'pin',
          label: isPinned ? 'Unpin' : 'Pin',
          icon: isPinned ? PinOff : Pin,
          keepOpen: true,
          record: false,
          run: () => store.togglePin(key),
        });
        if (entries[key] && r.group === 'recent')
          out.push({ id: 'forget', label: 'Remove from recent', icon: X, destructive: true, keepOpen: true, record: false, run: () => store.forget(key) });
      }
      return out;
    },
    [pinned, entries],
  );

  const panelActions = useMemo(() => (panelOpen ? actionsFor(selected) : []), [panelOpen, selected, actionsFor]);

  const flashCopied = useCallback((id: string) => {
    setCopiedId(id);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const execute = useCallback(
    (result: OmniResult, action: OmniAction) => {
      setPanelOpen(false);
      if (action.scope) {
        setScopeId(action.scope);
        setQueryState('');
        setIndex(0);
        return;
      }
      if (action.fill !== undefined) {
        setQuery(action.fill);
        return;
      }
      const key = keyOf(result);
      if (action.record !== false && key !== null) useOmniStore.getState().record(key);
      if (action.feedback === 'copied') flashCopied(result.id);
      // Home starts over (empty box, unfocused); the palette resets itself when it next opens, so its exit stays intact.
      const finish = () => {
        if (surface === 'home') reset();
        onDone();
      };
      if (action.keepOpen) {
        runSafely(action);
        return;
      }
      if (action.closeDelay) {
        runSafely(action);
        window.clearTimeout(doneTimer.current);
        doneTimer.current = window.setTimeout(finish, action.closeDelay);
        return;
      }
      // Palette: close first so the dialog hands focus back, then act. Home: act, then collapse.
      if (surface === 'palette') {
        finish();
        window.setTimeout(() => runSafely(action), 0);
      } else {
        runSafely(action);
        finish();
      }
    },
    [flashCopied, onDone, reset, setQuery, surface],
  );

  const activate = useCallback(
    (result: OmniResult | undefined) => {
      if (result) execute(result, result.primary);
      else if (query.trim()) {
        submitText(query, { recordSearch: pushRecent });
        if (surface === 'home') reset();
        onDone();
      }
    },
    [execute, onDone, pushRecent, query, reset, surface],
  );

  const openPanel = useCallback(() => {
    if (!selected || actionsFor(selected).length < 2) return false;
    setPanelIndex(0);
    setPanelOpen(true);
    return true;
  }, [selected, actionsFor]);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const chip = scope ? null : chipFor(query);

  /** Escape's ladder: close the panel → clear the text → drop the chip → (the surface closes itself). */
  const peel = useCallback((): boolean => {
    if (panelOpen) {
      setPanelOpen(false);
      return true;
    }
    if (query) {
      setQuery('');
      return true;
    }
    if (scopeId) {
      setScopeId(null);
      return true;
    }
    return false;
  }, [panelOpen, query, scopeId, setQuery]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const k = e.nativeEvent;
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    const consume = () => {
      e.preventDefault();
      e.stopPropagation();
      // The global ⌘K / Esc handlers listen on `window`; this keeps them from also firing.
      k.stopPropagation();
    };

    if (panelOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        consume();
        const n = panelActions.length;
        setPanelIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
      } else if (e.key === 'Enter') {
        consume();
        const a = panelActions[panelIndex];
        if (selected && a) execute(selected, a);
      } else if (e.key === 'Escape' || e.key === 'ArrowLeft' || isActionsKey(e, mod)) {
        consume();
        setPanelOpen(false);
      } else if (e.key === 'Tab') {
        consume();
      } else if (!mod && e.key.length === 1) {
        setPanelOpen(false); // typing carries on with the box
      }
      return;
    }

    // ⌘/ opens the actions panel. (⌘K is not handled here at all: it always reaches the global handler, which focuses
    // Home's box or toggles the palette — the omnibox shortcut means the same thing wherever you are.)
    if (isActionsKey(e, mod)) {
      if (selected && openPanel()) consume();
      return;
    }

    // ⌘C copies the highlighted result's text — but never steals a normal copy of selected text in the input
    const el = e.currentTarget;
    const hasSelection = el.selectionStart !== el.selectionEnd;
    for (const a of selected ? actionsFor(selected) : []) {
      if (!a.hotkey || !matchesHotkey(a.hotkey, e, IS_MAC)) continue;
      if (a.hotkey === 'mod+c' && hasSelection) break;
      if (!selected) break;
      consume();
      execute(selected, a);
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setIndex((i) => (results.length ? (i + 1) % results.length : defaultIndex));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setIndex((i) => (results.length ? (i <= 0 ? results.length - 1 : i - 1) : defaultIndex));
        break;
      case 'PageDown':
        e.preventDefault();
        setIndex((i) => Math.min(results.length - 1, i + 5));
        break;
      case 'PageUp':
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 5));
        break;
      case 'Home':
        if (surface === 'palette' || e.ctrlKey) {
          e.preventDefault();
          setIndex(0);
        }
        break;
      case 'End':
        if (surface === 'palette' || e.ctrlKey) {
          e.preventDefault();
          setIndex(Math.max(0, results.length - 1));
        }
        break;
      case 'ArrowRight':
        // → at the end of the text opens the action panel for the highlighted row (Tab is taken by chips and completion)
        if (!e.shiftKey && !mod && !e.altKey && el.selectionStart === el.value.length && el.selectionEnd === el.value.length && selected && openPanel()) {
          consume();
        }
        break;
      case 'Enter':
        // Home's <form> would also submit on Enter; the omnibox decides what Enter means.
        consume();
        activate(selected);
        break;
      case 'Tab': {
        if (e.shiftKey || mod || e.altKey) break;
        if (chip) {
          consume();
          setScopeId(chip.bang.id);
          setQueryState(chip.rest);
          setIndex(0);
        } else if (view.ghost) {
          consume();
          if (view.ghost.scope) {
            setScopeId(view.ghost.scope);
            setQueryState('');
            setIndex(0);
          } else setQuery(view.ghost.text);
        }
        break;
      }
      case 'Escape':
        if (peel()) consume(); // otherwise the surface closes itself
        break;
      case 'Backspace':
        if (scope && el.selectionStart === 0 && el.selectionEnd === 0) {
          consume();
          setScopeId(null);
        }
        break;
      default:
    }
  };

  /* ───────────── footer: what ↵ does now, and which keys are live ───────────── */
  const footer = useMemo(() => {
    const hints: FooterHint[] = [];
    const primary = panelOpen ? panelActions[panelIndex] : selected?.primary;
    let primaryLabel: string | null = null;
    if (primary) {
      primaryLabel = primary.scope ? primary.label : primary.fill !== undefined ? 'Try it' : primary.label;
    } else if (query.trim()) primaryLabel = 'Search the web';
    if (panelOpen) {
      return {
        primaryLabel,
        hints: [
          { keys: ['↑', '↓'], label: 'Navigate' },
          { keys: ['esc'], label: 'Back' },
        ] satisfies FooterHint[],
      };
    }
    const second = selected ? actionsFor(selected).find((a) => a.hotkey === 'mod+enter') : undefined;
    if (second) hints.push({ keys: hotkeyCaps('mod+enter', MOD_KEY), label: second.label });
    if (selected && actionsFor(selected).length > 1) hints.push({ keys: [MOD_KEY, '/'], label: 'Actions', run: openPanel });
    if (chip) hints.push({ keys: ['⇥'], label: chip.bang.custom ? chip.bang.name : `Search ${chip.bang.name}` });
    else if (view.ghost) hints.push({ keys: ['⇥'], label: 'Complete' });
    hints.push({ keys: ['esc'], label: query || scope ? 'Clear' : 'Close' });
    return { primaryLabel, hints };
  }, [panelOpen, panelActions, panelIndex, selected, query, actionsFor, chip, view.ghost, scope, openPanel]);

  const listId = `${surface}-omni-list`;
  const panelId = `${surface}-omni-actions`;
  const optionId = (r: OmniResult) => domId(`${surface}-opt`, r.id);
  const actionId = (a: OmniAction) => domId(`${surface}-act`, a.id);
  const activeId = panelOpen ? (panelActions[panelIndex] ? actionId(panelActions[panelIndex]) : undefined) : selected ? optionId(selected) : undefined;
  const ghostTail = view.ghost && query.trim() && !scope ? view.ghost.text.slice(query.replace(/^\s+/, '').length) : '';

  return {
    surface,
    query,
    setQuery,
    scope,
    clearScope: () => setScopeId(null),
    chip,
    view,
    results,
    index,
    setIndex,
    selected,
    panelOpen,
    panelActions,
    panelIndex,
    setPanelIndex,
    openPanel,
    closePanel,
    copiedId,
    onKeyDown,
    activate,
    execute,
    actionsFor,
    peel,
    reset,
    refresh,
    footer,
    listId,
    panelId,
    optionId,
    actionId,
    activeId,
    ghostTail,
  };
}
