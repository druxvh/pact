/**
 * One requestAnimationFrame loop shared by every running effect (the Home box, the ⌘K strip, the Settings thumbnails), so nine
 * previews cost one timer, not nine. It stops by itself when nothing is subscribed or the tab is hidden.
 */
type Tick = (now: number) => void;

const subs = new Set<Tick>();
let raf = 0;

function loop(now: number) {
  raf = 0;
  if (document.hidden || subs.size === 0) return;
  for (const s of [...subs]) s(now);
  raf = requestAnimationFrame(loop);
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
