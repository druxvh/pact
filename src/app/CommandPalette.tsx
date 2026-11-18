import { Dialog as D } from '@base-ui/react/dialog';
import { useCallback, useEffect } from 'react';
import { OmniField } from '@/components/omnibox/OmniField';
import { OmniLeadIcon } from '@/components/omnibox/OmniLeadIcon';
import { OmniPanel, useEntrance } from '@/components/omnibox/OmniList';
import { useOmnibox } from '@/components/omnibox/useOmnibox';
import { Kbd } from '@/components/ui';
import { CommandDialogs } from '@/features/commands/CommandDialogs';
import { useUiStore } from '@/store/useUiStore';

/**
 * ⌘K — the omnibox as a floating palette. All the behaviour (answers, bangs, ranking, action panel, keyboard) lives in
 * `useOmnibox` / `OmniPanel`, shared with the Home search box; this file is only the dialog around it.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const omni = useOmnibox({ surface: 'palette', active: open, onDone: close });
  const entering = useEntrance(open);
  const { reset } = omni;

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  return (
    <>
      <D.Root
        open={open}
        onOpenChange={(next, details) => {
          // Esc peels one layer off (action panel → text → chip) before it closes the palette.
          if (!next && details.reason === 'escape-key' && omni.peel()) {
            details.cancel();
            return;
          }
          setOpen(next);
        }}
      >
        <D.Portal>
          <D.Backdrop className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[3px] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
          <D.Viewport className="fixed inset-0 z-[60] grid items-start justify-items-center overflow-y-auto p-4 pt-[12vh]">
            <D.Popup
              aria-label="Command palette"
              className="w-full max-w-[640px] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-pop outline-none transition-[opacity,transform] duration-200 ease-out-expo data-[starting-style]:-translate-y-2 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0"
            >
              <D.Title className="sr-only">Command palette</D.Title>
              <div className="flex items-center gap-3 border-b px-4">
                <span className="grid size-4 shrink-0 place-items-center">
                  <OmniLeadIcon omni={omni} />
                </span>
                <OmniField
                  omni={omni}
                  autoFocus
                  label="Search, calculate, jump to a page or run a command"
                  expanded
                  className="h-12"
                  inputClassName="text-[15px] placeholder:text-subtle-foreground"
                  placeholder={omni.scope ? `Search ${omni.scope.name}…` : 'Search, calculate, jump to a page, or run a command…'}
                />
                <Kbd>esc</Kbd>
              </div>
              <OmniPanel omni={omni} entering={entering} scrollClassName="max-h-[min(440px,56vh)]" />
            </D.Popup>
          </D.Viewport>
        </D.Portal>
      </D.Root>
      <CommandDialogs />
    </>
  );
}
