import { NotebookPen } from 'lucide-react';
import { Button, Kbd, Textarea } from '@/components/ui';
import { useHomeLayoutStore } from '@/features/home/layout';
import { splitNote } from '@/features/home/widgets/noteText';
import { WidgetCard } from '@/features/home/widgets/WidgetCard';
import { useNotesStore } from '@/features/notes/store';
import { notify } from '@/lib/toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';

/**
 * A scratch pad on Home. The text is kept until you save it as a real note (or clear it). Notes need an account, so a guest
 * just keeps the text here — saving it would file it somewhere they can't open (the Notes page asks them to sign in).
 */
export function QuickNoteWidget() {
  const draft = useHomeLayoutStore((s) => s.draft);
  const setDraft = useHomeLayoutStore((s) => s.setDraft);
  const go = useNavStore((s) => s.go);
  // `loading` is a stored session still being checked — treat it as an account so a returning user's button doesn't flicker away.
  const account = useAuthStore((s) => s.status !== 'guest');
  const empty = draft.trim().length === 0;

  const save = () => {
    if (empty || !account) return;
    const notes = useNotesStore.getState();
    const id = notes.addNote(splitNote(draft));
    setDraft('');
    notify.action('Saved to Notes', 'Open', () => {
      useNotesStore.getState().select(id);
      go('notes');
    });
  };

  return (
    <WidgetCard icon={NotebookPen} title="Quick note">
      <div className="flex flex-1 flex-col gap-2">
        <Textarea
          aria-label="Quick note"
          placeholder="Jot something down…"
          value={draft}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          className="min-h-24 flex-1"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-subtle-foreground">
            {account ? (
              <>
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd> to save
              </>
            ) : (
              'Kept on this device. Sign in to save notes.'
            )}
          </span>
          <div className="flex gap-1.5">
            {!empty && (
              <Button variant="ghost" size="sm" onClick={() => setDraft('')}>
                Clear
              </Button>
            )}
            {account && (
              <Button variant="primary" size="sm" disabled={empty} onClick={save}>
                Save as note
              </Button>
            )}
          </div>
        </div>
      </div>
    </WidgetCard>
  );
}
