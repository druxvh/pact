import { ChevronRight, CornerDownLeft, Lock, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Highlight } from '@/components/omnibox/Highlight';
import { HIGHLIGHT_SPRING, TILE } from '@/components/omnibox/tone';
import { Kbd } from '@/components/ui';
import { SiteIcon } from '@/features/home/SiteIcon';
import { cn } from '@/lib/cn';
import type { OmniResult } from '@/lib/omnibox/types';

export function ResultIcon({ result }: { result: OmniResult }) {
  if (result.emoji) {
    return (
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-base leading-none">
        {result.emoji}
      </span>
    );
  }
  if (result.site) return <SiteIcon url={result.site.url} title={result.site.title} size={32} />;
  const Icon = result.icon;
  return (
    <span aria-hidden="true" className={cn('grid size-8 shrink-0 place-items-center rounded-md', TILE[result.group], result.locked && 'opacity-70')}>
      <Icon className="size-4" />
    </span>
  );
}

type Props = {
  result: OmniResult;
  id: string;
  selected: boolean;
  /** Shared-layout id of the gliding highlight (one per surface). */
  layoutId: string;
  /** Entrance stagger index; `undefined` = mount without animating (typing never replays it). */
  enter?: number;
  onHover: () => void;
  onActivate: () => void;
  onRemove?: () => void;
  /** Label of the primary action, shown next to ↵ on the selected row. */
  primaryLabel?: string;
};

export function ResultRow({ result, id, selected, layoutId, enter, onHover, onActivate, onRemove, primaryLabel }: Props) {
  return (
    <motion.div
      initial={enter === undefined ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: (enter ?? 0) * 0.02, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* biome-ignore lint/a11y/useFocusableInteractive: options are chosen via aria-activedescendant on the combobox input */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the combobox input (arrows + Enter) */}
      <div
        id={id}
        role="option"
        aria-selected={selected}
        aria-disabled={result.locked || undefined}
        onMouseMove={onHover}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onActivate}
        className="group relative flex min-h-12 scroll-mt-9 scroll-mb-2 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5"
      >
        {selected && (
          <motion.span layoutId={layoutId} transition={HIGHLIGHT_SPRING} className="absolute inset-0 rounded-lg bg-accent">
            <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-brand" />
          </motion.span>
        )}
        <span className="relative">
          <ResultIcon result={result} />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className={cn('block truncate text-sm leading-5', result.locked && 'text-muted-foreground')}>
            <Highlight text={result.title} indices={result.matches} />
          </span>
          {result.subtitle && <span className="block truncate text-xs leading-4 text-muted-foreground">{result.subtitle}</span>}
        </span>
        <span className="relative flex shrink-0 items-center gap-1.5">
          {result.locked && <Lock aria-hidden="true" className="size-3.5 text-subtle-foreground" />}
          {result.hint && (
            <span
              title="Your alias"
              className="max-w-24 truncate rounded-sm border bg-background/60 px-1.5 py-px font-mono text-[11px] leading-4 text-muted-foreground"
            >
              {result.hint}
            </span>
          )}
          {!selected && result.kbd?.map((k) => <Kbd key={k}>{k}</Kbd>)}
          {onRemove && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Remove “${result.title}” from recent searches`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className={cn(
                'grid size-6 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-background hover:text-foreground',
                selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              <X className="size-3.5" />
            </button>
          )}
          {selected && !onRemove && (
            <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
              {primaryLabel && <span className="max-w-32 truncate">{primaryLabel}</span>}
              <Kbd>
                <CornerDownLeft className="size-3" />
              </Kbd>
            </span>
          )}
          {selected && !onRemove && <ChevronRight aria-hidden="true" className="size-3.5 text-subtle-foreground sm:hidden" />}
        </span>
      </div>
    </motion.div>
  );
}
