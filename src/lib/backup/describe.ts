import type { Counts } from '@/lib/backup/types';

/** "42 notes · 12 tasks · 3 focus sessions · wallpaper" — the headline numbers of a snapshot. */
export function describeCounts(counts: Counts, hasWallpaper: boolean): string {
  const rows: Array<[string, string, string]> = [
    ['pact-notes.notes', 'note', 'notes'],
    ['pact-kanban.tasks', 'task', 'tasks'],
    ['pact-timer.sessions', 'focus session', 'focus sessions'],
    ['pact-home.pinned', 'shortcut', 'shortcuts'],
    ['pact-chat.messages', 'message', 'messages'],
  ];
  const parts: string[] = [];
  for (const [key, one, many] of rows) {
    const n = counts[key];
    if (typeof n === 'number' && n > 0) parts.push(`${n.toLocaleString('en-US')} ${n === 1 ? one : many}`);
  }
  if (hasWallpaper) parts.push('wallpaper');
  return parts.length ? parts.join(' · ') : 'Settings only';
}
