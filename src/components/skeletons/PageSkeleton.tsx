/**
 * Loading placeholders that are the *shape* of the page they stand in for — same header, same columns, same paddings —
 * so the real page replaces them without anything jumping. One per section; `PageSkeleton` picks by section id.
 */
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import type { Section } from '@/store/useNavStore';

const sk = (className: string) => <Skeleton className={className} />;
const times = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

/** Same block as `PageHeader`: icon tile, title, one-line description, actions on the right. */
function Header({ actions, desc = 'w-52' }: { actions?: ReactNode; desc?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex h-[42px] min-w-0 items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-[18px] w-28" />
          <Skeleton className={cn('h-3 max-w-[60vw]', desc)} />
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Same row as `GroupBar`: the notebook/board tabs, Invite + options, and the "New …" button (all collapse to 32px squares below sm). */
function GroupRow({ newWidth }: { newWidth: string }) {
  return (
    <div className="flex h-10 items-center gap-2">
      <div className="flex min-w-0 flex-1 gap-1">
        {sk('h-8 w-28')}
        {sk('h-8 w-24')}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {sk('h-8 w-8 sm:w-[82px]')}
        {sk('size-8')}
      </div>
      <Skeleton className={cn('h-8 w-8 shrink-0', newWidth)} />
    </div>
  );
}

const Panel = ({ className, children }: { className?: string; children?: ReactNode }) => (
  <div className={cn('rounded-lg border bg-card/60 p-4', className)}>{children}</div>
);

/** Avatar + two text lines — chat rows, member rows, list rows. */
const PersonRow = ({ lines = 2, avatar = 'size-10' }: { lines?: number; avatar?: string }) => (
  <div className="flex items-start gap-3">
    <Skeleton className={cn(avatar, 'shrink-0 rounded-lg')} />
    <div className="flex-1 space-y-2 pt-1">
      <Skeleton className="h-3 w-32" />
      {times(lines - 1, (i) => (
        <Skeleton key={i} className={cn('h-3', i % 2 ? 'w-2/3' : 'w-5/6')} />
      ))}
    </div>
  </div>
);

// ── pages ────────────────────────────────────────────────────────────────────

function HomeSkeleton() {
  // Same column as `HomeView` with the default layout: clock, search, shortcuts and four widgets, centred in the page.
  return (
    <div className="flex h-full flex-col items-center overflow-hidden px-4">
      <div className="my-auto flex w-full max-w-5xl flex-col items-center gap-8 pb-[5vh] pt-6">
        <div className="flex h-[202px] flex-col items-center justify-center gap-3">
          <Skeleton className="h-[88px] w-[280px] max-w-[80vw]" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <Skeleton className="h-14 w-full max-w-[688px]" />
        <div className="grid min-h-[192px] w-full max-w-3xl grid-cols-4 content-start justify-items-center gap-x-4 gap-y-6 sm:grid-cols-7">
          {times(9, (i) => (
            <div key={i} className="flex w-16 flex-col items-center gap-2">
              <Skeleton className="size-12" />
              <Skeleton className="h-2.5 w-10" />
            </div>
          ))}
        </div>
        <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {times(4, (i) => (
            <Skeleton key={i} className={cn('w-full', i < 2 ? 'h-[193px]' : 'h-[176px]')} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NotesSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-4 py-6 md:px-8 md:py-8">
      {/* a long description: on a phone the button wraps under the title, as on the page */}
      <Header desc="w-[351px]" actions={<Skeleton className="h-8 w-28" />} />
      <GroupRow newWidth="sm:w-[135px]" />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <Panel className="flex flex-col gap-3 p-3">
          <Skeleton className="h-8 w-full" />
          {times(5, (i) => (
            <div key={i} className="space-y-2 rounded-lg p-2">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-2.5 w-12" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </Panel>
        <Panel className="hidden flex-col gap-4 lg:flex">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="ml-auto h-7 w-36" />
            <Skeleton className="size-7" />
            <Skeleton className="size-7" />
          </div>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-72 max-w-full" />
          <div className="space-y-2.5 pt-2">
            {times(6, (i) => (
              <Skeleton key={i} className={cn('h-3.5', ['w-full', 'w-[92%]', 'w-[97%]', 'w-[70%]', 'w-[88%]', 'w-1/2'][i])} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function KanbanSkeleton() {
  const cards = [3, 2, 1];
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-4 py-6 md:px-8 md:py-8">
      <Header actions={<Skeleton className="h-8 w-28" />} />
      <GroupRow newWidth="sm:w-28" />
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="ml-auto h-6 w-full sm:w-48" />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-3">
        {times(3, (c) => (
          <div key={c} className="flex min-h-[260px] flex-col gap-3 rounded-lg border bg-card/40 p-3">
            <div className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="ml-auto size-5" />
            </div>
            {times(cards[c] ?? 1, (i) => (
              <div key={i} className="space-y-2.5 rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className={cn('h-3.5', i % 2 ? 'w-2/3' : 'w-5/6')} />
                {i === 0 && <Skeleton className="h-3 w-1/2" />}
                <div className="flex items-center gap-2 pt-1">
                  <Skeleton className="size-5" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimerSkeleton() {
  return (
    <div className="space-y-6">
      <Header actions={<Skeleton className="size-8" />} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="flex flex-col items-center gap-7 px-4 py-8 sm:px-8">
          <Skeleton className="h-8 w-60" />
          <div className="flex w-full max-w-md flex-wrap justify-center gap-1.5">
            {sk('h-8 w-28')}
            {sk('h-8 w-24')}
            {sk('h-8 w-32')}
            {sk('h-8 w-24')}
          </div>
          <Skeleton className="aspect-square w-[min(300px,78vw)] rounded-full" />
          <Skeleton className="h-4 w-40" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-10" />
            <Skeleton className="size-[72px]" />
            <Skeleton className="size-10" />
          </div>
          <Skeleton className="-mt-3 h-4 w-32" />
          <div className="w-full max-w-md space-y-2 border-t pt-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel className="flex flex-col gap-5">
            <div className="flex h-[57px] items-center gap-3">
              <Skeleton className="size-10" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
            <div className="h-px bg-border" />
            <div className="grid grid-cols-2 gap-4">
              {times(2, (i) => (
                <div key={i} className="flex h-[57px] items-center gap-3">
                  <Skeleton className="size-10" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="h-5 w-12" />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel className="flex flex-col gap-3">
            <Skeleton className="h-5 w-24" />
            <div className="flex h-28 items-end gap-2">
              {times(7, (i) => (
                <Skeleton key={i} className="flex-1" style={{ height: `${[40, 20, 65, 30, 55, 12, 45][i]}%` }} />
              ))}
            </div>
          </Panel>
          <Panel className="flex flex-col gap-3">
            <Skeleton className="h-5 w-32" />
            {times(3, (i) => (
              <div key={i} className="flex h-10 items-center gap-3">
                <Skeleton className="size-7" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ToolsSkeleton() {
  return (
    <div className="space-y-6">
      <Header desc="w-[420px]" actions={<Skeleton className="h-8 w-full min-w-[200px] sm:w-56" />} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {times(9, (i) => (
          <Panel key={i} className="flex flex-col gap-3">
            <Skeleton className="size-10" />
            <div className="space-y-0.5">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-[18px] w-full" />
              {i % 6 > 2 && <Skeleton className="h-[18px] w-3/5" />}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background/40">
      <div className="flex h-11 shrink-0 items-end gap-3 border-b px-3 pb-2.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex min-h-0 flex-1">
        {/* community rail */}
        <div className="hidden w-[72px] shrink-0 flex-col items-center gap-2 border-r bg-background/50 p-2 sm:flex">
          {times(4, (i) => (
            <Skeleton key={i} className="size-11" />
          ))}
          <Skeleton className="mt-1 size-11 opacity-60" />
        </div>
        {/* channels */}
        <div className="hidden w-56 shrink-0 flex-col border-r md:flex">
          <div className="flex h-12 items-center border-b px-3">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="space-y-1.5 p-2">
            {times(5, (i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        {/* messages */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-2 h-3 w-48 max-w-[40vw]" />
          </div>
          <div className="flex-1 space-y-6 overflow-hidden p-4">
            {times(5, (i) => (
              <PersonRow key={i} lines={i % 3 === 0 ? 3 : 2} />
            ))}
          </div>
          <div className="p-3">
            <Skeleton className="h-11 w-full" />
          </div>
        </div>
        {/* members */}
        <div className="hidden w-56 shrink-0 space-y-3 border-l p-3 lg:block">
          <Skeleton className="h-3 w-20" />
          {times(6, (i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="size-8" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PartySkeleton() {
  return (
    <div className="space-y-6">
      <Header actions={<Skeleton className="h-6 w-24" />} />
      <Panel className="max-w-3xl space-y-5 p-5">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <div className="flex gap-2">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="size-9" />
            <Skeleton className="size-9" />
          </div>
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-36" />
        </div>
      </Panel>
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        {times(2, (i) => (
          <Panel key={i} className="space-y-3">
            <Skeleton className="h-4 w-28" />
            {times(4, (j) => (
              <Skeleton key={j} className={cn('h-3', j % 2 ? 'w-4/5' : 'w-full')} />
            ))}
          </Panel>
        ))}
      </div>
    </div>
  );
}

/** One Settings section: a small heading row above a single bordered list of rows (same metrics as `SettingsSection` / `SettingsRow`). */
function SettingsBlock({ rows, children }: { rows?: number; children?: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex min-h-7 items-center gap-2 px-1">
        <Skeleton className="size-3.5" />
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3 w-48 max-w-[40vw]" />
      </div>
      <div className="divide-y divide-border/70 rounded-lg border bg-card/60 px-4">
        {children ??
          times(rows ?? 1, (i) => (
            <div key={i} className="flex min-h-[53px] items-center justify-between gap-4 py-2">
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-48 max-w-[40vw]" />
              </div>
              <Skeleton className="h-8 w-32 shrink-0" />
            </div>
          ))}
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      <Header />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-8 gap-y-4 lg:grid-cols-[152px_minmax(0,1fr)]">
        {/* a strip of pills on narrow screens, a column beside the content on wide ones */}
        <div className="-mx-4 flex gap-1 overflow-hidden border-b px-4 py-1.5 md:-mx-8 md:px-8 lg:hidden">
          {times(6, (i) => (
            <Skeleton key={i} className="h-8 w-24 shrink-0" />
          ))}
        </div>
        <div className="hidden space-y-0.5 lg:block">
          {times(6, (i) => (
            <Skeleton key={i} className="h-[31.5px] w-full" />
          ))}
        </div>
        <div className="max-w-3xl space-y-5 pb-8">
          <SettingsBlock>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-14" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {times(4, (i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-8 w-28 self-end" />
            </div>
          </SettingsBlock>
          <SettingsBlock rows={7} />
          <SettingsBlock rows={4} />
        </div>
      </div>
    </div>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="space-y-5">
      <Header actions={<Skeleton className="h-8 w-24" />} />
      {/* the filter bar: topic chips, search, layout toggle */}
      <div className="flex items-center gap-2 rounded-lg border bg-card/60 p-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {times(7, (i) => (
            <Skeleton key={i} className={cn('h-8 shrink-0', i === 0 ? 'w-20' : 'w-24')} />
          ))}
        </div>
        <Skeleton className="hidden h-8 w-52 md:block" />
        <Skeleton className="h-7 w-16" />
      </div>
      {/* the top story */}
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
      {/* the grid of stories */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {times(6, (i) => (
          <div key={i} className="overflow-hidden rounded-lg border bg-card">
            <Skeleton className="aspect-[16/9] rounded-none" />
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Skeleton className="size-5" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const BY_SECTION: Record<Section, () => ReactNode> = {
  home: HomeSkeleton,
  notes: NotesSkeleton,
  kanban: KanbanSkeleton,
  timer: TimerSkeleton,
  tools: ToolsSkeleton,
  discover: DiscoverSkeleton,
  chat: ChatSkeleton,
  party: PartySkeleton,
  settings: SettingsSkeleton,
};

export function PageSkeleton({ section, label }: { section: Section; label?: string }) {
  const Body = BY_SECTION[section] ?? HomeSkeleton;
  return (
    <div role="status" aria-busy="true" aria-label={label ? `Loading ${label}` : 'Loading'} className="h-full">
      <Body />
    </div>
  );
}
