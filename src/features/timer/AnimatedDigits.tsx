import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { ease } from '@/lib/motion';

function Digit({ ch }: { ch: string }) {
  return (
    <span className="relative inline-block h-[1.08em] w-[0.6em] overflow-hidden align-top">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={ch}
          initial={{ y: '55%', opacity: 0, filter: 'blur(3px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '-55%', opacity: 0, filter: 'blur(3px)' }}
          transition={{ duration: 0.24, ease: ease.outExpo }}
          className="absolute inset-0 grid place-items-center"
        >
          {ch}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** "24:07" with each digit sliding independently when it changes. */
export function AnimatedDigits({ value, className, running }: { value: string; className?: string; running?: boolean }) {
  return (
    <span role="timer" aria-live="off" aria-label={value} className={cn('tabular inline-flex items-center font-light leading-none tracking-tighter', className)}>
      {Array.from(value).map((ch, i) =>
        ch === ':' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional by design — each slot is a fixed digit position
          <span key={i} className={cn('w-[0.32em] pb-[0.08em] text-center text-brand-text/80', running && 'animate-pulse [animation-duration:1.4s]')}>
            :
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional by design
          <Digit key={i} ch={ch} />
        ),
      )}
    </span>
  );
}
