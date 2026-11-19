/**
 * Scrolling that can only move the element's own scroll container.
 *
 * `element.scrollIntoView()` scrolls *every* ancestor that can scroll — including the document, which pact keeps at
 * `overflow: hidden` but which can still be moved by script. When that happened the whole app shell slid up (the top bar
 * and sidebar half off screen) and nothing ever scrolled it back until a refresh. This helper moves just the nearest
 * scrollable ancestor, and leaves the page itself alone.
 */

export type ScrollBlock = 'start' | 'center' | 'nearest';

/** How far (px) the container must scroll so the element sits at `block`; positive = scroll down. Pure, for testing. */
export function scrollDelta(
  block: ScrollBlock,
  el: { top: number; bottom: number; height: number },
  box: { top: number; bottom: number; height: number },
  offset = 0,
): number {
  if (block === 'start') return el.top - box.top - offset;
  if (block === 'center') return el.top - box.top - (box.height - el.height) / 2;
  if (el.top < box.top + offset) return el.top - box.top - offset;
  if (el.bottom > box.bottom) return el.bottom - box.bottom;
  return 0;
}

export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function scrollToElement(el: HTMLElement | null | undefined, opts: { block?: ScrollBlock; behavior?: 'auto' | 'smooth'; offset?: number } = {}): void {
  if (!el) return;
  const parent = scrollParent(el);
  if (!parent) return;
  const delta = scrollDelta(opts.block ?? 'nearest', el.getBoundingClientRect(), parent.getBoundingClientRect(), opts.offset ?? 0);
  if (!delta) return;
  parent.scrollTo({ top: parent.scrollTop + delta, behavior: opts.behavior === 'smooth' && !reduced() ? 'smooth' : 'auto' });
}
