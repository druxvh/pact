/** Small building blocks of the camera studio: stage buttons, the shutter, the filter strip and the screen-reader announcer. */
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { type ComponentProps, useCallback, useRef, useState } from 'react';
import { Kbd, Tooltip } from '@/components/ui';
import { FILTERS, type FilterId, toCss } from '@/features/camera/filters';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

// ── buttons that sit on the (always dark) preview ────────────────────────────

type StageButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> & {
  /** Accessible name and tooltip. */
  label: string;
  shortcut?: string;
  /** Toggle state (`aria-pressed`); `undefined` = not a toggle. */
  pressed?: boolean;
  /** Highlighted without being an on/off toggle (a cycling button that is set to something). */
  active?: boolean;
  /** Something other than the default is set (a small dot on the button). */
  changed?: boolean;
  /** Visible text next to the icon (hidden on narrow screens, where the dot says "changed"). */
  text?: string;
};

export function StageButton({ label, shortcut, pressed, active, changed, text, className, children, ...props }: StageButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        data-active={active || undefined}
        className={cn(
          'relative inline-flex h-9 min-w-9 select-none items-center justify-center gap-1.5 rounded-md bg-black/50 px-2 text-[13px] font-medium text-white backdrop-blur-sm',
          'outline-none transition-[background-color,transform,opacity] duration-150 ease-out-quart hover:bg-black/70 active:scale-95',
          'focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[18px] [&_svg]:shrink-0',
          'aria-pressed:bg-brand aria-pressed:text-brand-foreground aria-pressed:hover:brightness-110 data-[active]:bg-brand data-[active]:text-brand-foreground data-[active]:hover:brightness-110 data-[popup-open]:bg-black/75',
          className,
        )}
        {...props}
      >
        {children}
        {text && <span className="hidden tabular-nums sm:inline">{text}</span>}
        {changed && !pressed && !active && <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 rounded-full bg-brand sm:hidden" />}
      </button>
    </Tooltip>
  );
}

// ── the shutter ──────────────────────────────────────────────────────────────

type ShutterProps = {
  mode: 'photo' | 'video';
  recording: boolean;
  /** The self-timer is counting: pressing now cancels it. */
  counting: boolean;
  disabled: boolean;
  onPress: () => void;
  ref?: React.Ref<HTMLButtonElement>;
};

export function Shutter({ mode, recording, counting, disabled, onPress, ref }: ShutterProps) {
  const label = counting ? 'Cancel timer' : mode === 'photo' ? 'Take photo' : recording ? 'Stop recording' : 'Start recording';
  const tint = mode === 'photo' ? 'brand' : 'destructive';
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      whileTap={{ scale: 0.92 }}
      transition={spring.snappy}
      className={cn(
        'group relative grid size-[4.5rem] shrink-0 place-items-center rounded-full outline-none [@media(max-height:680px)]:size-16',
        'focus-visible:ring-4 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45',
      )}
    >
      {/* the ring */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 rounded-full border-[3px] transition-colors duration-200',
          tint === 'brand' ? 'border-brand/45 group-hover:border-brand' : 'border-destructive/45 group-hover:border-destructive',
        )}
      />
      {/* the disc: round for a photo, a square while recording (the usual "stop" shape) */}
      <span
        aria-hidden="true"
        className={cn(
          'grid place-items-center transition-[width,height,border-radius,background-color] duration-200 ease-out-expo',
          counting
            ? 'size-12 rounded-full bg-muted text-foreground'
            : recording
              ? 'size-7 rounded-md bg-destructive'
              : cn('size-14 rounded-full [@media(max-height:680px)]:size-12', tint === 'brand' ? 'bg-brand shadow-brand' : 'bg-destructive'),
        )}
      >
        {counting && <X className="size-5" />}
      </span>
    </motion.button>
  );
}

// ── filters ──────────────────────────────────────────────────────────────────

/** A colourful gradient (no photo needed): the swatch shows the filter's effect on it. */
const SWATCH = 'conic-gradient(from 210deg, #f87171, #fbbf24, #4ade80, #38bdf8, #a78bfa, #f87171)';

export function FilterStrip({ value, onChange }: { value: FilterId; onChange: (id: FilterId) => void }) {
  return (
    <fieldset className="no-scrollbar m-0 flex min-w-0 gap-1.5 overflow-x-auto border-0 px-4 py-0.5">
      <legend className="sr-only">Filter</legend>
      {FILTERS.map((f, i) => {
        const on = f.id === value;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(f.id)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-2 rounded-md border pl-1.5 pr-2.5 text-[13px] font-medium outline-none transition-colors duration-150',
              'focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'border-brand/60 bg-brand-soft text-brand-text' : 'border-transparent bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            <span aria-hidden="true" className="size-5 shrink-0 rounded-sm" style={{ background: SWATCH, filter: toCss(f.ops) }} />
            {f.label}
            <Kbd className="hidden h-4 min-w-4 px-0.5 md:inline-flex">{i + 1}</Kbd>
          </button>
        );
      })}
    </fieldset>
  );
}

// ── announcements for screen readers ─────────────────────────────────────────

const NBSP = String.fromCodePoint(0xa0);

/** `announce('Photo saved')` — a polite live region. Saying the same thing twice in a row still gets announced. */
export function useAnnouncer() {
  const [message, setMessage] = useState('');
  const flip = useRef(false);
  const announce = useCallback((text: string) => {
    flip.current = !flip.current;
    setMessage(flip.current ? text : text + NBSP);
  }, []);
  return { message, announce };
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
