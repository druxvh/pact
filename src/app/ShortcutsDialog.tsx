import { SHORTCUTS } from '@/app/routes';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, Kbd } from '@/components/ui';
import { useUiStore } from '@/store/useUiStore';

const GROUPS = ['General', 'Navigate', 'Context'] as const;

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Everything in pact is reachable without the mouse.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid max-h-[min(70vh,640px)] gap-5 overflow-y-auto sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group} className={group === 'Navigate' ? 'sm:row-span-2' : undefined}>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">{group}</h3>
              <ul className="space-y-1.5">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && s.group === 'Navigate' && <span className="text-[10px] text-subtle-foreground">then</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
