import { useMemo, useState } from 'react';
import { Plus, Search, Trash2, Save, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useNotesStore } from '@/store/useNotesStore';
import { cn } from '@/lib/cn';

export function NotesView() {
  const notes = useNotesStore((s) => s.notes);
  const selectedId = useNotesStore((s) => s.selectedId);
  const query = useNotesStore((s) => s.query);
  const setQuery = useNotesStore((s) => s.setQuery);
  const select = useNotesStore((s) => s.select);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  }, [notes, query]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Notes</h2>
          <p className="text-xs text-muted-foreground">{notes.length} notes · synced locally (mock) · spaces-ready</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="h-8 w-44 rounded-sm border border-input bg-card pl-8 pr-7 text-sm placeholder:text-muted-foreground outline-none transition-colors focus:border-ring"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-accent">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button className="gap-1.5 rounded-sm" onClick={() => addNote('Untitled', 'Start writing…')}>
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit max-h-[60vh] overflow-hidden p-2">
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {filtered.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 text-center">
                  <p className="text-sm font-medium text-foreground">No notes</p>
                  <p className="text-xs text-muted-foreground">Try another search or create one</p>
                </motion.div>
              ) : (
                <div className="space-y-1.5">
                  {filtered.map((n) => (
                    <motion.button
                      key={n.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      onClick={() => select(n.id)}
                      className={cn(
                        'w-full rounded-sm border p-3 text-left transition-colors',
                        selectedId === n.id ? 'border-primary bg-accent' : 'border-border bg-background hover:bg-accent/50',
                      )}
                    >
                      <p className="truncate text-sm font-medium text-foreground">{n.title || 'Untitled'}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{n.body || 'No content'}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">{new Date(n.updatedAt).toLocaleString()}</p>
                    </motion.button>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </Card>

        <Card className="min-h-[320px]">
          <AnimatePresence mode="wait">
            {!selected ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-[280px] flex-col items-center justify-center rounded-sm border border-dashed border-border bg-background p-6 text-center">
                <p className="text-sm font-medium text-foreground">Select a note</p>
                <p className="mt-1 text-xs text-muted-foreground">or create a new one — everything is mock-synced</p>
                <Button className="mt-4 rounded-sm" onClick={() => addNote()}>+ New note</Button>
              </motion.div>
            ) : (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                <NoteEditor note={selected} onSave={(title, body) => updateNote(selected.id, { title, body })} onDelete={() => deleteNote(selected.id)} />
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="grid gap-2 md:grid-cols-3">
        {notes.slice(0, 3).map((n) => (
          <Card key={`preview-${n.id}`} hover onClick={() => select(n.id)} className="p-3">
            <p className="text-sm font-medium text-foreground">{n.title}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
          </Card>
        ))}
      </motion.div>
    </motion.div>
  );
}

function NoteEditor({ note, onSave, onDelete }: { note: { id: string; title: string; body: string; updatedAt: string }; onSave: (t: string, b: string) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const dirty = title !== note.title || body !== note.body;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Editing · {new Date(note.updatedAt).toLocaleString()}</p>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onDelete} className="rounded-sm text-destructive hover:bg-destructive/10">
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
          </Button>
          <Button size="sm" disabled={!dirty} onClick={() => onSave(title, body)} className="gap-1 rounded-sm">
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full rounded-sm border border-input bg-background px-3 py-2.5 text-lg font-semibold outline-none transition-colors focus:border-ring"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write something…"
        rows={10}
        className="min-h-[180px] w-full resize-none rounded-sm border border-input bg-background p-3 text-sm leading-6 outline-none transition-colors focus:border-ring"
      />
      <AnimatePresence>
        {dirty && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-amber-600 dark:text-amber-400">
            Unsaved changes — hit Save (mock sync)
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
