const MAX_TITLE = 60;

/**
 * Turn scratch-pad text into a note. A short first line becomes the title and the rest the body (so the title isn't
 * repeated inside the note). A long first line is trimmed for the title and kept whole in the body.
 */
export function splitNote(text: string): { title: string; body: string } {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const head = (lines[0] ?? '').replace(/^#{1,6}\s+/, '').trim();
  if (head.length <= MAX_TITLE) return { title: head, body: lines.slice(1).join('\n').trim() };
  return { title: `${head.slice(0, MAX_TITLE - 1).trimEnd()}…`, body: text.trim() };
}

/** First readable line of a note body, with the most common Markdown marks stripped — for one-line previews. */
export function preview(body: string, max = 90): string {
  const line = body.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line
    .replace(/^\s*(#{1,6}\s+|[-*+] \[[ xX]\]\s+|[-*+>]\s+|\d+\.\s+)/, '')
    .replace(/[*_`~]/g, '')
    .trim()
    .slice(0, max);
}
