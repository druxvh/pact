import { Globe, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Omnibox } from '@/components/omnibox/useOmnibox';
import { cn } from '@/lib/cn';
import { ANSWER_ICON } from '@/lib/omnibox/providers';
import { resolveInput } from '@/lib/url';

/** The icon at the start of the box says what it understood: a calculation, an address, a site chip, or plain search. */
export function OmniLeadIcon({ omni, size = 'size-4' }: { omni: Omnibox; size?: string }) {
  const top = omni.results[0];
  const q = omni.query.trim();
  const kind = omni.scope ? 'scope' : top?.answer ? top.answer.kind : q && resolveInput(q).kind === 'url' ? 'url' : 'search';
  const Icon = kind === 'url' ? Globe : kind === 'search' || kind === 'scope' ? Search : ANSWER_ICON[kind];
  const plain = kind === 'search' || kind === 'scope';
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={kind}
        aria-hidden="true"
        initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={{ opacity: 0, scale: 0.6, rotate: 20 }}
        transition={{ duration: 0.14 }}
        className="grid place-items-center"
      >
        <Icon className={cn(size, plain ? 'text-muted-foreground' : 'text-brand-text')} />
      </motion.span>
    </AnimatePresence>
  );
}
