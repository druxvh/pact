import type { PaletteItem } from '@/app/CommandPalette';

/**
 * Feature data surfaced in the command palette (notes, tasks, chats, shortcuts…).
 * Each feature extends this as it lands; the palette itself stays generic.
 */
export function buildDataItems(_query: string): PaletteItem[] {
  return [];
}
