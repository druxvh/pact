import { Check, ChevronDown, Keyboard, ListTodo, NotebookPen } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/Logo';
import { Button, Kbd, Segmented, Textarea } from '@/components/ui';
import { type CaptureKind, MAX_CAPTURE_CHARS, pickId, type SaveResult } from '@/features/capture/capture';
import { openShortcutSettings, readCaptureShortcut } from '@/features/capture/shortcut';
import { saveCapture, useCaptureStore } from '@/features/capture/store';
import { COLUMNS, type ColumnId, useKanbanStore } from '@/features/kanban/store';
import { useNotesStore } from '@/features/notes/store';
import { cn } from '@/lib/cn';
import { MOD_KEY } from '@/lib/hotkeys';
import { spring } from '@/lib/motion';

export type Saved = Extract<SaveResult, { ok: true }>;
export type CaptureDone = (saved: Saved | null) => void;

type Props = {
  /** Signed in (or a session is stored): notes and tasks. Otherwise a guest, who can only keep text in Home's quick note. */
  account: boolean;
  /** The toolbar popup is its own window; the dialog lives inside pact. */
  variant: 'popup' | 'dialog';
  /** The heading — a `DialogTitle` inside a dialog, a plain heading in the popup. */
  title: ReactNode;
  /** The textarea, so a Dialog can aim its initial focus at it. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Fires once the sheet is finished: after the "saved" confirmation, or `null` when cancelled with Esc. */
  onDone: CaptureDone;
};

const PROBLEMS: Record<Extract<SaveResult, { ok: false }>['reason'], string> = {
  empty: 'Type something first.',
  'too-long': 'That’s too long to save. Trim it a little.',
  'no-destination': 'Couldn’t find where to save this. Pick a destination below.',
};

/** A tiny native <select> that looks like a chip. Native, so its menu isn't clipped by the popup's small window. */
function PickChip({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const shell =
    'inline-flex h-7 min-w-0 max-w-[11rem] items-center gap-1.5 rounded-md border border-input bg-card/50 pl-2 text-xs text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';
  if (options.length <= 1) {
    return (
      <span className={cn(shell, 'pr-2')}>
        <span className="sr-only">{label}: </span>
        {icon}
        <span className="truncate">{current?.label ?? '—'}</span>
      </span>
    );
  }
  return (
    <label
      className={cn(
        shell,
        'relative cursor-pointer pr-1.5 transition-[border-color,box-shadow] duration-150 hover:border-foreground/25 focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15',
      )}
    >
      <span className="sr-only">{label}</span>
      {icon}
      <select
        value={current?.value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent pr-4 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5" />
    </label>
  );
}

/** "Open this from any tab with ⌥⇧N · Change" — the popup's footer, using whatever shortcut is bound right now. */
function ShortcutLine() {
  const [keys, setKeys] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    void readCaptureShortcut().then((k) => alive && setKeys(k));
    return () => {
      alive = false;
    };
  }, []);
  if (keys === null) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Keyboard className="size-3.5 shrink-0" aria-hidden="true" />
        {keys.length > 0 ? (
          <>
            <span className="truncate">Open from any tab</span>
            <span className="flex gap-0.5">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </>
        ) : (
          <span className="truncate">No shortcut set</span>
        )}
      </span>
      <button
        type="button"
        onClick={openShortcutSettings}
        title="Opens chrome://extensions/shortcuts"
        className="shrink-0 rounded-sm text-brand-text underline-offset-4 outline-offset-2 hover:underline"
      >
        {keys.length > 0 ? 'Change' : 'Set one'}
      </button>
    </div>
  );
}

/**
 * The capture form: a focused textarea, Note | Task, where it will land, and ⌘↵ to save.
 * One component for both homes — the toolbar popup and the in-app dialog.
 */
export function CaptureSheet({ account, variant, title, textareaRef, onDone }: Props) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? ownRef;
  const kindPref = useCaptureStore((s) => s.kind);
  const text = useCaptureStore((s) => s.draft);
  const notebookPref = useCaptureStore((s) => s.notebookId);
  const boardPref = useCaptureStore((s) => s.boardId);
  const columnId = useCaptureStore((s) => s.columnId);
  const setKind = useCaptureStore((s) => s.setKind);
  const setDraft = useCaptureStore((s) => s.setDraft);
  const setNotebook = useCaptureStore((s) => s.setNotebook);
  const setBoard = useCaptureStore((s) => s.setBoard);
  const setColumn = useCaptureStore((s) => s.setColumn);
  const notebooks = useNotesStore((s) => s.notebooks);
  const activeNotebookId = useNotesStore((s) => s.activeNotebookId);
  const boards = useKanbanStore((s) => s.boards);
  const activeBoardId = useKanbanStore((s) => s.activeBoardId);

  const kind: CaptureKind = account ? kindPref : 'note';
  const notebookId = pickId(notebooks, notebookPref, activeNotebookId);
  const boardId = pickId(boards, boardPref, activeBoardId);
  const empty = text.trim().length === 0;

  const [saved, setSaved] = useState<Saved | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  // Continue an unsent draft with the caret at its end.
  useEffect(() => {
    const el = ref.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, [ref]);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => done.current(saved), 900);
    return () => window.clearTimeout(t);
  }, [saved]);

  const save = async () => {
    if (busy.current || saved) return;
    if (empty) {
      setProblem(PROBLEMS.empty);
      ref.current?.focus();
      return;
    }
    busy.current = true;
    try {
      const result = await saveCapture({ kind, text, account, notebookId, boardId, columnId });
      if (result.ok) setSaved(result);
      else setProblem(PROBLEMS[result.reason]);
    } finally {
      busy.current = false;
    }
  };

  const onTextKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // Enter confirming an IME candidate isn't "save"
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && (mod || (kind === 'task' && !e.shiftKey && !e.altKey))) {
      e.preventDefault();
      void save();
    } else if (e.key === 'Tab' && account && !mod && !e.shiftKey && !e.altKey) {
      // Tab flips Note ⇄ Task. Shift+Tab still walks backwards, so this never traps the keyboard.
      e.preventDefault();
      setKind(kind === 'note' ? 'task' : 'note');
    }
  };

  const nearLimit = text.length >= MAX_CAPTURE_CHARS * 0.9;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc closes the popup, which has no dialog chrome of its own
    <div
      className={cn('relative', variant === 'popup' && 'w-[400px]')}
      onKeyDown={(e) => {
        if (variant === 'popup' && e.key === 'Escape') done.current(null);
      }}
    >
      <div className={cn('space-y-3 p-4', variant === 'dialog' && 'pr-12')}>
        {/* in the dialog the row is 32px tall so its centre lines up with the dialog's close button */}
        <div className={cn('flex items-center justify-between gap-3', variant === 'dialog' && 'min-h-8')}>
          <div className="flex min-w-0 items-center gap-2">
            {/* Only in the popup: the logo's gradient ids are global, and inside pact the sidebar already owns them (hidden on a phone). */}
            {variant === 'popup' && <Logo className="size-6 drop-shadow-none" />}
            {title}
          </div>
          {account && (
            <Segmented<CaptureKind>
              size="sm"
              aria-label="Capture as"
              value={kind}
              onValueChange={setKind}
              options={[
                { value: 'note', label: 'Note', icon: <NotebookPen /> },
                { value: 'task', label: 'Task', icon: <ListTodo /> },
              ]}
            />
          )}
        </div>

        <div>
          <Textarea
            ref={ref}
            autoFocus
            aria-label={kind === 'task' ? 'New task' : 'New note'}
            aria-describedby="capture-hint"
            aria-invalid={problem ? true : undefined}
            placeholder={kind === 'task' ? 'What needs doing?' : 'Jot something down…'}
            value={text}
            maxLength={MAX_CAPTURE_CHARS}
            onChange={(e) => {
              setDraft(e.target.value);
              if (problem) setProblem(null);
            }}
            onKeyDown={onTextKey}
            className="h-32"
          />
          <div className="mt-1 flex min-h-4 items-center justify-between gap-2 text-[11px]">
            <p id="capture-hint" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-subtle-foreground">
              {account && (
                <>
                  <Kbd>Tab</Kbd> note ⇄ task ·
                </>
              )}
              {kind === 'task' ? (
                <>
                  <Kbd>↵</Kbd> adds it · <Kbd>⇧</Kbd>
                  <Kbd>↵</Kbd> new line
                </>
              ) : (
                <>
                  <Kbd>↵</Kbd> new line · <Kbd>{MOD_KEY}</Kbd>
                  <Kbd>↵</Kbd> saves
                </>
              )}
            </p>
            {nearLimit && (
              <span className="tabular text-subtle-foreground">
                {text.length}/{MAX_CAPTURE_CHARS}
              </span>
            )}
          </div>
          {problem && (
            <p role="alert" className="mt-1.5 rounded-md bg-destructive-soft px-2.5 py-1.5 text-xs text-destructive-text">
              {problem}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Saves to</span>
            {!account ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-card/50 px-2 text-foreground">
                <NotebookPen className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Home · Quick note
              </span>
            ) : kind === 'note' ? (
              <PickChip
                label="Notebook"
                icon={<NotebookPen />}
                value={notebookId}
                options={notebooks.map((n) => ({ value: n.id, label: n.name }))}
                onChange={setNotebook}
              />
            ) : (
              <>
                <PickChip label="Board" icon={<ListTodo />} value={boardId} options={boards.map((b) => ({ value: b.id, label: b.name }))} onChange={setBoard} />
                <PickChip
                  label="Column"
                  icon={<span className="size-1.5 rounded-full bg-brand" />}
                  value={columnId}
                  options={COLUMNS.map((c) => ({ value: c.id, label: c.title }))}
                  onChange={(v) => setColumn(v as ColumnId)}
                />
              </>
            )}
          </div>
          <Button variant="primary" disabled={empty} onClick={() => void save()}>
            {kind === 'task' ? 'Add task' : account ? 'Save note' : 'Save'}
          </Button>
        </div>

        {!account && (
          <p className="text-xs leading-relaxed text-subtle-foreground">
            Without an account, captures are kept in Home’s Quick note. Sign in to save notes and tasks in pact.
          </p>
        )}
      </div>

      {variant === 'popup' && <ShortcutLine />}

      <AnimatePresence>
        {saved && (
          <motion.div
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-10 grid place-content-center justify-items-center gap-2 rounded-lg bg-popover/95 text-center"
          >
            <motion.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.bouncy}
              className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand-text"
            >
              <Check className="size-6" strokeWidth={2.5} aria-hidden="true" />
            </motion.span>
            <p className="text-sm font-semibold">{saved.kind === 'task' ? 'Task added' : 'Saved'}</p>
            <p className="max-w-[18rem] truncate text-[13px] text-muted-foreground">{saved.where}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
