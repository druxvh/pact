import { Check, Flame, Pencil, Target, Timer } from 'lucide-react';
import { AnimatePresence, MotionConfigContext, motion, useReducedMotion } from 'motion/react';
import { type FormEvent, useContext, useEffect, useRef, useState } from 'react';
import { Button, IconButton, Input } from '@/components/ui';
import { entryFor, MAX_FOCUS_CHARS, msUntilNextDay, previousEntry, relativeDay, streak } from '@/features/home/widgets/mainFocus';
import { startFocusSession, useMainFocusStore } from '@/features/home/widgets/mainFocusStore';
import { dateKey } from '@/features/home/widgets/today';
import { WidgetCard } from '@/features/home/widgets/WidgetCard';
import { useTimerStore } from '@/features/timer/store';
import { cn } from '@/lib/cn';
import { pluralize } from '@/lib/format';
import { ease, spring } from '@/lib/motion';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';

/**
 * Today's date string, kept fresh. The day is *derived* from the clock on every render; the timer and the focus/visibility
 * listeners only exist to trigger that render when midnight passes under a tab that stayed open (or a laptop that slept).
 */
function useDay(): string {
  const [day, setDay] = useState(() => dateKey());
  useEffect(() => {
    const sync = () => setDay((d) => (dateKey() === d ? d : dateKey()));
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        sync();
        arm();
      }, msUntilNextDay(new Date()) + 500);
    };
    arm();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);
  return day;
}

/** The app's animation preference (Settings → Animations, set on the shell's MotionConfig), falling back to the OS. */
function useMotionOff(): boolean {
  const configured = useContext(MotionConfigContext).reducedMotion;
  const os = useReducedMotion();
  return configured === 'always' || (configured !== 'never' && Boolean(os));
}

const CONFETTI = ['bg-brand', 'bg-success', 'bg-warning', 'bg-brand', 'bg-success', 'bg-warning', 'bg-brand', 'bg-success'] as const;

/** A small burst of dots and a ring around the check — played once when today's focus is completed. */
function Celebration() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
      <motion.span
        className="absolute size-7 rounded-full border-2 border-brand"
        initial={{ scale: 1, opacity: 0.7 }}
        animate={{ scale: 2.4, opacity: 0 }}
        transition={{ duration: 0.55, ease: ease.outExpo }}
      />
      {CONFETTI.map((tone, i) => {
        const angle = (i / CONFETTI.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed ring of identical dots
            key={i}
            className={cn('absolute size-1.5 rounded-full', tone)}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(angle) * 30, y: Math.sin(angle) * 30, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.65, ease: ease.outExpo, delay: 0.04 }}
          />
        );
      })}
    </span>
  );
}

function CheckButton({ done, celebrate, onToggle }: { done: boolean; celebrate: boolean; onToggle: () => void }) {
  return (
    <motion.button
      id="main-focus-check"
      type="button"
      aria-pressed={done}
      aria-label={done ? 'Main focus done. Press to undo' : 'Mark main focus as done'}
      onClick={onToggle}
      whileTap={{ scale: 0.88 }}
      transition={spring.snappy}
      className={cn(
        'relative mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border-2 outline-offset-2 transition-colors duration-200',
        done ? 'border-brand bg-brand text-brand-foreground' : 'border-input hover:border-brand hover:bg-brand-soft',
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
        <motion.path
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
          transition={{ duration: 0.28, ease: ease.outQuart, delay: done ? 0.06 : 0 }}
        />
      </svg>
      {celebrate && <Celebration />}
    </motion.button>
  );
}

/**
 * One intention for the day. Works without an account (it only ever touches this device); the "start a focus session"
 * shortcut appears for signed-in people only, because the Focus timer needs an account.
 */
export function MainFocusWidget() {
  const day = useDay();
  const entries = useMainFocusStore((s) => s.entries);
  const setToday = useMainFocusStore((s) => s.setToday);
  const toggleToday = useMainFocusStore((s) => s.toggleToday);
  const signedIn = useAuthStore(selectSignedIn);
  const timerStatus = useTimerStore((s) => s.status);
  const motionOff = useMotionOff();

  const entry = entryFor(entries, day);
  const earlier = previousEntry(entries, day);
  const days = streak(entries, day);
  const done = Boolean(entry?.doneAt);

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusTo = useRef<string | null>(null);

  // Only move focus because of something the person just did — never on page load, where `/` and the search box own the keyboard.
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const showForm = !entry || editing;
  // The form disappears when it's submitted or cancelled; hand focus to the control that replaces it instead of dropping it on <body>.
  useEffect(() => {
    if (showForm || !returnFocusTo.current) return;
    document.getElementById(returnFocusTo.current)?.focus();
    returnFocusTo.current = null;
  }, [showForm]);

  useEffect(() => {
    if (!celebrating) return;
    const t = window.setTimeout(() => setCelebrating(false), 1000);
    return () => window.clearTimeout(t);
  }, [celebrating]);

  const stopEditing = (focusId: string) => {
    returnFocusTo.current = focusId;
    setEditing(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setToday(text);
    stopEditing(editing ? 'main-focus-edit' : 'main-focus-check');
  };

  const toggle = () => {
    toggleToday();
    // Celebrate completing it, not un-completing; and not for people who asked for less motion.
    if (!done && !motionOff) setCelebrating(true);
  };

  const streakBadge =
    days > 0 ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-text" title={`${pluralize(days, 'day')} in a row`}>
        <Flame className="size-3.5" aria-hidden="true" />
        {days}
        <span className="sr-only"> {days === 1 ? 'day' : 'days'} in a row</span>
      </span>
    ) : undefined;

  return (
    <WidgetCard icon={Target} title="Main focus" action={streakBadge}>
      {showForm ? (
        <form onSubmit={submit} className="flex flex-1 flex-col justify-between gap-3">
          <div>
            <label htmlFor="main-focus-input" className="block text-[15px] font-medium leading-snug">
              What’s your main focus today?
            </label>
            <p className="mb-2.5 mt-0.5 text-[13px] leading-snug text-muted-foreground">One thing that would make today a good day.</p>
            <Input
              id="main-focus-input"
              ref={inputRef}
              value={text}
              maxLength={MAX_FOCUS_CHARS}
              placeholder="e.g. Finish the project outline"
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && entry) {
                  e.stopPropagation();
                  stopEditing('main-focus-edit');
                }
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-subtle-foreground">
              {earlier && !editing ? (
                <>
                  {relativeDay(earlier.day, day)}: {earlier.text}
                  {earlier.doneAt ? ' ✓' : ''}
                </>
              ) : null}
            </span>
            <div className="flex shrink-0 gap-1.5">
              {editing && (
                <Button type="button" variant="ghost" size="sm" onClick={() => stopEditing('main-focus-edit')}>
                  Cancel
                </Button>
              )}
              <Button type="submit" variant="primary" size="sm" disabled={text.trim() === ''}>
                {editing ? 'Save' : 'Set focus'}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckButton done={done} celebrate={celebrating} onToggle={toggle} />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'break-words text-[15px] font-medium leading-snug transition-colors duration-300',
                  done && 'text-muted-foreground line-through decoration-brand/70',
                )}
              >
                {entry?.text}
              </p>
              <AnimatePresence initial={false} mode="wait">
                <motion.p
                  key={done ? 'done' : 'open'}
                  initial={motionOff ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="mt-1 flex items-center gap-1 text-xs text-subtle-foreground"
                >
                  {done ? (
                    <>
                      <Check className="size-3 text-brand-text" aria-hidden="true" />
                      {days > 1 ? `Done — ${days} days in a row` : 'Done. Nice work.'}
                    </>
                  ) : (
                    'Check it off when it’s done.'
                  )}
                </motion.p>
              </AnimatePresence>
            </div>
            {!done && (
              <IconButton
                id="main-focus-edit"
                label="Edit main focus"
                size="icon-sm"
                onClick={() => {
                  setText(entry?.text ?? '');
                  setEditing(true);
                }}
              >
                <Pencil />
              </IconButton>
            )}
          </div>

          <div className="flex items-end justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {earlier ? (
                <>
                  {relativeDay(earlier.day, day)}: {earlier.text}
                  {earlier.doneAt ? ' ✓' : ''}
                </>
              ) : null}
            </p>
            {signedIn && !done && entry && (
              <Button variant={timerStatus === 'running' ? 'soft' : 'primary'} size="sm" onClick={() => startFocusSession(entry.text)}>
                <Timer />
                {timerStatus === 'running' ? 'Open timer' : 'Start a focus session'}
              </Button>
            )}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
