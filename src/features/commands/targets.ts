import { BellOff, Camera, FilePlus2, Keyboard, LayoutList, Link2, ListPlus, type LucideIcon, Moon, Play, SunMoon, Tag, TextCursorInput } from 'lucide-react';
import { SECTIONS } from '@/app/routes';
import { TOOLS } from '@/features/tools/registry';

/** What an alias can point at: one of pact's own pages, tools or actions, by the id the omnibox gives that result. */
export type AliasTarget = { id: string; title: string; group: 'Pages' | 'Tools' | 'Actions'; icon: LucideIcon };

/**
 * The omnibox's built-in actions that make sense to alias (`action:<id>` — the ids `paletteSources` uses; a test keeps
 * the two lists in step). The timer's real title flips between Start and Pause, so the target is named for both.
 */
export const ACTION_TARGETS: ReadonlyArray<AliasTarget> = [
  { id: 'action:new-note', title: 'Create a new note', group: 'Actions', icon: FilePlus2 },
  { id: 'action:new-task', title: 'Create a new task', group: 'Actions', icon: ListPlus },
  { id: 'action:timer', title: 'Start or pause the focus timer', group: 'Actions', icon: Play },
  { id: 'action:theme', title: 'Toggle light / dark theme', group: 'Actions', icon: SunMoon },
  { id: 'action:system-theme', title: 'Use system theme', group: 'Actions', icon: Moon },
  { id: 'action:shortcuts', title: 'Show keyboard shortcuts', group: 'Actions', icon: Keyboard },
  { id: 'action:read', title: 'Mark all notifications as read', group: 'Actions', icon: BellOff },
  { id: 'action:camera', title: 'Open camera', group: 'Actions', icon: Camera },
  { id: 'action:create-quicklink', title: 'Create Quicklink', group: 'Actions', icon: Link2 },
  { id: 'action:create-snippet', title: 'Create Snippet', group: 'Actions', icon: TextCursorInput },
  { id: 'action:create-alias', title: 'Create Alias', group: 'Actions', icon: Tag },
  { id: 'action:manage-commands', title: 'Manage commands', group: 'Actions', icon: LayoutList },
];

/** Pages first, then tools, then actions — the order the picker shows them. */
export function aliasTargets(): AliasTarget[] {
  return [
    ...SECTIONS.map((s): AliasTarget => ({ id: `page:${s.id}`, title: s.label, group: 'Pages', icon: s.icon })),
    ...TOOLS.map((t): AliasTarget => ({ id: `tool:${t.id}`, title: t.title, group: 'Tools', icon: t.icon })),
    ...ACTION_TARGETS,
  ];
}

export const aliasTargetById = (id: string): AliasTarget | undefined => aliasTargets().find((t) => t.id === id);
