import type { Group } from '@/lib/omnibox/types';

/**
 * Icon-tile colours per group. Only two families, both from the theme: brand (things that *do* something — answers,
 * actions, tools, the top hit) and neutral (places and data) — so the list stays calm and re-themes with the accent.
 */
export const TILE: Record<Group, string> = {
  answer: 'bg-brand text-brand-foreground',
  top: 'bg-brand-soft text-brand-text',
  pinned: 'bg-brand-soft text-brand-text',
  recent: 'bg-muted text-muted-foreground',
  suggestions: 'bg-brand-soft text-brand-text',
  pages: 'bg-muted text-foreground',
  actions: 'bg-brand-soft text-brand-text',
  tools: 'bg-brand-soft text-brand-text',
  commands: 'bg-muted text-foreground',
  notes: 'bg-muted text-foreground',
  tasks: 'bg-muted text-foreground',
  chats: 'bg-muted text-foreground',
  shortcuts: 'bg-muted text-foreground',
  web: 'bg-muted text-muted-foreground',
};

export const HIGHLIGHT_SPRING = { type: 'spring', stiffness: 700, damping: 45 } as const;
