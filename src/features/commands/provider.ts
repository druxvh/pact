import { ClipboardType, Copy, ExternalLink, Link2, Pencil } from 'lucide-react';
import { resolveCommandIcon } from '@/features/commands/CommandIcon';
import { isBuiltinAlias, type Quicklink, quicklinkToBang, type Snippet } from '@/features/commands/model';
import { useCommandsStore } from '@/features/commands/store';
import { openEditCommand } from '@/features/commands/ui';
import { copyText } from '@/lib/clipboard';
import { openUrl } from '@/lib/ext';
import { bangNeedsClipboard, bangUrl } from '@/lib/omnibox/bangs';
import { scoreFields } from '@/lib/omnibox/engine';
import { copyKeepingFocus, resolveBangUrl } from '@/lib/omnibox/providers';
import {
  expandSnippet,
  hasPlaceholder,
  readClipboardText,
  safeWebUrl,
  shortTemplate,
  snippetPreview,
  templateHome,
  usesClipboard,
} from '@/lib/omnibox/templates';
import type { OmniAction, OmniCtx, OmniResult, Provider } from '@/lib/omnibox/types';
import { notify } from '@/lib/toast';

/** Frecency / pin keys — a quicklink and a snippet each keep their own. */
export const quicklinkKey = (id: string) => `ql:${id}`;
export const snippetKey = (id: string) => `sn:${id}`;

/** The start of one of the user's own aliases: just above a built-in site's prefix match (920), so `re` completes to *their* `repo`, not Reddit. */
const PREFIX_SCORE = 925;

/** Does this quicklink have a `{query}` (so its alias can become a chip and take text)? */
const searchable = (c: Quicklink) => Boolean(c.alias) && !isBuiltinAlias(c.alias) && hasPlaceholder(c.url, 'query');

/** Run `fn` with the finished address of a quicklink (reading the clipboard first when it asks for it). Never opens anything that isn't http(s). */
function withQuicklinkUrl(c: Quicklink, fn: (url: string) => void): () => void {
  const bang = quicklinkToBang(c);
  const go = (raw: string) => {
    const url = safeWebUrl(raw);
    if (url) fn(url);
    else notify.error(`Couldn’t open “${c.name}”`, 'Its address isn’t a valid web address. Edit the quicklink to fix it.');
  };
  return () => {
    if (bangNeedsClipboard(bang)) void resolveBangUrl(bang, '').then(go);
    else go(bangUrl(bang, ''));
  };
}

async function copySnippet(c: Snippet, locale: string | undefined) {
  let clipboard = '';
  if (usesClipboard(c.text)) {
    const read = await readClipboardText();
    if (read === null) notify.error('Couldn’t read the clipboard', 'Allow clipboard access for pact — the {clipboard} part is left empty.');
    else clipboard = read;
  }
  // plain copyText (not copyKeepingFocus): this action closes the box, so nothing should pull focus back into it
  await copyText(expandSnippet(c.text, { now: new Date(), locale, clipboard }), `Copied “${c.name}” — paste it anywhere`);
}

const editAction = (id: string): OmniAction => ({ id: 'edit', label: 'Edit', icon: Pencil, record: false, run: () => openEditCommand(id) });

function quicklinkResult(c: Quicklink): Omit<OmniResult, 'group' | 'score'> {
  const icon = resolveCommandIcon(c.icon);
  return {
    id: quicklinkKey(c.id),
    title: c.name,
    subtitle: shortTemplate(c.url),
    keywords: c.alias,
    icon: icon.kind === 'lucide' ? icon.Icon : Link2,
    emoji: icon.kind === 'emoji' ? icon.emoji : undefined,
    site: icon.kind === 'site' ? { url: templateHome(c.url) || c.url, title: c.name } : undefined,
    hint: c.alias || undefined,
    primary: { id: 'open', label: `Open ${c.name}`, icon: ExternalLink, run: withQuicklinkUrl(c, (url) => openUrl(url)) },
    actions: [
      {
        id: 'open-new-tab',
        label: 'Open in new tab',
        icon: ExternalLink,
        hotkey: 'mod+enter',
        run: withQuicklinkUrl(c, (url) => openUrl(url, { newTab: true })),
      },
      {
        id: 'copy-link',
        label: 'Copy link',
        icon: Copy,
        hotkey: 'mod+c',
        record: false,
        run: withQuicklinkUrl(c, (url) => void copyKeepingFocus(url, 'Link copied')),
      },
      editAction(c.id),
    ],
    frecencyKey: quicklinkKey(c.id),
  };
}

function snippetResult(c: Snippet, ctx: OmniCtx): Omit<OmniResult, 'group' | 'score'> {
  return {
    id: snippetKey(c.id),
    title: c.name,
    subtitle: snippetPreview(c.text, ctx.now, ctx.locale),
    keywords: c.alias,
    icon: ClipboardType,
    hint: c.alias || undefined,
    // a new-tab page can't paste into other apps: copying is the honest verb
    primary: { id: 'copy', label: 'Copy snippet', icon: Copy, run: () => copySnippet(c, ctx.locale) },
    actions: [
      {
        id: 'copy-raw',
        label: 'Copy text as typed',
        icon: Copy,
        hotkey: 'mod+c',
        record: false,
        run: () => void copyKeepingFocus(c.text, 'Copied the text as typed'),
      },
      editAction(c.id),
    ],
    frecencyKey: snippetKey(c.id),
  };
}

/**
 * The user's quicklinks and snippets as omnibox results. Typing a name finds them; typing the alias exactly (`gh`) makes
 * them the Top hit; `!alias` works for ones that don't take text. A quicklink with `{query}` is a bang too — `alias`
 * then Tab makes the site chip, and `alias text` / `!alias text` are answered by the core bang provider (see
 * `bangs.ts: setCustomBangs`), not here, so they never show up twice.
 */
export function commandsProvider(): Provider {
  return (q, ctx) => {
    const items = useCommandsStore.getState().items.filter((c): c is Quicklink | Snippet => c.kind !== 'alias');
    if (!items.length) return [];
    const lower = q.toLowerCase();
    const bangStyle = lower.startsWith('!');
    const needle = bangStyle ? lower.slice(1) : lower;
    const out: OmniResult[] = [];

    for (const c of items) {
      const base = c.kind === 'quicklink' ? quicklinkResult(c) : snippetResult(c, ctx);
      const key = base.frecencyKey ?? base.id;

      // Nothing typed: the palette lists them all, Home only the ones you pinned (the rest are one search away).
      if (!q) {
        if (ctx.surface === 'palette' || ctx.pinned.includes(key)) out.push({ ...base, group: 'commands', score: 1 });
        continue;
      }
      if (/\s/.test(needle) && bangStyle) continue; // `!alias text`: the core bang provider's job

      const alias = c.alias;
      const exact = Boolean(alias) && needle === alias;
      const prefix = Boolean(alias) && needle.length >= 2 && alias.startsWith(needle);
      const chip = c.kind === 'quicklink' && searchable(c);
      let score = 0;
      let matches: number[] | undefined;
      if (bangStyle) {
        if (chip && exact) continue; // `!gh-work` is a bang: the core provider already shows it
        score = exact ? 1600 : prefix ? PREFIX_SCORE : 0;
      } else {
        const f = scoreFields(q, c.name, [alias, c.kind === 'quicklink' ? shortTemplate(c.url) : c.text.slice(0, 200)]);
        score = Math.max(f.score, exact ? 1480 : prefix ? PREFIX_SCORE : 0);
        if (f.score > 0) matches = f.matches;
      }
      if (score <= 0) continue;

      const completion =
        chip && alias.startsWith(needle) && alias.length > needle.length
          ? { text: bangStyle ? `!${alias}` : alias, scope: `ql:${c.id}` }
          : bangStyle
            ? undefined
            : { text: c.name };
      out.push({ ...base, group: exact ? 'top' : 'commands', demoteTo: exact ? 'commands' : undefined, score, matches, completion });
    }
    return out;
  };
}
