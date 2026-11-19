/**
 * One requestAnimationFrame loop shared by every running wallpaper (and anything else that wants a capped tick). It stops by itself when
 * nothing is subscribed or the tab is hidden, and wakes on `visibilitychange`. Each subscriber gets the frame's timestamp and applies its own fps cap.
 */
type Tick = (now: number) => void;

const subs = new Set<Tick>();
let raf = 0;

function loop(now: number) {
  raf = 0;
  if (document.hidden || subs.size === 0) return;
  for (const s of [...subs]) s(now);
  if (subs.size > 0) raf = requestAnimationFrame(loop);
}

function kick() {
  if (!raf && subs.size > 0 && !document.hidden) raf = requestAnimationFrame(loop);
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', kick);

export function subscribe(tick: Tick): () => void {
  subs.add(tick);
  kick();
  return () => {
    subs.delete(tick);
    if (subs.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** Number of live subscribers (tests and debugging). */
export const activeCount = (): number => subs.size;

/**
 * The time step for a frame. A hidden or throttled tab can hand us a gap of seconds; simulating it would make everything hop, so a long
 * gap just resumes at one normal frame, and ordinary slow frames are capped at 100 ms.
 */
export function frameDt(now: number, last: number): number {
  if (!last) return 1 / 30;
  const gap = (now - last) / 1000;
  return gap > 0.25 ? 1 / 30 : Math.min(0.1, Math.max(0, gap));
}
