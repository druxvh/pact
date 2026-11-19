import { ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { CommandIcon } from '@/features/commands/CommandIcon';
import { SiteIcon } from '@/features/home/SiteIcon';
import { spring } from '@/lib/motion';
import type { Bang } from '@/lib/omnibox/bangs';

/** "YouTube ▸" — the box is now searching that one site. Backspace on an empty box (or a click) removes it. */
export function ScopeChip({ bang, onRemove }: { bang: Bang; onRemove: () => void }) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.85, x: -6 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={spring.snappy}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRemove}
      aria-label={`Searching ${bang.name}. Remove`}
      title="Backspace removes it"
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-brand-soft pl-1.5 pr-1.5 text-[13px] font-medium text-brand-text transition-colors hover:bg-brand/20"
    >
      {bang.icon ? (
        <CommandIcon icon={bang.icon} url={bang.home} title={bang.name} size={16} />
      ) : (
        <SiteIcon url={bang.home} title={bang.name} size={16} chip={false} />
      )}
      <span className="max-w-32 truncate">{bang.name}</span>
      <ChevronRight className="size-3.5 opacity-70" />
    </motion.button>
  );
}
