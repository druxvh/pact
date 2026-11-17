import type { ColumnId } from '@/features/kanban/store';

/** What a capture becomes: a note in a notebook, a task on a board, or (for guests) text in Home's quick note. */
export type CaptureKind = 'note' | 'task';

/** Same cap as the Home "Quick note" box, which is where a guest's captures land. */
export const MAX_CAPTURE_CHARS = 4000;
export const MAX_TASK_TITLE = 200;

/** First line → task title (capped); the rest → description. A very long first line is trimmed for the title and kept whole in the description. */
export function splitTask(text: string): { title: string; description: string } {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  const lines = clean.split('\n');
  const head = (lines[0] ?? '').trim();
  if (head.length <= MAX_TASK_TITLE) return { title: head, description: lines.slice(1).join('\n').trim() };
  return { title: `${head.slice(0, MAX_TASK_TITLE - 1).trimEnd()}…`, description: clean };
}

/**
 * Add `text` under whatever is already in the Home quick note, separated by a blank line.
 * Returns `null` when the result wouldn't fit — we never silently cut someone's note short.
 */
export function appendToDraft(draft: string, text: string, max = MAX_CAPTURE_CHARS): string | null {
  const add = text.trim();
  const base = draft.replace(/\s+$/, '');
  const next = base ? `${base}\n\n${add}` : add;
  return next.length > max ? null : next;
}

/** The first candidate that is really in `items`, else the first item, else `null`. */
export function pickId<T extends { id: string }>(items: readonly T[], ...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) if (c && items.some((i) => i.id === c)) return c;
  return items[0]?.id ?? null;
}

export type Where = { notebook: string } | { board: string; column: string } | { home: true };

/** "Notes · Personal", "Kanban · Personal · To do", "Home · Quick note" — what the success state says. */
export function describeWhere(where: Where): string {
  if ('notebook' in where) return `Notes · ${where.notebook}`;
  if ('board' in where) return `Kanban · ${where.board} · ${where.column}`;
  return 'Home · Quick note';
}

export type SaveResult =
  | { ok: true; kind: 'note'; id: string; where: string }
  | { ok: true; kind: 'task'; id: string; where: string }
  | { ok: true; kind: 'draft'; where: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'no-destination' };

export type CaptureTarget = { notebookId: string | null; boardId: string | null; columnId: ColumnId };
