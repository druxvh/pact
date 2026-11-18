import { ArrowLeft, ChevronDown, ClipboardType, Copy, Download, Globe, Link2, Pencil, Plus, Search, Sparkles, Tag, Trash2, Upload, X } from 'lucide-react';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import {
  Button,
  buttonClass,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  EmptyState,
  IconButton,
  InputGroup,
  Segmented,
} from '@/components/ui';
import { CommandForm } from '@/features/commands/CommandForm';
import { CommandIcon } from '@/features/commands/CommandIcon';
import {
  availableSuggestions,
  type CommandDraft,
  type CommandKind,
  type CustomCommand,
  exportCommands,
  IMPORT_MAX_BYTES,
  KIND_LABEL,
  KINDS,
  MAX_COMMANDS,
  parseImport,
} from '@/features/commands/model';
import { useCommandsStore } from '@/features/commands/store';
import { aliasTargetById } from '@/features/commands/targets';
import { cn } from '@/lib/cn';
import { downloadText } from '@/lib/download';
import { uid } from '@/lib/format';
import { bestScore } from '@/lib/fuzzy';
import { modCombo } from '@/lib/hotkeys';
import { shortTemplate, snippetPreview, templateHome } from '@/lib/omnibox/templates';
import { notify } from '@/lib/toast';

type Filter = 'all' | CommandKind;
type View = { mode: 'list' } | { mode: 'form'; kind: CommandKind; editingId?: string; initial?: Partial<CommandDraft> };

const KIND_ICON = { quicklink: Link2, snippet: ClipboardType, alias: Tag } as const;

/** The second line of a row: where a quicklink goes, what a snippet says, what an alias opens. */
function detailOf(c: CustomCommand, now: Date): string {
  if (c.kind === 'quicklink') return shortTemplate(c.url);
  if (c.kind === 'snippet') return snippetPreview(c.text, now);
  const target = aliasTargetById(c.target);
  // the name already says which one; the second line says what kind of thing it opens
  return target ? `Opens a ${target.group.slice(0, -1).toLowerCase()}` : 'This page or action no longer exists';
}

function RowIcon({ c }: { c: CustomCommand }) {
  if (c.kind === 'quicklink') return <CommandIcon icon={c.icon} url={templateHome(c.url)} title={c.name} size={32} />;
  const target = c.kind === 'alias' ? aliasTargetById(c.target) : undefined;
  const Icon = c.kind === 'alias' ? (target?.icon ?? Tag) : KIND_ICON[c.kind];
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
      <Icon className="size-4" />
    </span>
  );
}

function Row({ c, now, onEdit, onDuplicate, onDelete }: { c: CustomCommand; now: Date; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const missing = c.kind === 'alias' && !aliasTargetById(c.target);
  return (
    <li className="group flex min-w-0 items-center gap-2 rounded-lg border bg-card/50 py-2 pl-2.5 pr-1.5 transition-colors hover:bg-accent/40">
      <RowIcon c={c} />
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${c.name}`}
        className="min-w-0 flex-1 rounded-md py-0.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/15"
      >
        {/* w-0 min-w-full: fills the row but adds nothing to its intrinsic width, so long text truncates instead of widening a dialog or card */}
        <span className="flex w-0 min-w-full items-center gap-2">
          <span className="min-w-0 truncate text-sm leading-5">{c.name}</span>
          <span className="hidden shrink-0 rounded-sm bg-muted px-1.5 text-[10px] font-medium uppercase leading-4 tracking-wide text-muted-foreground sm:inline">
            {KIND_LABEL[c.kind].one}
          </span>
        </span>
        <span className={cn('block w-0 min-w-full truncate text-xs leading-4', missing ? 'text-warning-text' : 'text-muted-foreground')}>
          {detailOf(c, now)}
        </span>
      </button>
      {c.alias && (
        <span
          title="Alias"
          className="max-w-24 shrink-0 truncate rounded-sm border bg-background/60 px-1.5 py-px font-mono text-[11px] leading-4 text-muted-foreground"
        >
          {c.alias}
        </span>
      )}
      <div className="flex shrink-0 items-center [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
        <IconButton label={`Edit ${c.name}`} size="icon-sm" onClick={onEdit}>
          <Pencil />
        </IconButton>
        <IconButton label={`Duplicate ${c.name}`} size="icon-sm" onClick={onDuplicate}>
          <Copy />
        </IconButton>
        <IconButton label={`Delete ${c.name}`} size="icon-sm" className="hover:text-destructive-text" onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}

function AddMenu({ disabled, onPick }: { disabled: boolean; onPick: (kind: CommandKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownTrigger disabled={disabled} className={buttonClass('primary', 'md', 'gap-1')}>
        <Plus /> Add <ChevronDown className="!size-3.5 opacity-80" />
      </DropdownTrigger>
      <DropdownContent align="end">
        {KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <DropdownItem key={k} icon={<Icon />} onClick={() => onPick(k)}>
              {KIND_LABEL[k].one}
            </DropdownItem>
          );
        })}
      </DropdownContent>
    </DropdownMenu>
  );
}

function Empty({ items, onAdd, onImport }: { items: readonly CustomCommand[]; onAdd: (kind: CommandKind) => void; onImport: () => void }) {
  const add = useCommandsStore((s) => s.add);
  const suggestions = availableSuggestions(items);
  return (
    <div className="space-y-4">
      <EmptyState
        icon={Sparkles}
        title="Make the search box yours"
        description="Quicklinks open (and search) your sites, snippets copy text you paste often, and aliases give any page a short name."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <Button key={k} variant={k === 'quicklink' ? 'primary' : 'outline'} size="sm" onClick={() => onAdd(k)}>
                  <Icon /> {KIND_LABEL[k].one}
                </Button>
              );
            })}
          </div>
        }
      />
      {suggestions.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">Try one of these</p>
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.id} className="flex min-w-0 items-center gap-3 rounded-lg border bg-card/50 py-2 pl-3 pr-2">
                <div className="min-w-0 flex-1">
                  <p className="w-0 min-w-full truncate text-sm leading-5">{s.draft.name}</p>
                  <p className="w-0 min-w-full truncate text-xs leading-4 text-muted-foreground">
                    Type <span className="font-mono text-foreground/80">{s.example}</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="soft"
                  aria-label={`Add ${s.draft.name}`}
                  onClick={() => {
                    const r = add(s.draft);
                    if (r.ok) notify.success(`${KIND_LABEL[r.item.kind].one} added`, `Type “${s.example}” in the search box.`);
                    else notify.error('Couldn’t add it', Object.values(r.errors)[0]);
                  }}
                >
                  <Plus /> Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">
        Have an export?{' '}
        <button type="button" onClick={onImport} className="rounded-sm text-brand-text underline-offset-4 hover:underline">
          Import it
        </button>
      </p>
    </div>
  );
}

/**
 * Everything the user added to the omnibox — quicklinks, snippets, aliases — in one place: search, add, edit, duplicate,
 * delete, import/export. Takes no props and no width: it sits in a Settings card and in a dialog alike.
 */
export function CommandsManager() {
  const items = useCommandsStore((s) => s.items);
  const duplicate = useCommandsStore((s) => s.duplicate);
  const remove = useCommandsStore((s) => s.remove);
  const restore = useCommandsStore((s) => s.restore);
  const importItems = useCommandsStore((s) => s.importItems);
  const [view, setView] = useState<View>({ mode: 'list' });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useMemo(() => new Date(), []);

  const counts = useMemo(() => {
    const c: Record<CommandKind, number> = { quicklink: 0, snippet: 0, alias: 0 };
    for (const i of items) c[i.kind]++;
    return c;
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim();
    const pool = items.filter((i) => filter === 'all' || i.kind === filter);
    if (!q) return pool;
    return pool
      .map((c) => ({ c, s: bestScore(q, [c.name, c.alias, detailOf(c, now)]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [items, query, filter, now]);

  const full = items.length >= MAX_COMMANDS;
  const back = () => setView({ mode: 'list' });

  if (view.mode === 'form') {
    const editing = view.editingId ? items.find((c) => c.id === view.editingId) : undefined;
    return (
      <div className="min-w-0">
        <button
          type="button"
          onClick={back}
          className="-ml-1 mb-3 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/15"
        >
          <ArrowLeft className="size-3.5" /> All commands
        </button>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">
          {editing ? `Edit ${KIND_LABEL[editing.kind].one.toLowerCase()}` : `New ${KIND_LABEL[view.kind].one.toLowerCase()}`}
        </h3>
        <CommandForm
          key={editing?.id ?? `new-${view.kind}`}
          kind={editing?.kind ?? view.kind}
          initial={view.initial}
          editing={editing}
          variant="inline"
          onDone={back}
          onCancel={back}
        />
      </div>
    );
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      notify.error('That file is too big', `A commands export is a few KB; this one is ${Math.round(file.size / 1024)} KB.`);
      return;
    }
    const parsed = parseImport(await file.text(), () => uid('cmd'));
    if (!parsed.ok) {
      notify.error('Couldn’t import', parsed.error);
      return;
    }
    const r = importItems(parsed.items, parsed.invalid);
    const parts = [
      r.duplicates && `${r.duplicates} already here`,
      r.aliasDropped && `${r.aliasDropped} lost an alias that was taken`,
      r.invalid && `${r.invalid} unreadable`,
      r.overLimit && `${r.overLimit} over the limit of ${MAX_COMMANDS}`,
    ].filter(Boolean);
    if (r.added) notify.success(`Imported ${r.added} command${r.added === 1 ? '' : 's'}`, parts.join(' · ') || undefined);
    else notify.info('Nothing new to import', parts.join(' · ') || undefined);
  };

  const filePicker = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      className="sr-only"
      tabIndex={-1}
      aria-label="Import commands from a JSON file"
      onChange={(e) => {
        void onFile(e.target.files?.[0]);
        e.target.value = ''; // the same file can be chosen again
      }}
    />
  );
  const pickFile = () => fileRef.current?.click();
  const startForm = (kind: CommandKind) => setView({ mode: 'form', kind });

  if (items.length === 0) {
    return (
      <div className="min-w-0">
        {filePicker}
        <Empty items={items} onAdd={startForm} onImport={pickFile} />
      </div>
    );
  }

  const del = (c: CustomCommand) => {
    const index = items.findIndex((x) => x.id === c.id);
    const gone = remove(c.id);
    if (gone) notify.undo(`Deleted “${gone.name}”`, () => restore(gone, index));
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {filePicker}
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup
          className="min-w-40 flex-1"
          leading={<Search />}
          trailing={
            query ? (
              <IconButton label="Clear search" size="icon-xs" tooltip={false} onClick={() => setQuery('')}>
                <X />
              </IconButton>
            ) : undefined
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your commands"
          aria-label="Search your commands"
          autoComplete="off"
        />
        <AddMenu disabled={full} onPick={startForm} />
        <DropdownMenu>
          <DropdownTrigger aria-label="Import or export" className={buttonClass('outline', 'icon')}>
            <Download />
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownItem icon={<Upload />} onClick={pickFile}>
              Import from a file…
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<Download />} onClick={() => downloadText('pact-commands.json', exportCommands(items))}>
              Export as JSON
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="max-w-full overflow-x-auto">
          <Segmented<Filter>
            size="sm"
            aria-label="Show"
            value={filter}
            onValueChange={setFilter}
            options={[{ value: 'all', label: `All ${items.length}` }, ...KINDS.map((k) => ({ value: k, label: `${KIND_LABEL[k].many} ${counts[k]}` }))]}
          />
        </div>
        <p className={cn('tabular text-xs', full ? 'text-warning-text' : 'text-muted-foreground')} aria-live="polite">
          {items.length} of {MAX_COMMANDS}
          {full && ' · full'}
        </p>
      </div>

      {shown.length === 0 ? (
        <NoMatches
          query={query}
          filter={filter}
          onClear={() => {
            setQuery('');
            setFilter('all');
          }}
        />
      ) : (
        <ul className="space-y-1.5" aria-label="Your commands">
          {shown.map((c) => (
            <Row
              key={c.id}
              c={c}
              now={now}
              onEdit={() => setView({ mode: 'form', kind: c.kind, editingId: c.id })}
              onDuplicate={() => {
                const r = duplicate(c.id);
                if (r.ok) notify.success('Duplicated', r.item.name);
                else notify.error('Couldn’t duplicate', Object.values(r.errors)[0]);
              }}
              onDelete={() => del(c)}
            />
          ))}
        </ul>
      )}

      <Tip />
    </div>
  );
}

function NoMatches({ query, filter, onClear }: { query: string; filter: Filter; onClear: () => void }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
      <Search aria-hidden="true" className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">
        {query.trim() ? `Nothing matches “${query.trim()}”` : `No ${filter === 'all' ? 'commands' : KIND_LABEL[filter].many.toLowerCase()} yet`}
      </p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Show everything
      </Button>
    </div>
  );
}

function Tip() {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <Globe aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Type a name or alias in the search box on Home or in {modCombo('K')}. A quicklink with <code className="font-mono">{'{query}'}</code> also works as{' '}
        <span className="font-mono text-foreground/80">alias your text</span> — or press Tab after the alias for a site chip.
      </span>
    </p>
  );
}
