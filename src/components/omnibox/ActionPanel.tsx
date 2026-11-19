import { motion } from 'motion/react';
import { HIGHLIGHT_SPRING } from '@/components/omnibox/tone';
import { Kbd } from '@/components/ui';
import { cn } from '@/lib/cn';
import { MOD_KEY } from '@/lib/hotkeys';
import { hotkeyCaps } from '@/lib/omnibox/keys';
import type { OmniAction } from '@/lib/omnibox/types';

/** Raycast's signature: a compact menu of everything you can do with the highlighted result. Keys stay in the input. */
export function ActionPanel({
  id,
  title,
  actions,
  index,
  setIndex,
  idOf,
  onRun,
  onClose,
}: {
  id: string;
  title: string;
  actions: OmniAction[];
  index: number;
  setIndex: (i: number) => void;
  idOf: (a: OmniAction) => string;
  onRun: (a: OmniAction) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div aria-hidden="true" className="absolute inset-0 z-10" onMouseDown={(e) => e.preventDefault()} onClick={onClose} />
      <motion.div
        id={id}
        role="menu"
        aria-label={`Actions for ${title}`}
        initial={{ opacity: 0, scale: 0.94, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.1 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        style={{ transformOrigin: 'bottom right' }}
        className="absolute bottom-12 right-2 z-20 w-[min(17rem,calc(100%-1rem))] rounded-lg border bg-popover p-1 shadow-pop"
      >
        <div className="truncate px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground">{title}</div>
        {actions.map((a, i) => {
          const Icon = a.icon;
          const selected = i === index;
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: items are chosen via aria-activedescendant on the combobox input
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the combobox input
            <div
              key={a.id}
              id={idOf(a)}
              role="menuitem"
              aria-current={selected || undefined}
              onMouseMove={() => i !== index && setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRun(a)}
              className={cn('relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm', a.destructive && 'text-destructive-text')}
            >
              {selected && <motion.span layoutId={`${id}-hl`} transition={HIGHLIGHT_SPRING} className="absolute inset-0 rounded-md bg-accent" />}
              {Icon && <Icon aria-hidden="true" className="relative size-4 shrink-0 opacity-80" />}
              <span className="relative min-w-0 flex-1 truncate">{a.label}</span>
              <span className="relative flex shrink-0 items-center gap-1">
                {i === 0 && <Kbd>↵</Kbd>}
                {a.hotkey && hotkeyCaps(a.hotkey, MOD_KEY).map((k) => <Kbd key={k}>{k}</Kbd>)}
              </span>
            </div>
          );
        })}
      </motion.div>
    </>
  );
}
