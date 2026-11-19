import { ArrowRight, Check, Copy, CornerDownLeft, Lock, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { Kbd } from '@/components/ui';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { copyKeepingFocus } from '@/lib/omnibox/providers';
import type { Answer, OmniResult } from '@/lib/omnibox/types';

const LABELS: Record<Answer['kind'], [string, string]> = {
  math: ['Input', 'Result'],
  convert: ['From', 'To'],
  date: ['Question', 'Answer'],
  time: ['Place', 'Time'],
  color: ['Colour', 'HEX'],
  random: ['Request', 'Result'],
  encode: ['Input', 'Output'],
  intent: ['Action', 'Start'],
};

const CHECKER = 'bg-[length:10px_10px] bg-[conic-gradient(var(--muted)_25%,var(--background)_0_50%,var(--muted)_0_75%,var(--background)_0)]';

function Caption({ children }: { children: React.ReactNode }) {
  return <span className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">{children}</span>;
}

/**
 * The inline answer, Raycast-calculator style: what you asked on the left, the big result on the right.
 * ↵ (or a click) copies it — the value pops and a "Copied" chip lands.
 */
export function AnswerCard({
  result,
  id,
  selected,
  copied,
  onHover,
  onActivate,
  onReroll,
}: {
  result: OmniResult;
  id: string;
  selected: boolean;
  copied: boolean;
  onHover: () => void;
  onActivate: () => void;
  onReroll?: () => void;
}) {
  const a = result.answer;
  if (!a) return null;
  const [leftLabel, rightLabel] = LABELS[a.kind];
  const isColor = a.kind === 'color' && a.swatch;
  const cta = a.cta;

  return (
    <div className="@container relative">
      {/* biome-ignore lint/a11y/useFocusableInteractive: options are chosen via aria-activedescendant on the combobox input */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the combobox input (arrows + Enter) */}
      <div
        id={id}
        role="option"
        aria-selected={selected}
        data-copied={copied || undefined}
        aria-label={`${a.expression}: ${a.value}`}
        onMouseMove={onHover}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onActivate}
        className={cn(
          'relative cursor-pointer overflow-hidden rounded-lg border bg-card/70 transition-[border-color,box-shadow] duration-200',
          selected ? 'border-brand/45 shadow-[0_0_0_3px_var(--brand-soft)]' : 'border-border',
        )}
      >
        {selected && <span aria-hidden="true" className="absolute inset-0 bg-brand-soft/60" />}
        <div className="relative grid grid-cols-1 gap-3 p-3.5 @md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.25fr)] @md:items-center">
          {isColor ? (
            <div className="flex items-center gap-3 @md:col-span-3">
              <span aria-hidden="true" className={cn('size-14 shrink-0 overflow-hidden rounded-lg border shadow-sm', a.swatch?.includes('/') && CHECKER)}>
                <span className="block size-full" style={{ background: a.swatch }} />
              </span>
              <span className="min-w-0">
                <Caption>{a.expression}</Caption>
                <motion.span
                  key={copied ? 'c' : 'n'}
                  animate={copied ? { scale: [1, 1.06, 1] } : undefined}
                  transition={{ duration: 0.35 }}
                  className="block origin-left truncate font-mono text-2xl font-semibold tracking-tight"
                >
                  {a.value}
                </motion.span>
                {a.caption && <span className="block truncate text-xs text-muted-foreground">{a.caption}</span>}
              </span>
            </div>
          ) : (
            <>
              <div className="min-w-0">
                <Caption>{leftLabel}</Caption>
                <span className="block truncate text-sm text-muted-foreground" title={a.expression}>
                  {a.expression}
                </span>
              </div>
              <span aria-hidden="true" className="hidden size-6 place-items-center rounded-full bg-muted text-muted-foreground @md:grid">
                <ArrowRight className="size-3.5" />
              </span>
              <div className="min-w-0">
                <Caption>{rightLabel}</Caption>
                <motion.span
                  key={copied ? 'copied' : 'idle'}
                  animate={copied ? { scale: [1, 1.07, 1] } : undefined}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'block origin-left text-2xl font-semibold leading-8 tracking-tight',
                    a.mono ? 'line-clamp-2 break-all font-mono text-lg leading-7' : 'truncate',
                  )}
                  title={a.value}
                >
                  {a.value}
                </motion.span>
              </div>
            </>
          )}
        </div>

        {(a.caption && !isColor) || a.rows?.length || onReroll || cta || a.copy ? (
          <div className="relative flex items-center gap-2 border-t border-border/70 px-3.5 py-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{!isColor && a.caption}</span>
            {onReroll && (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Roll again"
                title="Roll again"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  onReroll();
                }}
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <RefreshCw className="size-3.5" />
              </button>
            )}
            {copied ? (
              <motion.span
                key="copied"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={spring.bouncy}
                className="flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success-text"
              >
                <Check className="size-3" /> Copied
              </motion.span>
            ) : (
              <span key="hint" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {result.locked ? <Lock className="size-3" /> : cta ? null : <Copy className="size-3" />}
                {cta ?? 'Copy'}
                <Kbd>
                  <CornerDownLeft className="size-3" />
                </Kbd>
              </span>
            )}
          </div>
        ) : null}

        {a.rows && a.rows.length > 0 && (
          <div className={cn('relative grid gap-px border-t border-border/70 bg-border/70', isColor ? 'grid-cols-2' : 'grid-cols-1')}>
            {a.rows.map((row) => (
              <button
                key={row.label}
                type="button"
                tabIndex={-1}
                disabled={!row.copy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (row.copy) void copyKeepingFocus(row.copy, `${row.label} copied`);
                }}
                className="group/row flex min-w-0 items-baseline gap-2 bg-card px-3.5 py-1.5 text-left transition-colors enabled:hover:bg-muted"
              >
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">{row.label}</span>
                <span className="min-w-0 truncate font-mono text-xs text-foreground/90" title={row.value}>
                  {row.value}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
