import { SearchX } from 'lucide-react';
import { AnimatePresence, LayoutGroup } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ActionPanel } from '@/components/omnibox/ActionPanel';
import { AnimatedHeight } from '@/components/omnibox/AnimatedHeight';
import { AnswerCard } from '@/components/omnibox/AnswerCard';
import { OmniFooter } from '@/components/omnibox/OmniFooter';
import { ResultRow } from '@/components/omnibox/ResultRow';
import type { Omnibox } from '@/components/omnibox/useOmnibox';
import { cn } from '@/lib/cn';
import { scrollToElement } from '@/lib/scroll';

/** True for ~½ s after the omnibox opens: only then do rows stagger in, so typing never replays the entrance. */
export function useEntrance(open: boolean): boolean {
  const [phase, setPhase] = useState<'closed' | 'entering' | 'idle'>(open ? 'entering' : 'closed');
  // derived-state updates during render: they apply before paint, so the very first frame already knows it is entering
  if (open && phase === 'closed') setPhase('entering');
  if (!open && phase !== 'closed') setPhase('closed');
  useEffect(() => {
    if (phase !== 'entering') return;
    const t = window.setTimeout(() => setPhase('idle'), 450);
    return () => window.clearTimeout(t);
  }, [phase]);
  return phase === 'entering';
}

/** Sections + rows + footer + action panel — the part of the omnibox that is identical on Home and in the palette. */
export function OmniPanel({
  omni,
  entering,
  className,
  scrollClassName,
  maxHeight,
}: {
  omni: Omnibox;
  entering: boolean;
  className?: string;
  scrollClassName?: string;
  /** Cap on the scrolling list in px, for hosts that know how much room there is. */
  maxHeight?: number;
}) {
  const { view, index, setIndex, selected, surface, panelOpen, panelActions } = omni;
  const layoutId = `${surface}-omni-highlight`;
  const scroller = useRef<HTMLDivElement>(null);

  // keep the highlighted row in view as the selection moves (rows carry scroll margins so the section header stays visible)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `selected` identity changes whenever the list does, which is exactly when this should re-run
  useEffect(() => {
    if (!selected) return;
    scrollToElement(document.getElementById(omni.optionId(selected)), { block: 'nearest' });
  }, [selected]);

  let n = 0;
  const empty = view.results.length === 0;
  // The action panel needs room: grow the list if it is short, rather than letting the panel spill out.
  const panelMin = panelOpen ? panelActions.length * 36 + 56 : undefined;

  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div ref={scroller} className={cn('min-h-0 overflow-y-auto overscroll-contain', scrollClassName)} style={{ minHeight: panelMin, maxHeight }}>
        <AnimatedHeight>
          <div id={omni.listId} role="listbox" aria-label="Results" className="p-1.5">
            <LayoutGroup id={`${surface}-omni`}>
              {view.sections.map((section) => (
                // biome-ignore lint/a11y/useSemanticElements: a <fieldset> inside a listbox would break the listbox/option ownership screen readers rely on
                <div key={section.id} role="group" aria-labelledby={`${surface}-hdr-${section.id}`} className="pb-0.5">
                  <div className="flex h-7 items-center justify-between px-2.5 pt-1">
                    <span id={`${surface}-hdr-${section.id}`} className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
                      {section.title}
                    </span>
                    {section.headerAction && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={section.headerAction.run}
                        className="rounded-sm px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {section.headerAction.label}
                      </button>
                    )}
                  </div>
                  {section.results.map((r) => {
                    const i = n++;
                    const common = {
                      id: omni.optionId(r),
                      selected: i === index,
                      onHover: () => i !== index && setIndex(i),
                      onActivate: () => omni.execute(r, r.primary),
                    };
                    return r.answer ? (
                      <AnswerCard
                        key={r.id}
                        result={r}
                        copied={omni.copiedId === r.id}
                        onReroll={r.answer.reroll ? () => omni.refresh() : undefined}
                        {...common}
                      />
                    ) : (
                      <ResultRow
                        key={r.id}
                        result={r}
                        enter={entering ? i : undefined}
                        primaryLabel={r.primary.fill !== undefined ? 'Try it' : r.primary.label}
                        onRemove={r.removable}
                        layoutId={layoutId}
                        {...common}
                      />
                    );
                  })}
                </div>
              ))}
              {empty && (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <span className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <SearchX className="size-5" />
                  </span>
                  <p className="text-sm font-medium">Nothing to show</p>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    Press Enter to search the web, or try a sum, a unit like “10 km in mi”, or “!yt lofi”.
                  </p>
                </div>
              )}
            </LayoutGroup>
          </div>
        </AnimatedHeight>
      </div>

      <OmniFooter primaryLabel={omni.footer.primaryLabel} hints={omni.footer.hints} />

      <AnimatePresence>
        {panelOpen && selected && (
          <ActionPanel
            key="panel"
            id={omni.panelId}
            title={selected.answer ? selected.answer.value : selected.title}
            actions={panelActions}
            index={omni.panelIndex}
            setIndex={omni.setPanelIndex}
            idOf={omni.actionId}
            onRun={(a) => omni.execute(selected, a)}
            onClose={omni.closePanel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
