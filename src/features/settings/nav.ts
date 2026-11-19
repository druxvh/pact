/**
 * Which section is "in view": the last one whose top has passed the upper third of the scroller — or the last one, once
 * you've reached the bottom (a short final section could otherwise never get there).
 */
export function activeSection(tops: ReadonlyArray<{ id: string; top: number }>, line: number, atBottom: boolean): string {
  if (tops.length === 0) return '';
  if (atBottom) return (tops[tops.length - 1] as { id: string }).id;
  let current = (tops[0] as { id: string }).id;
  for (const t of tops) if (t.top <= line) current = t.id;
  return current;
}
