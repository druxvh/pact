import { useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui';
import { type CaptureDone, CaptureSheet } from '@/features/capture/CaptureSheet';
import { useNotesStore } from '@/features/notes/store';
import { notify } from '@/lib/toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';

/** The in-app quick capture: press `C` anywhere in pact (or use the command palette). Same sheet as the toolbar popup. */
export function CaptureDialog() {
  const open = useUiStore((s) => s.captureOpen);
  const setOpen = useUiStore((s) => s.setCaptureOpen);
  // `loading` means a stored session is still being checked — that's an account, so don't file it as a guest's scratch text.
  const account = useAuthStore((s) => s.status !== 'guest');
  const go = useNavStore((s) => s.go);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const onDone = useCallback<CaptureDone>(
    (saved) => {
      setOpen(false);
      if (!saved) return;
      if (saved.kind === 'note') {
        const id = saved.id;
        notify.action(
          'Saved to Notes',
          'Open',
          () => {
            const notes = useNotesStore.getState();
            const note = notes.notes.find((n) => n.id === id);
            if (note) notes.setActiveNotebook(note.notebookId);
            useNotesStore.getState().select(id);
            go('notes');
          },
          saved.where,
        );
      } else if (saved.kind === 'task') {
        notify.action('Task added', 'Open', () => go('kanban'), saved.where);
      }
    },
    [setOpen, go],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="sm" initialFocus={textareaRef} className="max-w-[26rem]">
        <CaptureSheet
          variant="dialog"
          account={account}
          textareaRef={textareaRef}
          onDone={onDone}
          title={
            <>
              <DialogTitle className="whitespace-nowrap">Quick capture</DialogTitle>
              <DialogDescription className="sr-only">Write a note or a task, then press Command or Control plus Enter to save.</DialogDescription>
            </>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
