/**
 * Cursor-following spotlight for any element carrying `data-spotlight` (+ the
 * `spotlight` CSS utility). One delegated listener — no per-card handlers, no re-renders.
 */
let installed = false;

export function installSpotlight(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'pointermove',
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-spotlight]');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      target.style.setProperty('--my', `${e.clientY - rect.top}px`);
    },
    { passive: true },
  );
}
