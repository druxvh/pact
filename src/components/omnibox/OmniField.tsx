import { AnimatePresence } from 'motion/react';
import type { ReactNode, Ref } from 'react';
import { ScopeChip } from '@/components/omnibox/ScopeChip';
import type { Omnibox } from '@/components/omnibox/useOmnibox';
import { cn } from '@/lib/cn';

/**
 * The text field both surfaces share: bang chip, the input with combobox semantics, and the grey "ghost"
 * completion Tab accepts. The surface supplies the sizing (`className`) and any placeholder.
 */
export function OmniField({
  omni,
  inputRef,
  label,
  expanded,
  className,
  inputClassName,
  placeholder,
  overlay,
  onFocus,
  onBlur,
  onKeyDown,
  autoFocus,
}: {
  omni: Omnibox;
  inputRef?: Ref<HTMLInputElement>;
  label: string;
  expanded: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  /** Drawn over the input when it is empty (Home's typewriter). */
  overlay?: ReactNode;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Runs after the omnibox's own keyboard handling (Home blurs on Escape here). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}) {
  const { query, scope, ghostTail } = omni;
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2', className)}>
      <AnimatePresence initial={false}>{scope && <ScopeChip key={scope.id} bang={scope} onRemove={omni.clearScope} />}</AnimatePresence>
      <div className="relative h-full min-w-0 flex-1">
        {ghostTail && query.length < 48 && (
          <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 flex items-center whitespace-pre', inputClassName)}>
            <span className="invisible">{query}</span>
            <span className="text-muted-foreground/60">{ghostTail}</span>
          </span>
        )}
        <input
          ref={inputRef}
          // biome-ignore lint/a11y/noAutofocus: the palette opens on request and typing must start immediately
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => omni.setQuery(e.target.value)}
          onKeyDown={(e) => {
            omni.onKeyDown(e);
            onKeyDown?.(e);
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          role="combobox"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={omni.panelOpen ? omni.panelId : omni.listId}
          aria-haspopup="listbox"
          aria-autocomplete="both"
          aria-activedescendant={omni.activeId}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn('relative h-full w-full min-w-0 bg-transparent outline-none', inputClassName)}
        />
        {!query && overlay}
      </div>
    </div>
  );
}
