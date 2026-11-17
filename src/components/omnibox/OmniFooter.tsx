import { CornerDownLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { FooterHint } from '@/components/omnibox/useOmnibox';
import { Kbd } from '@/components/ui';

/** What ↵ will do right now (it follows the highlight), and the keys that are live. */
export function OmniFooter({ primaryLabel, hints }: { primaryLabel: string | null; hints: FooterHint[] }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-4 border-t px-3 text-[11px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">
        <Kbd aria-hidden="true">
          <CornerDownLeft className="size-3" />
        </Kbd>
        <span className="relative min-w-0 truncate">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={primaryLabel ?? 'none'}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="block truncate text-foreground/80"
            >
              {primaryLabel ?? 'Select a result'}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3.5">
        {hints.map((h, i) => (
          <span key={h.label} className={i < 2 ? 'flex items-center gap-1.5' : 'hidden items-center gap-1.5 sm:flex'}>
            <span className="flex items-center gap-0.5">
              {h.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
            <span className="hidden md:inline">{h.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
