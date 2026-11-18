import { Bookmark, BookmarkCheck, CircleCheck, CircleDashed, Copy, ExternalLink, EyeOff, MoreHorizontal } from 'lucide-react';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { copyLink, openOriginal, plainClick } from './actions';
import { readMinutes } from './logic';
import { Cover, SourceTile } from './SourceTile';
import type { Entry } from './types';

export type CardProps = {
  entry: Entry;
  read: boolean;
  saved: boolean;
  selected: boolean;
  now: number;
  onOpen: (entry: Entry) => void;
  onToggleSave: (entry: Entry) => void;
  onToggleRead: (entry: Entry) => void;
  onHideSource: (entry: Entry) => void;
};

/** "BBC News · 3h ago" — the line above a title. */
export function Meta({ entry, now, className }: { entry: Entry; now: number; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 text-xs text-muted-foreground', className)}>
      <SourceTile source={entry.source} size="xs" />
      <span className="truncate font-medium text-foreground/80">{entry.source.name}</span>
      {entry.publishedAt && (
        <>
          <span aria-hidden="true" className="text-subtle-foreground">
            ·
          </span>
          <time dateTime={entry.publishedAt} title={new Date(entry.publishedAt).toLocaleString()} className="shrink-0 tabular">
            {relativeTime(entry.publishedAt, now)}
          </time>
        </>
      )}
    </div>
  );
}

export const ReadTime = ({ words, className }: { words: number; className?: string }) => {
  const m = readMinutes(words);
  return m ? <span className={cn('tabular text-xs text-subtle-foreground', className)}>{m} min read</span> : null;
};

export function SaveButton({ entry, saved, onToggle, className }: { entry: Entry; saved: boolean; onToggle: (e: Entry) => void; className?: string }) {
  return (
    <IconButton
      label={saved ? 'Remove from reading list' : 'Save to reading list'}
      shortcut="S"
      size="icon-sm"
      aria-pressed={saved}
      onClick={() => onToggle(entry)}
      className={cn(saved && 'text-brand-text', className)}
    >
      {saved ? <BookmarkCheck /> : <Bookmark />}
    </IconButton>
  );
}

/** The ⋯ menu on every story. */
export function CardMenu({
  entry,
  read,
  saved,
  onToggleSave,
  onToggleRead,
  onHideSource,
  className,
}: Pick<CardProps, 'entry' | 'read' | 'saved' | 'onToggleSave' | 'onToggleRead' | 'onHideSource'> & { className?: string }) {
  return (
    <DropdownMenu>
      <DropdownTrigger render={<IconButton label={`More about “${entry.title}”`} tooltip={false} size="icon-sm" className={className} />}>
        <MoreHorizontal />
      </DropdownTrigger>
      <DropdownContent align="end" className="min-w-52">
        <DropdownItem icon={saved ? <BookmarkCheck /> : <Bookmark />} shortcut="S" onClick={() => onToggleSave(entry)}>
          {saved ? 'Remove from reading list' : 'Save to reading list'}
        </DropdownItem>
        <DropdownItem icon={<ExternalLink />} shortcut="O" onClick={() => openOriginal(entry)}>
          Open original
        </DropdownItem>
        <DropdownItem icon={<Copy />} onClick={() => copyLink(entry)}>
          Copy link
        </DropdownItem>
        <DropdownItem icon={read ? <CircleDashed /> : <CircleCheck />} onClick={() => onToggleRead(entry)}>
          {read ? 'Mark as unread' : 'Mark as read'}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem destructive icon={<EyeOff />} onClick={() => onHideSource(entry)}>
          Hide {entry.source.name}
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

const ring = 'ring-2 ring-ring/70 ring-offset-2 ring-offset-background';

/** The title as a real link to the publisher; a plain click opens the reader instead, and the link is stretched over the whole card. */
function TitleLink({ entry, onOpen, className }: { entry: Entry; onOpen: (e: Entry) => void; className?: string }) {
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        onOpen(entry);
      }}
      className={cn(
        "rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/70",
        className,
      )}
    >
      {entry.title}
    </a>
  );
}

/** One story in the grid. */
export function ArticleCard(p: CardProps) {
  const { entry, read, saved, selected } = p;
  return (
    <article
      data-entry={entry.id}
      data-selected={selected || undefined}
      aria-label={read ? `${entry.title} (read)` : undefined}
      className={cn(
        'group/card relative flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-xs transition-[box-shadow,border-color,opacity] duration-200',
        'hover:border-foreground/15 hover:shadow-md',
        read && 'opacity-60 hover:opacity-100 focus-within:opacity-100',
        selected && ring,
      )}
    >
      <Cover src={entry.image} source={entry.source} className="aspect-[16/9]" imgClassName="group-hover/card:scale-[1.03]" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Meta entry={entry} now={p.now} />
        <h3 className="line-clamp-3 text-balance text-[15px] font-semibold leading-snug tracking-tight">
          <TitleLink entry={entry} onOpen={p.onOpen} />
        </h3>
        {entry.summary && <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{entry.summary}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <ReadTime words={entry.words} />
          <div className="relative z-10 -mr-1.5 ml-auto flex items-center gap-0.5">
            <SaveButton entry={entry} saved={saved} onToggle={p.onToggleSave} />
            <CardMenu {...p} />
          </div>
        </div>
      </div>
    </article>
  );
}

/** One story as a row: text on the left, a small picture on the right. */
export function ArticleRow(p: CardProps) {
  const { entry, read, saved, selected } = p;
  return (
    <article
      data-entry={entry.id}
      data-selected={selected || undefined}
      aria-label={read ? `${entry.title} (read)` : undefined}
      className={cn(
        'group/card relative flex gap-4 overflow-hidden rounded-lg border bg-card p-3 shadow-xs transition-[box-shadow,border-color,opacity] duration-200 sm:p-4',
        'hover:border-foreground/15 hover:shadow-md',
        read && 'opacity-60 hover:opacity-100 focus-within:opacity-100',
        selected && ring,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Meta entry={entry} now={p.now} />
        <h3 className="line-clamp-2 text-balance text-[15px] font-semibold leading-snug tracking-tight">
          <TitleLink entry={entry} onOpen={p.onOpen} />
        </h3>
        {entry.summary && <p className="line-clamp-2 hidden text-[13px] leading-relaxed text-muted-foreground sm:block">{entry.summary}</p>}
        <div className="mt-auto flex items-center gap-2 pt-1">
          <ReadTime words={entry.words} />
          <div className="relative z-10 ml-auto flex items-center gap-0.5">
            <SaveButton entry={entry} saved={saved} onToggle={p.onToggleSave} />
            <CardMenu {...p} />
          </div>
        </div>
      </div>
      <Cover
        src={entry.image}
        source={entry.source}
        className="aspect-[4/3] w-24 shrink-0 self-start rounded-md sm:w-40"
        imgClassName="group-hover/card:scale-[1.04]"
      />
    </article>
  );
}
