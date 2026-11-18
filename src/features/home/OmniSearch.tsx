import { ArrowUpRight, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteLink } from '@/app/paletteSources';
import { OmniField } from '@/components/omnibox/OmniField';
import { OmniLeadIcon } from '@/components/omnibox/OmniLeadIcon';
import { OmniPanel, useEntrance } from '@/components/omnibox/OmniList';
import { useOmnibox } from '@/components/omnibox/useOmnibox';
import { Kbd } from '@/components/ui';
import { cn } from '@/lib/cn';
import { modCombo, useHotkeys } from '@/lib/hotkeys';
import { spring } from '@/lib/motion';
import { registerHomeOmnibox, startAutoFocus } from '@/lib/omnibox/focus';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';

export type SearchableLink = SiteLink;

const PLACEHOLDERS = [
  'Search the web or type a URL',
  'Try “12*(3+4)/2”',
  'Try “10 km in mi”',
  'Try “!yt lofi beats”',
  'Try “time in tokyo”',
  'Try “days until dec 25”',
  'Try “create quicklink” to add your own shortcut',
  'Try “cam” to take a photo',
  `${modCombo('K')} brings you back here from any page`,
];
const SIGNED_IN_PLACEHOLDERS = [...PLACEHOLDERS, 'Try “note: buy milk”', 'Try “timer 25”'];

/**
 * Typewriter placeholder. Lives in its own component so the per-character state
 * updates never re-render the rest of the page (the old version re-rendered the
 * whole Home view ~18×/second).
 */
function TypingPlaceholder({ phrases }: { phrases: readonly string[] }) {
  const [text, setText] = useState(phrases[0] ?? '');
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let phrase = 0;
    let i = 0;
    let deleting = false;
    let timer: number;
    const step = () => {
      const full = phrases[phrase] ?? '';
      if (!deleting) {
        i++;
        setText(full.slice(0, i));
        if (i >= full.length) {
          deleting = true;
          timer = window.setTimeout(step, 1800);
          return;
        }
        timer = window.setTimeout(step, 45 + Math.random() * 40);
      } else {
        i--;
        setText(full.slice(0, i));
        if (i <= 0) {
          deleting = false;
          phrase = (phrase + 1) % phrases.length;
          timer = window.setTimeout(step, 350);
          return;
        }
        timer = window.setTimeout(step, 22);
      }
    };
    i = (phrases[0] ?? '').length;
    deleting = true;
    timer = window.setTimeout(step, 2600);
    return () => window.clearTimeout(timer);
  }, [phrases]);

  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center truncate text-[15px] text-subtle-foreground">
      <span className="truncate">{text}</span>
      <span className="ml-0.5 inline-block h-[18px] w-px shrink-0 animate-pulse bg-subtle-foreground [animation-duration:1s]" />
    </span>
  );
}

/**
 * The Home search box. Behaviour (answers, bangs, ranking, action panel, keys) comes from the shared omnibox
 * (`useOmnibox` + `OmniPanel`, the same engine as ⌘K); this component is the big pill and its dropdown.
 */
export function OmniSearch({ links }: { links: SearchableLink[] }) {
  const signedIn = useAuthStore(selectSignedIn);
  const [focused, setFocused] = useState(false);
  // Focusing on load (below) must not throw suggestions at you; the box opens once you click, type or press `/`.
  const [engaged, setEngaged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [room, setRoom] = useState(400);
  const blur = useCallback(() => inputRef.current?.blur(), []);
  const omni = useOmnibox({ surface: 'home', links, active: focused, onDone: blur });
  const omniRef = useRef(omni);
  omniRef.current = omni;

  // Focus the box, select what is in it (typing replaces it) and open the dropdown. `/` and ⌘K both land here.
  const focusBox = useCallback((select: boolean) => {
    omniRef.current.closePanel();
    setEngaged(true);
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (select) el.select();
  }, []);

  useHotkeys([{ keys: '/', handler: () => focusBox(false) }]);

  // ⌘K / Ctrl+K means "the omnibox" everywhere: on Home that is this box. Registered while it is mounted, so a layout that
  // hides the search (or another page) falls back to the overlay palette.
  useEffect(() => registerHomeOmnibox({ focus: () => focusBox(true) }), [focusBox]);

  // Focus the box once the page is up (and keep politely trying for a couple of seconds, since browsers often hand focus to
  // their own address bar around a new tab). Never takes focus from a dialog or another field, nor after the person has clicked or typed.
  useEffect(() => {
    const el = inputRef.current;
    return el ? startAutoFocus(el) : undefined;
  }, []);

  const typed = omni.query.trim().length > 0 || Boolean(omni.scope);
  const open = focused && omni.results.length > 0 && (typed || engaged);
  const entering = useEntrance(open);

  // Fit the list into what is left of the window below the box (the footer and a margin come off the top).
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const bottom = formRef.current?.getBoundingClientRect().bottom ?? 0;
      setRoom(Math.max(150, Math.min(400, window.innerHeight - bottom - 8 - 40 - 16)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  return (
    <div className="relative w-full max-w-[680px]">
      {/* biome-ignore lint/a11y/useSemanticElements: <form role=search> works everywhere we support; the <search> element only landed in Chrome 118 (we target 116+) */}
      <form
        ref={formRef}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          omni.activate(omni.selected);
        }}
        onPointerDown={() => setEngaged(true)}
        className={cn(
          'relative flex h-14 items-center rounded-lg border bg-card/80 shadow-md backdrop-blur-md',
          'transition-[border-color,box-shadow,transform] duration-300 ease-out-expo',
          'focus-within:scale-[1.012] focus-within:border-ring focus-within:shadow-[0_0_0_4px_var(--brand-soft),var(--elev-3)]',
        )}
      >
        <span className="pointer-events-none absolute left-4 grid size-5 place-items-center">
          <OmniLeadIcon omni={omni} size="size-[18px]" />
        </span>

        <OmniField
          omni={omni}
          inputRef={inputRef}
          label="Search the web, calculate, or enter a URL"
          expanded={open}
          className="h-full pl-12 pr-24"
          inputClassName="text-[15px]"
          overlay={
            omni.scope ? (
              <span className="pointer-events-none absolute inset-0 flex items-center text-[15px] text-subtle-foreground">Search {omni.scope.name}</span>
            ) : (
              <TypingPlaceholder phrases={signedIn ? SIGNED_IN_PLACEHOLDERS : PLACEHOLDERS} />
            )
          }
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setEngaged(false);
          }}
          onKeyDown={(e) => {
            setEngaged(true);
            if (e.key === 'Escape' && !e.defaultPrevented) blur();
          }}
        />

        <div className="absolute right-2 flex items-center gap-1.5">
          <AnimatePresence initial={false}>
            {typed ? (
              <motion.button
                key="clear"
                type="button"
                aria-label="Clear search"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={spring.snappy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  omni.reset();
                  inputRef.current?.focus();
                }}
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </motion.button>
            ) : (
              <motion.span key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hidden sm:flex">
                <Kbd>/</Kbd>
              </motion.span>
            )}
          </AnimatePresence>
          <button
            type="submit"
            aria-label="Search"
            disabled={!typed}
            className="grid size-9 place-items-center rounded-lg bg-brand text-brand-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.28)] transition-[transform,filter,opacity] duration-150 hover:brightness-110 active:scale-90 disabled:opacity-40"
          >
            <ArrowUpRight className="size-[18px]" />
          </button>
        </div>
      </form>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.1 } }}
            transition={spring.soft}
            style={{ transformOrigin: 'top center' }}
            className="absolute inset-x-0 top-full z-20 mt-2 rounded-lg border bg-popover shadow-pop"
          >
            <OmniPanel omni={omni} entering={entering} maxHeight={room} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
