import { ArrowLeft, Bold, Check, Code, Copy, Heading2, Italic, List, ListChecks, Pin, PinOff, Trash2, UserRound } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  IconButton,
  Segmented,
  Skeleton,
} from '@/components/ui';
import { continueList, type EditResult, prefixLine, toggleTaskOnLine, wrapSelection } from '@/features/notes/editing';
import { useNotesStore } from '@/features/notes/store';
import type { Note } from '@/features/notes/types';
import { copyText } from '@/lib/clipboard';
import { relativeTime } from '@/lib/format';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';
import type { Person } from '@/types/user';

const Markdown = lazy(() => import('@/features/notes/Markdown'));

const SAVE_DELAY_MS = 450;

type Props = {
  note: Note;
  /** Notebook members (assignee picker shows only when there's more than one). */
  members: Person[];
  onBack?: () => void;
};

type FormatKind = 'bold' | 'italic' | 'code' | 'heading' | 'bullet' | 'check';

export function NoteEditor({ note, members, onBack }: Props) {
  const updateNote = useNotesStore((s) => s.updateNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const restoreNote = useNotesStore((s) => s.restoreNote);

  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);

  const pending = useRef<{ title?: string; body?: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // ── Autosave: debounce while typing, flush on blur / note switch / tab hide ──
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!pending.current) return;
    updateNote(note.id, pending.current);
    pending.current = null;
    setSaving(false);
  }, [note.id, updateNote]);

  const schedule = useCallback(
    (patch: { title?: string; body?: string }) => {
      pending.current = { ...pending.current, ...patch };
      setSaving(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  // Switching notes (or leaving the page) must never lose what you just typed.
  useEffect(() => () => flush(), [flush]);
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);

  // Pick up edits made to this same note in another tab — only when we have nothing unsaved.
  useEffect(() => {
    if (pending.current) return;
    setTitle((t) => (t === note.title ? t : note.title));
    setBody((b) => (b === note.body ? b : note.body));
  }, [note.title, note.body]);

  // A fresh, empty note starts with the cursor in the title.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount
  useEffect(() => {
    if (!note.title && !note.body) titleRef.current?.focus();
  }, []);

  const apply = (r: EditResult) => {
    setBody(r.value);
    schedule({ body: r.value });
    requestAnimationFrame(() => {
      const ta = bodyRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(r.selectionStart, r.selectionEnd);
    });
  };

  const format = (kind: FormatKind) => {
    const ta = bodyRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    switch (kind) {
      case 'bold':
        return apply(wrapSelection(body, s, e, '**'));
      case 'italic':
        return apply(wrapSelection(body, s, e, '_'));
      case 'code':
        return apply(wrapSelection(body, s, e, '`'));
      case 'heading':
        return apply(prefixLine(body, s, e, '## '));
      case 'bullet':
        return apply(prefixLine(body, s, e, '- '));
      case 'check':
        return apply(prefixLine(body, s, e, '- [ ] '));
    }
  };

  const onBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      format('bold');
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      format('italic');
    } else if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      const ta = e.currentTarget;
      if (ta.selectionStart !== ta.selectionEnd) return;
      const r = continueList(body, ta.selectionStart);
      if (r) {
        e.preventDefault();
        apply(r);
      }
    }
  };

  const remove = () => {
    window.clearTimeout(timer.current);
    pending.current = null;
    const removed = deleteNote(note.id);
    if (removed) notify.undo(`Deleted “${removed.title.trim() || 'Untitled'}”`, () => restoreNote(removed));
  };

  const assignee = members.find((m) => m.id === note.assigneeId);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const shared = members.length > 1;

  return (
    <section aria-label="Note editor" className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {onBack && (
          <IconButton label="Back to notes" size="icon-sm" onClick={onBack} className="lg:hidden">
            <ArrowLeft />
          </IconButton>
        )}
        <Badge mono>#{note.number}</Badge>
        <span aria-live="polite" className="flex items-center gap-1 text-xs text-muted-foreground">
          <AnimatePresence mode="wait" initial={false}>
            {saving ? (
              <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                <span className="size-1.5 animate-pulse rounded-full bg-warning" /> Saving…
              </motion.span>
            ) : (
              <motion.span
                key="saved"
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={spring.snappy}
                className="flex items-center gap-1"
              >
                <Check className="size-3 text-success-text" /> Saved
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Segmented
            size="sm"
            aria-label="Editor mode"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'write', label: 'Write' },
              { value: 'preview', label: 'Preview' },
            ]}
          />
          <IconButton
            label={note.pinned ? 'Unpin note' : 'Pin note'}
            size="icon-sm"
            onClick={() => updateNote(note.id, { pinned: !note.pinned })}
            className={note.pinned ? 'text-brand-text' : undefined}
          >
            {note.pinned ? <PinOff /> : <Pin />}
          </IconButton>
          {shared && (
            <DropdownMenu>
              <DropdownTrigger render={<IconButton label={assignee ? `Assigned to ${assignee.displayName}` : 'Assign note'} size="icon-sm" />}>
                {assignee ? <Avatar name={assignee.displayName} size="xs" /> : <UserRound />}
              </DropdownTrigger>
              <DropdownContent align="end">
                <DropdownItem onClick={() => updateNote(note.id, { assigneeId: null })}>Unassigned</DropdownItem>
                <DropdownSeparator />
                {members.map((m) => (
                  <DropdownItem
                    key={m.id}
                    icon={<Avatar name={m.displayName} size="xs" />}
                    onClick={() => updateNote(note.id, { assigneeId: m.id })}
                    shortcut={m.id === note.assigneeId ? '●' : undefined}
                  >
                    {m.displayName}
                  </DropdownItem>
                ))}
              </DropdownContent>
            </DropdownMenu>
          )}
          <IconButton label="Copy as Markdown" size="icon-sm" onClick={() => void copyText(`# ${title}\n\n${body}`, 'Note copied as Markdown')}>
            <Copy />
          </IconButton>
          <IconButton label="Delete note" variant="danger" size="icon-sm" onClick={remove}>
            <Trash2 />
          </IconButton>
        </div>
      </div>

      {/* Formatting bar */}
      <AnimatePresence initial={false}>
        {mode === 'write' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.soft}
            className="overflow-hidden border-b"
          >
            <div className="flex items-center gap-0.5 px-2 py-1" role="toolbar" aria-label="Formatting">
              <IconButton label="Bold" shortcut="⌘B" size="icon-xs" onClick={() => format('bold')}>
                <Bold />
              </IconButton>
              <IconButton label="Italic" shortcut="⌘I" size="icon-xs" onClick={() => format('italic')}>
                <Italic />
              </IconButton>
              <IconButton label="Code" size="icon-xs" onClick={() => format('code')}>
                <Code />
              </IconButton>
              <span className="mx-1 h-4 w-px bg-border" />
              <IconButton label="Heading" size="icon-xs" onClick={() => format('heading')}>
                <Heading2 />
              </IconButton>
              <IconButton label="Bulleted list" size="icon-xs" onClick={() => format('bullet')}>
                <List />
              </IconButton>
              <IconButton label="Checklist" size="icon-xs" onClick={() => format('check')}>
                <ListChecks />
              </IconButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-3 pt-4 md:px-7">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            schedule({ title: e.target.value });
          }}
          onBlur={flush}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setMode('write');
              bodyRef.current?.focus();
            }
          }}
          placeholder="Untitled"
          aria-label="Note title"
          className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-subtle-foreground"
        />

        {mode === 'write' ? (
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              schedule({ body: e.target.value });
            }}
            onBlur={flush}
            onKeyDown={onBodyKeyDown}
            placeholder="Start writing… Markdown works: **bold**, - [ ] tasks, ## headings"
            aria-label="Note body"
            spellCheck
            className="mt-3 min-h-[240px] w-full flex-1 resize-none bg-transparent text-[15px] leading-7 outline-none placeholder:text-subtle-foreground"
          />
        ) : (
          <div className="mt-3 flex-1">
            {body.trim() ? (
              <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                <Markdown
                  source={body}
                  onToggleLine={(line) => {
                    const next = toggleTaskOnLine(body, line);
                    setBody(next);
                    updateNote(note.id, { body: next });
                  }}
                />
              </Suspense>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t px-5 py-2 text-[11px] text-subtle-foreground md:px-7">
        <span>
          {words} {words === 1 ? 'word' : 'words'}
        </span>
        <span>Edited {relativeTime(note.updatedAt)}</span>
      </div>
    </section>
  );
}
