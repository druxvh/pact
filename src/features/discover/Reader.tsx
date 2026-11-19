import { Dialog as D } from '@base-ui/react/dialog';
import { Bookmark, BookmarkCheck, ChevronDown, ChevronUp, Copy, ExternalLink, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Button, IconButton, Kbd } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ArticleBody } from './ArticleBody';
import { ReadTime } from './ArticleCard';
import { copyLink, openOriginal } from './actions';
import { hostOf } from './logic';
import { Cover, SourceTile } from './SourceTile';
import { sanitizeHtml, textOf } from './sanitize';
import type { Entry } from './types';

type ReaderProps = {
  /** The open article, or null when closed. */
  entry: Entry | null;
  saved: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleSave: (entry: Entry) => void;
};

/** A body shorter than this isn't an article, it's a teaser: show the summary and the "Read the full article" button instead. */
const MIN_BODY_CHARS = 200;

/**
 * The reader: a sheet on the right on wide screens, the whole page on narrow ones. Esc closes it (Base UI's dialog), focus
 * stays inside while it is open, and the article body only ever appears through the sanitiser.
 */
export function Reader({ entry, saved, hasPrev, hasNext, onClose, onPrev, onNext, onToggleSave }: ReaderProps) {
  // Keep showing the last article while the sheet slides away.
  const last = useRef<Entry | null>(null);
  if (entry) last.current = entry;
  const shown = entry ?? last.current;
  const scroller = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different article starts at the top
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [entry?.id]);

  const html = shown?.contentHtml ?? '';
  const url = shown?.url;
  const hero = shown?.image ?? null;
  const body = useMemo(() => (html ? sanitizeHtml(html, { base: url, skipImage: hero }) : []), [html, url, hero]);
  const hasBody = textOf(body).length >= MIN_BODY_CHARS;

  return (
    <D.Root open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <D.Popup
          aria-label={shown?.title}
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none',
            'lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[min(780px,94vw)] lg:border-l lg:shadow-pop',
            'transition-[transform,opacity] duration-300 ease-out-expo',
            'data-[starting-style]:translate-y-3 data-[starting-style]:opacity-0 lg:data-[starting-style]:translate-x-12 lg:data-[starting-style]:translate-y-0',
            'data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 lg:data-[ending-style]:translate-x-8 lg:data-[ending-style]:translate-y-0',
          )}
        >
          {shown && (
            <>
              <header className="surface-glass z-10 flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
                <D.Close render={<IconButton label="Close" shortcut="Esc" size="icon-sm" tooltip={false} />}>
                  <X />
                </D.Close>
                <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
                <IconButton label="Previous story" shortcut="K" size="icon-sm" disabled={!hasPrev} onClick={onPrev}>
                  <ChevronUp />
                </IconButton>
                <IconButton label="Next story" shortcut="J" size="icon-sm" disabled={!hasNext} onClick={onNext}>
                  <ChevronDown />
                </IconButton>
                <div className="ml-auto flex items-center gap-1">
                  <IconButton
                    label={saved ? 'Remove from reading list' : 'Save to reading list'}
                    shortcut="S"
                    size="icon-sm"
                    aria-pressed={saved}
                    onClick={() => onToggleSave(shown)}
                    className={cn(saved && 'text-brand-text')}
                  >
                    {saved ? <BookmarkCheck /> : <Bookmark />}
                  </IconButton>
                  <IconButton label="Copy link" size="icon-sm" onClick={() => copyLink(shown)}>
                    <Copy />
                  </IconButton>
                  <Button size="sm" variant="secondary" onClick={() => openOriginal(shown)}>
                    <ExternalLink />
                    <span className="hidden sm:inline">Open original</span>
                    <span className="sr-only sm:hidden">Open original</span>
                  </Button>
                </div>
              </header>

              <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <article className="mx-auto w-full max-w-[700px] px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                    <SourceTile source={shown.source} size="sm" />
                    <span className="font-medium text-foreground/85">{shown.source.name}</span>
                    {shown.publishedAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <time dateTime={shown.publishedAt}>
                          {new Date(shown.publishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                        </time>
                      </>
                    )}
                    {shown.words > 0 && <span aria-hidden="true">·</span>}
                    <ReadTime words={shown.words} className="text-[13px] text-muted-foreground" />
                  </div>

                  <D.Title className="mt-4 text-balance text-[28px] font-semibold leading-[1.15] tracking-tight sm:text-[36px]">{shown.title}</D.Title>
                  {shown.author && <p className="mt-3 text-sm text-muted-foreground">By {shown.author}</p>}

                  {shown.image && <Cover src={shown.image} source={shown.source} className="mt-7 aspect-[16/9] rounded-lg border" />}

                  {hasBody ? (
                    <>
                      <ArticleBody nodes={body} className="mt-8" />
                      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-6">
                        <p className="text-[13px] text-muted-foreground">
                          Originally published on <span className="font-medium text-foreground/85">{hostOf(shown.url) || shown.source.name}</span>
                        </p>
                        <Button size="sm" variant="secondary" onClick={() => openOriginal(shown)}>
                          <ExternalLink /> Open original
                        </Button>
                      </footer>
                    </>
                  ) : (
                    <div className="mt-8">
                      {shown.summary && <p className="text-[17px] leading-[1.75] text-foreground/90">{shown.summary}</p>}
                      <div className="mt-8 rounded-lg border bg-card p-5">
                        <p className="text-sm font-medium">{shown.source.name} only shares a short summary of this story.</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">
                          The full article is on {hostOf(shown.url) || 'their site'} — it opens in a new tab.
                        </p>
                        <Button className="mt-4" variant="primary" onClick={() => openOriginal(shown)}>
                          Read the full article <ExternalLink />
                        </Button>
                      </div>
                    </div>
                  )}

                  <p className="mt-10 hidden items-center justify-center gap-3 text-xs text-subtle-foreground sm:flex">
                    <span>
                      <Kbd>Esc</Kbd> close
                    </span>
                    <span>
                      <Kbd>J</Kbd> <Kbd>K</Kbd> next / previous
                    </span>
                    <span>
                      <Kbd>S</Kbd> save
                    </span>
                    <span>
                      <Kbd>O</Kbd> open original
                    </span>
                  </p>
                </article>
              </div>
            </>
          )}
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}
