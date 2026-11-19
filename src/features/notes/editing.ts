/**
 * Pure text-editing helpers for the notes textarea. They take the value + selection
 * and return the new value + selection, so they're trivially testable and never
 * touch the DOM.
 */
export type EditResult = { value: string; selectionStart: number; selectionEnd: number };

/**
 * Toggle the `[ ]` / `[x]` on a given 1-based source line.
 * Line-based (not "n-th checkbox") so it stays correct under React StrictMode's double renders.
 */
export function toggleTaskOnLine(source: string, line: number): string {
  const lines = source.split('\n');
  const idx = line - 1;
  const text = lines[idx];
  if (text === undefined) return source;
  const next = text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/, (_m, a: string, c: string, b: string) => `${a}${c === ' ' ? 'x' : ' '}${b}`);
  if (next === text) return source;
  lines[idx] = next;
  return lines.join('\n');
}

/** Wrap the selection in `mark` (e.g. `**`); wrapping again unwraps. */
export function wrapSelection(value: string, start: number, end: number, mark: string): EditResult {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return {
      value: before.slice(0, -mark.length) + sel + after.slice(mark.length),
      selectionStart: start - mark.length,
      selectionEnd: end - mark.length,
    };
  }
  return {
    value: `${before}${mark}${sel}${mark}${after}`,
    selectionStart: start + mark.length,
    selectionEnd: end + mark.length,
  };
}

/** Add `prefix` to the start of the current line (or remove it if already there). */
export function prefixLine(value: string, start: number, end: number, prefix: string): EditResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  if (value.startsWith(prefix, lineStart)) {
    return {
      value: value.slice(0, lineStart) + value.slice(lineStart + prefix.length),
      selectionStart: Math.max(lineStart, start - prefix.length),
      selectionEnd: Math.max(lineStart, end - prefix.length),
    };
  }
  return {
    value: value.slice(0, lineStart) + prefix + value.slice(lineStart),
    selectionStart: start + prefix.length,
    selectionEnd: end + prefix.length,
  };
}

/**
 * Enter inside a list item: start the next item (incrementing numbers, unchecking tasks).
 * Pressing Enter on an *empty* item leaves the list instead. Returns null when not in a list.
 */
export function continueList(value: string, caret: number): EditResult | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const beforeCaret = value.slice(lineStart, caret);
  const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/.exec(beforeCaret);
  if (!m) return null;
  const [full = '', indent = '', marker = '-', space = ' ', check] = m;
  if (beforeCaret.slice(full.length).trim() === '') {
    // empty item → drop the marker and exit the list
    return { value: value.slice(0, lineStart) + value.slice(caret), selectionStart: lineStart, selectionEnd: lineStart };
  }
  const nextMarker = /^\d/.test(marker) ? `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker;
  const insert = `\n${indent}${nextMarker}${space}${check ? '[ ] ' : ''}`;
  const pos = caret + insert.length;
  return { value: value.slice(0, caret) + insert + value.slice(caret), selectionStart: pos, selectionEnd: pos };
}
