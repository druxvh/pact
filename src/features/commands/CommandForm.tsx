import { ClipboardType, Globe, Trash2 } from 'lucide-react';
import { type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { Button, confirm, DialogBody, DialogFooter, GroupLabel, Input, Label, Segmented, Select, Textarea } from '@/components/ui';
import { COMMAND_ICONS, CommandIcon } from '@/features/commands/CommandIcon';
import {
  COMMAND_ICON_KEYS,
  type CommandDraft,
  type CommandKind,
  type CustomCommand,
  cleanIcon,
  draftOf,
  emojiValue,
  emptyDraft,
  iconValue,
  KIND_LABEL,
  NAME_MAX,
  validateDraft,
} from '@/features/commands/model';
import { useCommandsStore } from '@/features/commands/store';
import { type AliasTarget, aliasTargetById, aliasTargets } from '@/features/commands/targets';
import { emojiOf } from '@/features/timer/presets';
import { cn } from '@/lib/cn';
import { ALIAS_MAX, SNIPPET_MAX, shortTemplate, snippetPreview, templateHome } from '@/lib/omnibox/templates';
import { notify } from '@/lib/toast';

type Variant = 'dialog' | 'inline';

const BLURB: Record<CommandKind, string> = {
  quicklink: 'Open a site by name or alias. Put {query} in the address and the rest of what you type is searched there.',
  snippet: 'Text you paste often. Enter copies it to the clipboard — dates and the clipboard can be filled in.',
  alias: 'Give any page, tool or action a short name. Typing it puts that item first.',
};

/** Insert `text` where the caret is (or at the end), then put the caret after it. */
function insertAtCaret(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, text: string, set: (v: string) => void) {
  const at = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? at;
  set(value.slice(0, at) + text + value.slice(end));
  requestAnimationFrame(() => {
    el?.focus();
    el?.setSelectionRange(at + text.length, at + text.length);
  });
}

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-xs text-destructive-text">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-hint`} className="mt-1 text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** What the command will look like in the omnibox. */
function Preview({ draft }: { draft: CommandDraft }) {
  const target = draft.kind === 'alias' ? aliasTargetById(draft.target) : undefined;
  const now = useMemo(() => new Date(), []);
  const title = (draft.kind === 'alias' ? target?.title : draft.name.trim()) || (draft.kind === 'alias' ? 'Choose a target' : 'Untitled');
  const sub =
    draft.kind === 'quicklink'
      ? shortTemplate(draft.url) || 'example.com/search?q={query}'
      : draft.kind === 'snippet'
        ? snippetPreview(draft.text, now) || 'Your text…'
        : target
          ? target.group.replace(/s$/, '')
          : '';
  const alias = draft.alias.trim().replace(/^!/, '').toLowerCase();
  const TargetIcon = target?.icon;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card/50 p-2.5" aria-hidden="true">
      {draft.kind === 'quicklink' ? (
        <CommandIcon icon={draft.icon} url={templateHome(draft.url)} title={draft.name} size={32} />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
          {draft.kind === 'snippet' ? <ClipboardType className="size-4" /> : TargetIcon ? <TargetIcon className="size-4" /> : <Globe className="size-4" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="w-0 min-w-full truncate text-sm leading-5">{title}</p>
        <p className="w-0 min-w-full truncate text-xs leading-4 text-muted-foreground">{sub}</p>
      </div>
      {alias && (
        <span className="max-w-24 shrink-0 truncate rounded-sm border bg-background/60 px-1.5 py-px font-mono text-[11px] leading-4 text-muted-foreground">
          {alias}
        </span>
      )}
    </div>
  );
}

function IconPicker({ value, onChange, idPrefix }: { value: string; onChange: (v: string) => void; idPrefix: string }) {
  const emoji = value.startsWith('emoji:') ? value.slice('emoji:'.length) : '';
  const [emojiText, setEmojiText] = useState(emoji);
  const emojiInvalid = emojiText.trim() !== '' && emojiOf(emojiText) === null;
  const tile = (selected: boolean) =>
    cn(
      'grid size-9 place-items-center rounded-md border transition-colors',
      selected ? 'border-brand/50 bg-brand-soft text-brand-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    );
  return (
    <div>
      <GroupLabel>Icon</GroupLabel>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
        {/* biome-ignore lint/a11y/useSemanticElements: a styled radio tile; the group's state is the aria-checked value */}
        <button
          type="button"
          role="radio"
          aria-checked={value === ''}
          aria-label="Site icon"
          title="The site’s own icon"
          onClick={() => {
            onChange('');
            setEmojiText('');
          }}
          className={tile(value === '')}
        >
          <Globe className="size-[18px]" />
        </button>
        {COMMAND_ICON_KEYS.map((key) => {
          const Icon = COMMAND_ICONS[key];
          const selected = value === iconValue(key);
          return (
            // biome-ignore lint/a11y/useSemanticElements: a styled radio tile; the group's state is the aria-checked value
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={key}
              title={key}
              onClick={() => {
                onChange(iconValue(key));
                setEmojiText('');
              }}
              className={tile(selected)}
            >
              <Icon className="size-[18px]" />
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <Label htmlFor={`${idPrefix}-emoji`} className="mb-0 shrink-0">
          …or any emoji
        </Label>
        <Input
          id={`${idPrefix}-emoji`}
          value={emojiText}
          onChange={(e) => {
            setEmojiText(e.target.value);
            const em = emojiOf(e.target.value);
            if (em) onChange(emojiValue(em));
          }}
          placeholder="🚀"
          aria-invalid={emojiInvalid || undefined}
          autoComplete="off"
          className="w-20 text-center text-base"
        />
        {emojiInvalid && <span className="text-xs text-destructive-text">That isn’t an emoji</span>}
      </div>
    </div>
  );
}

function TargetPicker({ draft, set, error, id }: { draft: CommandDraft; set: (p: Partial<CommandDraft>) => void; error?: string; id: string }) {
  const all = useMemo(() => aliasTargets(), []);
  const current = all.find((t) => t.id === draft.target);
  const [group, setGroup] = useState<AliasTarget['group']>(current?.group ?? 'Pages');
  const options = all.filter((t) => t.group === group);
  return (
    <div className="space-y-3">
      <div>
        <GroupLabel>Alias for a…</GroupLabel>
        <Segmented
          size="sm"
          aria-label="Kind of target"
          value={group}
          onValueChange={(g) => setGroup(g)}
          options={[
            { value: 'Pages', label: 'Page' },
            { value: 'Tools', label: 'Tool' },
            { value: 'Actions', label: 'Action' },
          ]}
        />
      </div>
      <Field label={group === 'Pages' ? 'Page' : group === 'Tools' ? 'Tool' : 'Action'} htmlFor={id} error={error}>
        <Select
          aria-label={group.slice(0, -1)}
          value={current?.group === group ? draft.target : ''}
          placeholder={`Choose a ${group.slice(0, -1).toLowerCase()}…`}
          options={options.map((t) => ({ value: t.id, label: t.title }))}
          onValueChange={(target) => set({ target, name: all.find((t) => t.id === target)?.title ?? '' })}
        />
      </Field>
    </div>
  );
}

/**
 * Create or edit one command. Used in the compact "Create Quicklink…" dialogs and, inline, inside the manager. Problems are
 * shown per field and only after the person has left the field or tried to save (an alias clash shows as they type).
 */
export function CommandForm({
  kind,
  initial,
  editing,
  variant,
  onDone,
  onCancel,
}: {
  kind: CommandKind;
  initial?: Partial<CommandDraft>;
  /** Editing this command (otherwise a new one). */
  editing?: CustomCommand;
  variant: Variant;
  onDone: (saved?: CustomCommand) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const items = useCommandsStore((s) => s.items);
  const add = useCommandsStore((s) => s.add);
  const update = useCommandsStore((s) => s.update);
  const remove = useCommandsStore((s) => s.remove);
  const restore = useCommandsStore((s) => s.restore);
  const [draft, setDraft] = useState<CommandDraft>(() => (editing ? draftOf(editing) : { ...emptyDraft(kind), ...initial }));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const urlRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<CommandDraft>) => {
    setServerErrors({});
    setDraft((d) => ({ ...d, ...patch }));
  };

  const check = useMemo(
    () => validateDraft(draft, items, { now: new Date().toISOString(), id: editing?.id, createdAt: editing?.createdAt }),
    [draft, items, editing],
  );
  const errors: Partial<Record<string, string>> = { ...(check.ok ? {} : check.errors), ...serverErrors };
  const show = (f: string): string | undefined => {
    const e = errors[f];
    if (!e) return undefined;
    // an alias clash is worth knowing about while typing; everything else waits until the field was left or Save was tried
    if (f === 'form' || submitted || touched[f] || (f === 'alias' && draft.alias.trim() !== '')) return e;
    return undefined;
  };
  const blur = (f: string) => () => setTouched((t) => ({ ...t, [f]: true }));
  const inv = (f: string) => (show(f) ? true : undefined);
  const describe = (f: string, hint?: boolean) => (show(f) ? `${uid}-${f}-error` : hint ? `${uid}-${f}-hint` : undefined);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setSubmitted(true);
    const r = editing ? update(editing.id, draft) : add(draft);
    if (!r.ok) {
      setServerErrors(r.errors);
      const first = (['name', 'alias', 'url', 'text', 'target'] as const).find((f) => r.errors[f]);
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    notify.success(`${KIND_LABEL[r.item.kind].one} ${editing ? 'saved' : 'added'}`, r.item.name);
    onDone(r.item);
  };

  const body = (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">{BLURB[kind]}</p>
      <Preview draft={draft} />

      {kind === 'alias' ? (
        <TargetPicker draft={draft} set={set} id={`${uid}-target`} error={show('target')} />
      ) : (
        <Field label="Name" htmlFor={`${uid}-name`} error={show('name')}>
          <Input
            id={`${uid}-name`}
            value={draft.name}
            maxLength={NAME_MAX + 10}
            onChange={(e) => set({ name: e.target.value })}
            onBlur={blur('name')}
            placeholder={kind === 'quicklink' ? 'GitHub repositories' : 'Email signature'}
            aria-invalid={inv('name')}
            aria-describedby={describe('name')}
            autoComplete="off"
          />
        </Field>
      )}

      <Field
        label={kind === 'alias' ? 'Alias' : 'Alias (optional)'}
        htmlFor={`${uid}-alias`}
        error={show('alias')}
        hint={
          kind === 'quicklink'
            ? 'A short keyword: type it in the search box to open this. Letters, digits and dashes.'
            : 'A short keyword: type it in the search box to find this. Letters, digits and dashes.'
        }
      >
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-subtle-foreground">
            !
          </span>
          <Input
            id={`${uid}-alias`}
            value={draft.alias}
            maxLength={ALIAS_MAX + 4}
            onChange={(e) => set({ alias: e.target.value.toLowerCase() })}
            onBlur={blur('alias')}
            placeholder={kind === 'alias' ? 't' : kind === 'snippet' ? 'sig' : 'repo'}
            aria-invalid={inv('alias')}
            aria-describedby={describe('alias', true)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="pl-6 font-mono"
          />
        </div>
      </Field>

      {kind === 'quicklink' && (
        <>
          <Field
            label="Address"
            htmlFor={`${uid}-url`}
            error={show('url')}
            hint={
              <>
                <code className="font-mono">{'{query}'}</code> is what you type after the alias (URL-encoded) and{' '}
                <code className="font-mono">{'{clipboard}'}</code> is what you last copied.
              </>
            }
          >
            <Input
              id={`${uid}-url`}
              ref={urlRef}
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              onBlur={blur('url')}
              placeholder="https://github.com/search?q={query}"
              aria-invalid={inv('url')}
              aria-describedby={describe('url', true)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="url"
              className="font-mono text-[13px]"
            />
          </Field>
          <div className="-mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Insert</span>
            {(['{query}', '{clipboard}'] as const).map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="xs"
                className="font-mono"
                onClick={() => insertAtCaret(urlRef.current, draft.url, p, (v) => set({ url: v }))}
              >
                {p}
              </Button>
            ))}
          </div>
          <IconPicker value={cleanIcon(draft.icon)} onChange={(icon) => set({ icon })} idPrefix={uid} />
        </>
      )}

      {kind === 'snippet' && (
        <>
          <Field label="Text" htmlFor={`${uid}-text`} error={show('text')}>
            <Textarea
              id={`${uid}-text`}
              ref={textRef}
              value={draft.text}
              rows={5}
              maxLength={SNIPPET_MAX + 100}
              onChange={(e) => set({ text: e.target.value })}
              onBlur={blur('text')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder={'Best regards,\nYour name'}
              aria-invalid={inv('text')}
              aria-describedby={describe('text')}
              className="min-h-28 resize-y font-mono text-[13px]"
            />
          </Field>
          <div className="-mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Insert</span>
            {(['{date}', '{time}', '{clipboard}'] as const).map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="xs"
                className="font-mono"
                onClick={() => insertAtCaret(textRef.current, draft.text, p, (v) => set({ text: v }))}
              >
                {p}
              </Button>
            ))}
            <span className="ml-auto text-xs tabular-nums text-subtle-foreground">
              {draft.text.length}/{SNIPPET_MAX}
            </span>
          </div>
        </>
      )}

      {show('form') && (
        <p role="alert" className="text-xs text-destructive-text">
          {show('form')}
        </p>
      )}
    </div>
  );

  const buttons = (
    <>
      {editing ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mr-auto text-destructive-text"
          onClick={async () => {
            const ok = await confirm({
              title: `Delete “${editing.name}”?`,
              description: 'You can undo this right after.',
              confirmLabel: 'Delete',
              destructive: true,
            });
            if (!ok) return;
            const index = items.findIndex((c) => c.id === editing.id);
            const gone = remove(editing.id);
            onDone();
            if (gone) notify.undo(`Deleted “${gone.name}”`, () => restore(gone, index));
          }}
        >
          <Trash2 /> Delete
        </Button>
      ) : null}
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="primary">
        {editing ? 'Save' : `Add ${KIND_LABEL[kind].one.toLowerCase()}`}
      </Button>
    </>
  );

  return (
    <form onSubmit={submit} noValidate>
      {variant === 'dialog' ? (
        <>
          <DialogBody className="max-h-[min(70vh,640px)] overflow-y-auto">{body}</DialogBody>
          <DialogFooter>{buttons}</DialogFooter>
        </>
      ) : (
        <>
          {body}
          <div className="mt-4 flex items-center justify-end gap-2">{buttons}</div>
        </>
      )}
    </form>
  );
}
