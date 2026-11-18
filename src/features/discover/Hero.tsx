import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CardMenu, type CardProps, Meta, ReadTime, SaveButton } from './ArticleCard';
import { plainClick } from './actions';
import { Cover } from './SourceTile';

/** The top story: a large picture beside a larger headline and the whole summary. Stacks on narrow screens. */
export function Hero(p: CardProps) {
  const { entry, read, saved, selected } = p;
  return (
    <article
      data-entry={entry.id}
      data-selected={selected || undefined}
      aria-label={read ? `${entry.title} (read)` : undefined}
      className={cn(
        'group/card relative grid overflow-hidden rounded-lg border bg-card shadow-sm transition-[box-shadow,border-color,opacity] duration-200 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]',
        'hover:border-foreground/15 hover:shadow-md',
        read && 'opacity-70 hover:opacity-100 focus-within:opacity-100',
        selected && 'ring-2 ring-ring/70 ring-offset-2 ring-offset-background',
      )}
    >
      <Cover
        src={entry.image}
        source={entry.source}
        priority
        className="aspect-[16/9] md:aspect-auto md:min-h-[300px]"
        imgClassName="group-hover/card:scale-[1.02]"
      />
      <div className="flex flex-col gap-3 p-5 md:p-7">
        <div className="flex items-center gap-2">
          <span className="rounded-sm bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-text">Top story</span>
          <ReadTime words={entry.words} />
        </div>
        <h2 className="text-balance text-xl font-semibold leading-tight tracking-tight sm:text-2xl lg:text-[28px]">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!plainClick(e)) return;
              e.preventDefault();
              p.onOpen(entry);
            }}
            className="rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/70"
          >
            {entry.title}
          </a>
        </h2>
        {entry.summary && <p className="line-clamp-4 text-[14px] leading-relaxed text-muted-foreground md:line-clamp-5">{entry.summary}</p>}
        <div className="mt-auto flex items-center gap-3 pt-2">
          <Meta entry={entry} now={p.now} className="min-w-0 flex-1" />
          <span className="hidden items-center gap-1 text-[13px] font-medium text-brand-text transition-transform duration-200 group-hover/card:translate-x-0.5 sm:inline-flex">
            Read <ArrowUpRight className="size-3.5" />
          </span>
          <div className="relative z-10 -mr-1.5 flex items-center gap-0.5">
            <SaveButton entry={entry} saved={saved} onToggle={p.onToggleSave} />
            <CardMenu {...p} />
          </div>
        </div>
      </div>
    </article>
  );
}
