import { NotebookPen, PenLine, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GroupBar, type GroupItem } from '@/components/GroupBar';
import { InviteDialog } from '@/components/InviteDialog';
import { Button, confirm, EmptyState, Kbd, PageHeader, promptText } from '@/components/ui';
import { NoteEditor } from '@/features/notes/NoteEditor';
import { NoteList } from '@/features/notes/NoteList';
import { useNotesStore } from '@/features/notes/store';
import { useHotkeys } from '@/lib/hotkeys';
import { notify } from '@/lib/toast';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { membersOf } from '@/store/members';
import { useUserStore } from '@/store/useUserStore';

export function NotesView() {
  const notebooks = useNotesStore((s) => s.notebooks);
  const notes = useNotesStore((s) => s.notes);
  const activeNotebookId = useNotesStore((s) => s.activeNotebookId);
  const selectedId = useNotesStore((s) => s.selectedId);
  const query = useNotesStore((s) => s.query);
  const setQuery = useNotesStore((s) => s.setQuery);
  const select = useNotesStore((s) => s.select);
  const setActive = useNotesStore((s) => s.setActiveNotebook);
  const addNote = useNotesStore((s) => s.addNote);
  const createNotebook = useNotesStore((s) => s.createNotebook);
  const renameNotebook = useNotesStore((s) => s.renameNotebook);
  const deleteNotebook = useNotesStore((s) => s.deleteNotebook);
  const restoreNotebook = useNotesStore((s) => s.restoreNotebook);
  const inviteToNotebook = useNotesStore((s) => s.inviteToNotebook);
  const removeMember = useNotesStore((s) => s.removeMember);
  const teammates = useUserStore((s) => s.teammates);
  const currentUser = useUserStore((s) => s.currentUser);

  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [mobileEditor, setMobileEditor] = useState(false);
  const [inviteFor, setInviteFor] = useState<string | null>(null);

  const active = notebooks.find((b) => b.id === activeNotebookId) ?? notebooks[0];
  const nbNotes = useMemo(() => notes.filter((n) => n.notebookId === active?.id), [notes, active?.id]);
  const selected = nbNotes.find((n) => n.id === selectedId) ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: teammates/currentUser re-resolve member profiles
  const members = useMemo(() => (active ? membersOf(active.memberIds) : []), [active, teammates, currentUser]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: member names come from the user store; re-resolve when profiles change
  const groups = useMemo<GroupItem[]>(
    () =>
      notebooks.map((b) => ({
        id: b.id,
        name: b.name,
        count: notes.filter((n) => n.notebookId === b.id).length,
        members: membersOf(b.memberIds).map((p) => ({ id: p.id, name: p.displayName })),
      })),
    [notebooks, notes, teammates, currentUser],
  );

  // If the open note disappears (deleted / undo window passed) go back to the list on mobile.
  useEffect(() => {
    if (!selected) setMobileEditor(false);
  }, [selected]);

  const newNote = () => {
    addNote();
    setMobileEditor(true);
  };

  useHotkeys([{ keys: 'n', enabled: inviteFor === null, handler: newNote }]);

  if (!active) return null;

  const invitingNotebook = notebooks.find((b) => b.id === inviteFor);

  const onCreateNotebook = async () => {
    const name = await promptText({ title: 'New notebook', label: 'Notebook name', placeholder: 'e.g. Project ideas', confirmLabel: 'Create' });
    if (name) createNotebook(name);
  };

  const onRenameNotebook = async (id: string) => {
    const nb = notebooks.find((b) => b.id === id);
    if (!nb) return;
    const name = await promptText({ title: 'Rename notebook', label: 'Notebook name', initial: nb.name, confirmLabel: 'Rename' });
    if (name) renameNotebook(id, name);
  };

  const onDeleteNotebook = async (id: string) => {
    const nb = notebooks.find((b) => b.id === id);
    if (!nb) return;
    const count = notes.filter((n) => n.notebookId === id).length;
    const ok = await confirm({
      title: `Delete “${nb.name}”?`,
      description: count ? `Its ${count} ${count === 1 ? 'note' : 'notes'} will be deleted too. You can undo right after.` : 'This notebook is empty.',
      confirmLabel: 'Delete notebook',
      destructive: true,
    });
    if (!ok) return;
    const snapshot = deleteNotebook(id);
    if (snapshot) notify.undo(`Deleted “${nb.name}”`, () => restoreNotebook(snapshot));
  };

  const showList = isDesktop || !mobileEditor;
  const showEditor = isDesktop || mobileEditor;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <PageHeader
        icon={NotebookPen}
        title="Notes"
        description="Markdown notebooks — private, or shared with your people"
        actions={
          <Button variant="primary" onClick={newNote}>
            <Plus /> New note <Kbd className="ml-1 hidden border-brand-foreground/20 bg-brand-foreground/10 text-brand-foreground sm:inline-flex">N</Kbd>
          </Button>
        }
      />

      <GroupBar
        noun="notebook"
        items={groups}
        activeId={active.id}
        canDelete={notebooks.length > 1}
        onSelect={setActive}
        onCreate={() => void onCreateNotebook()}
        onRename={(id) => void onRenameNotebook(id)}
        onInvite={setInviteFor}
        onDelete={(id) => void onDeleteNotebook(id)}
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        {showList && (
          <NoteList
            notes={nbNotes}
            query={query}
            onQuery={setQuery}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              select(id);
              setMobileEditor(true);
            }}
            onNew={newNote}
            notebookName={active.name}
            shared={members.length > 1}
          />
        )}
        {showEditor &&
          (selected ? (
            <NoteEditor key={selected.id} note={selected} members={members} onBack={() => setMobileEditor(false)} />
          ) : (
            <div className="grid min-h-[240px] place-items-center rounded-2xl border border-dashed p-6">
              <EmptyState icon={PenLine} title="Pick a note to read or edit" description="Your changes save automatically as you type." className="border-0" />
            </div>
          ))}
      </div>

      {invitingNotebook && (
        <InviteDialog
          open
          onOpenChange={(o) => !o && setInviteFor(null)}
          groupName={invitingNotebook.name}
          noun="notebook"
          members={membersOf(invitingNotebook.memberIds)}
          suggestions={teammates.filter((t) => !invitingNotebook.memberIds.includes(t.id))}
          onInvite={(u) => inviteToNotebook(invitingNotebook.id, u)}
          onRemove={(pid) => removeMember(invitingNotebook.id, pid)}
        />
      )}
    </div>
  );
}
