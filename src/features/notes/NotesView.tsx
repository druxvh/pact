import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Trash2, Save, X, NotebookPen, Star } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useNotesStore } from '@/features/notes/store';
import { cn } from '@/lib/cn';

export function NotesView() {
  const notebooks = useNotesStore((s) => s.notebooks);
  const activeId = useNotesStore((s) => s.activeNotebookId);
  const setActive = useNotesStore((s) => s.setActiveNotebook);
  const createNotebook = useNotesStore((s) => s.createNotebook);
  const notes = useNotesStore((s) => s.notes);
  const selectedId = useNotesStore((s) => s.selectedId);
  const select = useNotesStore((s) => s.select);
  const query = useNotesStore((s) => s.query);
  const setQuery = useNotesStore((s) => s.setQuery);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);

  const activeNotebook = notebooks.find((b) => b.id === activeId) ?? notebooks[0];
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);

  const filtered = useMemo(() => {
    const base = notes.filter((n) => n.notebookId === activeNotebook?.id);
    const q = query.toLowerCase().trim();
    if (!q) return base;
    return base.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  }, [notes, query, activeNotebook]);

  const selected = notes.find((n) => n.id === selectedId && n.notebookId === activeNotebook?.id) ?? filtered[0] ?? null;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="space-y-4">
      {/* Top — notebooks as minimal groups (inspired by kanban, but no invite) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Notes</h2>
            <span className="hidden text-xs text-muted-foreground md:inline">· minimal, useful</span>
          </div>
          <div className="flex items-center gap-1.5">
            <AnimatePresence>
              {showNew && (
                <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 200 }} exit={{ opacity: 0, width: 0 }} className="overflow-hidden">
                  <div className="flex gap-1">
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Notebook name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { createNotebook(newName); setNewName(''); setShowNew(false); } if (e.key === 'Escape') setShowNew(false); }} className="h-8 w-full rounded-sm border border-input bg-background px-2.5 text-sm outline-none focus:border-ring" />
                    <Button size="sm" className="h-8 rounded-sm" onClick={() => { if (newName.trim()) createNotebook(newName); setNewName(''); setShowNew(false); }}>Add</Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Button variant="ghost" size="sm" className="h-8 rounded-sm border border-border" onClick={() => setShowNew((v) => !v)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New notebook
            </Button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {notebooks.map((b) => {
            const isActive = b.id === activeNotebook?.id;
            const count = notes.filter((n) => n.notebookId === b.id).length;
            return (
              <motion.button
                key={b.id}
                onClick={() => setActive(b.id)}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className={`group flex shrink-0 items-center gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors ${isActive ? 'border-accent bg-accent text-accent-foreground shadow-sm' : 'border-border bg-card hover:border-accent/30 hover:bg-accent/5'}`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-sm text-xs font-medium ${isActive ? 'bg-accent-foreground text-accent' : 'bg-muted text-muted-foreground'}`}>
                  {b.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-medium ${isActive ? 'text-accent-foreground' : 'text-foreground'}`}>{b.name}</span>
                  <span className={`block text-xs ${isActive ? 'text-accent-foreground/80' : 'text-muted-foreground'}`}>{count} notes</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Toolbar — search + new (minimal) */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" className="h-8 w-44 rounded-sm border border-input bg-card pl-8 pr-7 text-sm placeholder:text-muted-foreground outline-none transition-colors focus:border-ring" />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-accent">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <span className="hidden text-xs text-muted-foreground md:inline">{filtered.length} notes in {activeNotebook?.name}</span>
        </div>
        <Button className="gap-1.5 rounded-sm" onClick={() => addNote('Untitled', 'Start writing…')}>
          <Plus className="h-4 w-4" /> New note
        </Button>
      </div>

      {/* Main — minimal, no outer borders, polished */}
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        {/* Grid */}
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="flex h-[220px] flex-col items-center justify-center rounded-sm border border-dashed border-border/60 bg-transparent p-6 text-center">
              <Star className="h-5 w-5 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium text-foreground">No notes</p>
              <p className="text-xs text-muted-foreground">in {activeNotebook?.name} — add one</p>
              <Button size="sm" className="mt-3 rounded-sm" onClick={() => addNote('Untitled', 'Start writing…')}>
                + New note
              </Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {filtered.map((n) => (
                <motion.button
                  key={n.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => select(n.id)}
                  className={cn(
                    'w-full rounded-sm border p-3 text-left shadow-sm transition-all',
                    selected?.id === n.id ? 'border-accent bg-accent/10 ring-1 ring-accent/20' : 'border-transparent bg-card hover:shadow-md dark:border-border/60 hover:border-accent/20',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-sm bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent">#{n.number}</span>
                    <span className="text-[11px] text-muted-foreground">{new Date(n.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-foreground">{n.title || 'Untitled'}</p>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{n.body || 'No content'}</p>
                </motion.button>
              ))}
            </div>
          )}
          <button onClick={() => addNote('Untitled', 'Start writing…')} className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border/60 bg-transparent py-2.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground">
            <Plus className="h-3 w-3" /> Add note
          </button>
        </div>

        {/* Editor */}
        <div className="min-h-[320px]">
          <AnimatePresence mode="wait">
            {!selected ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-sm bg-muted/20 p-6 text-center">
                <NotebookPen className="h-6 w-6 text-muted-foreground/40" />
                <p className="mt-2 text-sm font-medium text-foreground">Select a note</p>
                <p className="mt-1 text-xs text-muted-foreground">Minimal, useful — just write</p>
              </motion.div>
            ) : (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-sm bg-card p-4 shadow-sm border border-transparent dark:border-border/60">
                <NoteEditor note={selected} onSave={(title, body) => updateNote(selected.id, { title, body })} onDelete={() => deleteNote(selected.id)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

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
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-sm border border-input bg-background px-3 py-2.5 text-lg font-semibold outline-none transition-colors focus:border-ring" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write something…" rows={10} className="min-h-[180px] w-full resize-none rounded-sm border border-input bg-background p-3 text-sm leading-6 outline-none transition-colors focus:border-ring" />
      <AnimatePresence>
        {dirty && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-amber-600 dark:text-amber-400">
            Unsaved — Save
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
