import { ArrowLeft, Search, Wrench, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ComponentType, type LazyExoticComponent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Card, EmptyState, IconButton, InputGroup, PageHeader, Skeleton } from '@/components/ui';
import { isToolId, TOOL_BY_ID, TOOLS, type ToolDef, type ToolId } from '@/features/tools/registry';
import { cn } from '@/lib/cn';
import { bestScore } from '@/lib/fuzzy';
import { fadeUp, spring, stagger } from '@/lib/motion';
import { useNavStore } from '@/store/useNavStore';

const lazyCache = new Map<ToolId, LazyExoticComponent<ComponentType>>();
function toolComponent(def: ToolDef) {
  let c = lazyCache.get(def.id);
  if (!c) {
    c = lazy(def.load);
    lazyCache.set(def.id, c);
  }
  return c;
}

function Gallery() {
  const go = useNavStore((s) => s.go);
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim();
    if (!q) return [...TOOLS];
    return TOOLS.map((t) => ({ t, s: bestScore(q, [t.title, t.keywords, t.description]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.t);
  }, [query]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wrench}
        title="Tools"
        description="Tiny utilities that run entirely on your device — no uploads, no accounts"
        // below sm the search drops under the title and spans the row, like the filter on Kanban
        className="max-sm:[&>div:last-child]:w-full"
        actions={
          <InputGroup
            className="w-full sm:w-56"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            leading={<Search />}
            trailing={
              query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                >
                  <X className="size-3.5" />
                </button>
              ) : undefined
            }
            placeholder="Find a tool…"
            aria-label="Find a tool"
            inputClassName="h-8 text-[13px]"
          />
        }
      />

      {list.length === 0 ? (
        <EmptyState icon={Search} title={`No tool matches “${query}”`} description="Try “convert”, “color” or “random”." />
      ) : (
        <motion.ul
          variants={stagger(0.04)}
          initial="hidden"
          animate="show"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          key={query ? 'filtered' : 'all'}
        >
          {list.map((t) => {
            const Icon = t.icon;
            return (
              <motion.li key={t.id} variants={fadeUp}>
                <button type="button" onClick={() => go('tools', t.id)} className="group block h-full w-full text-left outline-offset-2">
                  <Card interactive spotlight className="h-full gap-3 transition-shadow">
                    <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-text transition-transform duration-300 ease-out-expo group-hover:scale-110 group-hover:-rotate-3">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold tracking-tight">{t.title}</p>
                      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t.description}</p>
                    </div>
                  </Card>
                </button>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}

function ToolFallback() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function ToolPage({ def }: { def: ToolDef }) {
  const go = useNavStore((s) => s.go);
  const Tool = toolComponent(def);
  const strip = useRef<HTMLElement>(null);

  // Seventeen tools don't fit in one strip: slide it (only the strip — never the page) so the open tool's pill is in view.
  useEffect(() => {
    const nav = strip.current;
    const pill = nav?.querySelector<HTMLElement>(`[data-tool="${def.id}"]`);
    if (!nav || !pill || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: pill.offsetLeft - (nav.clientWidth - pill.offsetWidth) / 2, behavior: 'smooth' });
  }, [def.id]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <IconButton label="All tools" variant="outline" onClick={() => go('tools')}>
          <ArrowLeft />
        </IconButton>
        <PageHeader icon={def.icon} title={def.title} description={def.description} className="min-w-0 flex-1" />
      </div>

      {/* quick switcher */}
      <nav ref={strip} aria-label="Tools" className="no-scrollbar -mx-1 -mt-1 flex gap-1 overflow-x-auto px-1 pb-1 pt-1">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = t.id === def.id;
          return (
            <button
              key={t.id}
              type="button"
              data-tool={t.id}
              aria-current={active ? 'page' : undefined}
              onClick={() => go('tools', t.id, { replace: true })}
              className={cn(
                'relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors active:scale-95',
                active ? 'text-brand-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {active && <motion.span layoutId="tool-pill" transition={spring.layout} className="absolute inset-0 rounded-lg bg-brand-soft" />}
              <Icon className="relative size-3.5" />
              <span className="relative">{t.title}</span>
            </button>
          );
        })}
      </nav>

      <Card className="p-4 sm:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={def.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            <Suspense fallback={<ToolFallback />}>
              <Tool />
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </Card>
    </div>
  );
}

export function ToolsView() {
  const sub = useNavStore((s) => s.sub);
  return isToolId(sub) ? <ToolPage def={TOOL_BY_ID[sub]} /> : <Gallery />;
}
