import { copyText } from '@/lib/clipboard';
import { useDiscoverStore } from './store';
import type { Entry, SavedArticle } from './types';

/** Open the publisher's page in a new tab, and count the story as read. */
export function openOriginal(entry: Pick<Entry, 'id' | 'url'>): void {
  useDiscoverStore.getState().markRead(entry.id);
  window.open(entry.url, '_blank', 'noopener,noreferrer');
}

export const copyLink = (entry: Pick<Entry, 'url'>) => void copyText(entry.url, 'Link copied');

/** The save/unsave toggle every card, hero and the reader share. */
export const toggleSaved = (entry: Entry | SavedArticle): boolean => useDiscoverStore.getState().toggleSaved(entry);

/**
 * A plain click on a story opens the reader; a modified click (⌘/Ctrl/Shift, middle button) is left to the browser so it opens
 * the publisher's page in a new tab like any link.
 */
export function plainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
