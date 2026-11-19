import { AlertTriangle, Bookmark, Newspaper, SearchX, WifiOff } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Density } from './types';

const PLACEHOLDERS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/** The shape of the page while the first articles load: a top story and a grid (or list) of cards. */
export function FeedSkeleton({ density }: { density: Density }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading articles" className="space-y-4">
      <div className="grid overflow-hidden rounded-lg border bg-card md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Skeleton className="aspect-[16/9] rounded-none md:aspect-auto md:min-h-[300px]" />
        <div className="space-y-4 p-5 md:p-7">
          <Skeleton className="h-5 w-24" />
          <div className="space-y-2.5">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
            <Skeleton className="h-6 w-2/3" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
        </div>
      </div>
      {density === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PLACEHOLDERS.map((k) => (
            <div key={k} className="overflow-hidden rounded-lg border bg-card">
              <Skeleton className="aspect-[16/9] rounded-none" />
              {/* as tall as a real card's text (meta, 1–2 title lines, 2 summary lines, actions) so the grid doesn't jump when stories arrive */}
              <div className="flex min-h-44 flex-col gap-3 p-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-5" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="mt-auto h-7 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {PLACEHOLDERS.map((k) => (
            <div key={k} className="flex gap-4 rounded-lg border bg-card p-3 sm:p-4">
              <div className="flex-1 space-y-2.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <Skeleton className="aspect-[4/3] w-24 shrink-0 self-start sm:w-40" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Props = { className?: string };

export function NoSources({ onChoose, className }: Props & { onChoose: () => void }) {
  return (
    <EmptyState
      className={cn('py-16', className)}
      icon={Newspaper}
      title="Nothing followed yet"
      description="Pick a few publications or topics and “For you” fills up with their latest stories."
      action={
        <Button variant="primary" onClick={onChoose}>
          Choose sources
        </Button>
      }
    />
  );
}

export function Offline({ onRetry, hasCache }: { onRetry: () => void; hasCache?: boolean }) {
  return (
    <EmptyState
      className="py-16"
      icon={WifiOff}
      title="You’re offline"
      description={
        hasCache
          ? 'Showing what was saved on this device. Fresh stories will load when you’re back.'
          : 'Reconnect and pact will load today’s stories. Your reading list works offline.'
      }
      action={
        <Button onClick={onRetry} variant="secondary">
          Try again
        </Button>
      }
    />
  );
}

export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      className="py-16"
      icon={AlertTriangle}
      title="Couldn’t load articles"
      description={message}
      action={
        <Button onClick={onRetry} variant="secondary">
          Try again
        </Button>
      }
    />
  );
}

export function NothingYet({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      className="py-16"
      icon={Newspaper}
      title="No stories yet"
      description="These sources haven’t published anything we could read. Try refreshing in a moment."
      action={
        <Button onClick={onRetry} variant="secondary">
          Refresh
        </Button>
      }
    />
  );
}

export function EmptyReadingList({ onBrowse }: { onBrowse: () => void }) {
  return (
    <EmptyState
      className="py-16"
      icon={Bookmark}
      title="Your reading list is empty"
      description="Tap the bookmark on any story (or press S) to keep it here for later. It stays on this device and works offline."
      action={
        <Button variant="secondary" onClick={onBrowse}>
          Browse stories
        </Button>
      }
    />
  );
}

export function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      className="py-16"
      icon={SearchX}
      title={`Nothing matches “${query}”`}
      description="Search looks through the stories already loaded — try a different word, or switch topic."
      action={
        <Button variant="secondary" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}
