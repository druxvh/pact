import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui';
import { CommandForm } from '@/features/commands/CommandForm';
import { CommandsManager } from '@/features/commands/CommandsManager';
import { KIND_LABEL } from '@/features/commands/model';
import { useCommandsStore } from '@/features/commands/store';
import { useCommandsUi } from '@/features/commands/ui';
import { modCombo } from '@/lib/hotkeys';

/**
 * The compact dialogs behind the omnibox's "Create Quicklink / Snippet / Alias", a result's "Edit" and "Manage commands".
 * Mounted once, next to the palette, so they work from Home and from every other page.
 */
export function CommandDialogs() {
  const dialog = useCommandsUi((s) => s.dialog);
  const close = useCommandsUi((s) => s.close);
  const editing = useCommandsStore((s) => (dialog?.type === 'edit' ? s.items.find((c) => c.id === dialog.id) : undefined));

  const form = dialog?.type === 'create' || (dialog?.type === 'edit' && editing);
  const kind = dialog?.type === 'create' ? dialog.kind : (editing?.kind ?? 'quicklink');

  return (
    <>
      <Dialog open={Boolean(form)} onOpenChange={(open) => !open && close()}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{dialog?.type === 'edit' ? `Edit ${KIND_LABEL[kind].one.toLowerCase()}` : `Create ${KIND_LABEL[kind].one}`}</DialogTitle>
            <DialogDescription>Yours alone — kept on this device, and it works without an account.</DialogDescription>
          </DialogHeader>
          {/* remount per target so the form always starts from the right values */}
          {dialog?.type === 'create' && (
            <CommandForm key={`new-${dialog.kind}`} kind={dialog.kind} initial={dialog.draft} variant="dialog" onDone={close} onCancel={close} />
          )}
          {dialog?.type === 'edit' && editing && (
            <CommandForm key={editing.id} kind={editing.kind} editing={editing} variant="dialog" onDone={close} onCancel={close} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.type === 'manage'} onOpenChange={(open) => !open && close()}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Your commands</DialogTitle>
            <DialogDescription>Quicklinks, snippets and aliases for the search box and {modCombo('K')}.</DialogDescription>
          </DialogHeader>
          <DialogBody>{dialog?.type === 'manage' && <CommandsManager />}</DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
