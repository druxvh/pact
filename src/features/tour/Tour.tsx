import { MotionConfigContext, motion, useReducedMotion } from 'motion/react';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Kbd } from '@/components/ui';
import { defaultCaptureKeys, readCaptureShortcut } from '@/features/capture/shortcut';
import { type Box, decideAutoStart, isUsable, placeCard, type Size, sameBox, spotlightBox, type TourStep, tourSteps } from '@/features/tour/logic';
import { useTourStore } from '@/features/tour/store';
import { cn } from '@/lib/cn';
import { MOD_KEY } from '@/lib/hotkeys';
import { spring } from '@/lib/motion';
import { scrollToElement } from '@/lib/scroll';
import { useProfileSync } from '@/lib/supabase/profile';
import { useAuthStore } from '@/store/useAuthStore';
import { useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';

/** The app's animation preference (Settings → Animations lives on the shell's MotionConfig), falling back to the OS. */
function useMotionOff(): boolean {
  const configured = useContext(MotionConfigContext).reducedMotion;
  const os = useReducedMotion();
  return configured === 'always' || (configured !== 'never' && Boolean(os));
}

const box = (r: DOMRect): Box => ({ top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) });

const viewportNow = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

/** The first on-screen element carrying `data-tour="<target>"` — the rail and the mobile bar both carry the same names, and only one is visible. */
function findAnchor(target: string): HTMLElement | null {
  const vp = viewportNow();
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    if (isUsable(box(el.getBoundingClientRect()), vp)) return el;
  }
  return null;
}

/** Starts the tour when the rules in `decideAutoStart` say it's time, and nothing else. */
function useAutoStart() {
  const auth = useAuthStore((s) => s.status);
  const profileReady = useProfileSync((s) => s.ready);
  const onboarded = useUserStore((s) => s.onboarded);
  const requested = useTourStore((s) => s.requested);
  const completed = useTourStore((s) => s.completed);
  const active = useTourStore((s) => s.active);
  const blocked = useUiStore((s) => s.paletteOpen || s.shortcutsOpen || s.signInOpen || s.captureOpen || s.cameraOpen);
  const start = useTourStore((s) => s.start);
  const markSeen = useTourStore((s) => s.markSeen);

  const decision = decideAutoStart({ auth, profileReady, onboarded, requested, completed, blocked });

  useEffect(() => {
    if (active) return;
    if (decision === 'mark-full-seen') {
      markSeen('full');
      return;
    }
    if (decision !== 'start-guest' && decision !== 'start-full') return;
    // Let the page finish its entrance animation (and the welcome dialog finish closing) before pointing at things.
    const t = window.setTimeout(() => start(decision === 'start-guest' ? 'guest' : 'full'), 700);
    return () => window.clearTimeout(t);
  }, [decision, active, start, markSeen]);
}

function useViewport(): Size {
  const [size, setSize] = useState(viewportNow);
  useEffect(() => {
    const onResize = () => setSize(viewportNow());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function StepBody({ step }: { step: TourStep }) {
  return (
    <>
      <h2 id="tour-title" className="text-base font-semibold tracking-tight">
        {step.title}
      </h2>
      <p id="tour-body" className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        {step.body}
      </p>
      {step.keys && step.keys.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {step.keys.map((k) => (
            <li key={k.label} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-muted-foreground">{k.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {k.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TourOverlay() {
  const kind = useTourStore((s) => s.kind);
  const index = useTourStore((s) => s.index);
  const goTo = useTourStore((s) => s.goTo);
  const finish = useTourStore((s) => s.finish);
  const motionOff = useMotionOff();
  const viewport = useViewport();

  // The shortcut can be rebound at chrome://extensions/shortcuts, so show whatever is bound right now.
  const [captureKeys, setCaptureKeys] = useState<readonly string[]>(defaultCaptureKeys);
  useEffect(() => {
    let alive = true;
    void readCaptureShortcut().then((keys) => alive && keys && keys.length > 0 && setCaptureKeys(keys));
    return () => {
      alive = false;
    };
  }, []);

  const steps = useMemo(() => tourSteps(kind, { mod: MOD_KEY, captureKeys }), [kind, captureKeys]);
  const last = steps.length - 1;
  const at = Math.min(index, last);
  const step = steps[at] as TourStep;

  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [card, setCard] = useState<Size>({ width: 352, height: 240 });
  const [anchor, setAnchor] = useState<Box | null>(null);

  // Follow the target: the page may still be animating in, the window may resize, a sidebar may collapse.
  useEffect(() => {
    if (!step.target) {
      setAnchor(null);
      return;
    }
    const target = step.target;
    scrollToElement(findAnchor(target), { block: 'nearest' });
    let raf = 0;
    const tick = () => {
      const el = findAnchor(target);
      const next = el ? box(el.getBoundingClientRect()) : null;
      setAnchor((prev) => (sameBox(prev, next) ? prev : next));
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [step.target]);

  // The card's own size decides where it fits; it changes as the text does.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setCard((c) => (c.width === el.offsetWidth && c.height === el.offsetHeight ? c : { width: el.offsetWidth, height: el.offsetHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const spotlight = anchor && isUsable(anchor, viewport) ? spotlightBox(anchor, viewport) : null;
  const place = placeCard(spotlight ? anchor : null, card, viewport, step.side);

  const next = useCallback(() => (at >= last ? finish() : goTo(at + 1)), [at, last, finish, goTo]);
  const back = useCallback(() => goTo(Math.max(0, at - 1)), [at, goTo]);

  // Keyboard: Esc skips, ←/→ move, Tab stays inside the card. Capture phase, so nothing underneath (g-chords, ⌘K…) also fires.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      } else if (e.key === 'Tab') {
        const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
        const first = items[0];
        const lastItem = items[items.length - 1];
        const inside = cardRef.current?.contains(document.activeElement);
        if (!first || !lastItem) return;
        if (!inside) {
          e.preventDefault();
          (e.shiftKey ? lastItem : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, back, finish]);

  // Take focus when the tour opens and give it back when it closes; keep it in the card as steps change.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (before && document.contains(before)) before.focus?.();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `at` is the trigger — re-home focus whenever the step changes
  useEffect(() => {
    if (!cardRef.current?.contains(document.activeElement)) nextRef.current?.focus();
  }, [at]);

  const move = motionOff ? { duration: 0 } : spring.soft;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[80]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motionOff ? 0 : 0.2 }}
      data-tour-overlay=""
    >
      {/* Catches clicks so the page underneath can't be used by accident — and gives the cut-out its dim. */}
      <div aria-hidden="true" className={cn('absolute inset-0', !spotlight && 'bg-black/60')} />
      {spotlight && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-lg"
          style={{ boxShadow: '0 0 0 2px var(--brand), 0 0 0 9999px oklch(0 0 0 / 0.6)' }}
          initial={false}
          animate={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
          transition={move}
        />
      )}

      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="absolute w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-pop outline-none"
        initial={false}
        animate={{ top: place.top, left: place.left }}
        transition={move}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            Step {at + 1} of {steps.length}
          </p>
          <Button variant="ghost" size="xs" onClick={finish}>
            Skip tour
          </Button>
        </div>

        <div className="mt-2" aria-live="polite">
          <motion.div key={step.id} initial={motionOff ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            <StepBody step={step} />
          </motion.div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <ol className="flex items-center gap-1.5" aria-label={`Step ${at + 1} of ${steps.length}`}>
            {steps.map((s, i) => (
              <li
                key={s.id}
                aria-current={i === at ? 'step' : undefined}
                className={cn('h-1.5 rounded-full transition-[width,background-color] duration-200', i === at ? 'w-4 bg-brand' : 'w-1.5 bg-border')}
              />
            ))}
          </ol>
          <div className="flex items-center gap-1.5">
            {at > 0 && (
              <Button variant="ghost" size="sm" onClick={back}>
                Back
              </Button>
            )}
            <Button ref={nextRef} variant="primary" size="sm" onClick={next}>
              {at >= last ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** The first-run tour. Mount once in the app shell; it decides for itself whether to appear. */
export function Tour() {
  useAutoStart();
  const active = useTourStore((s) => s.active);
  const kind = useTourStore((s) => s.kind);
  const signedIn = useAuthStore((s) => s.status === 'signedIn');
  const finish = useTourStore((s) => s.finish);

  // The signed-in tour and the guest tour describe different screens: if someone signs in mid-tour, close it.
  useEffect(() => {
    if (active && kind === 'guest' && signedIn) finish();
  }, [active, kind, signedIn, finish]);

  return active ? <TourOverlay /> : null;
}
