import { EyeOff, MoreHorizontal, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { confirm, DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, Skeleton } from '@/components/ui';
import type { SearchableLink } from '@/features/home/OmniSearch';
import { ShortcutDialog } from '@/features/home/ShortcutDialog';
import { SiteIcon } from '@/features/home/SiteIcon';
import { type Shortcut, useHomeStore } from '@/features/home/store';
import { cn } from '@/lib/cn';
import { getTopSites, openUrl, type TopSite } from '@/lib/ext';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';
import { hostnameOf } from '@/lib/url';
import { useSettingsStore } from '@/store/useSettingsStore';

const MAX_TILES = 10;

type Tile = { id: string; title: string; url: string; kind: 'pinned' | 'top' };

/** Plain clicks navigate this tab; modifier/middle clicks open a new one (chrome:// needs the tabs API). */
function onTileClick(e: React.MouseEvent, url: string) {
  const newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;
  e.preventDefault();
  openUrl(url, { newTab });
}

/** Hook used by Home to feed the omni-search with the same links the grid shows. */
export function useHomeLinks() {
  const pinned = useHomeStore((s) => s.pinned);
  const hiddenHosts = useHomeStore((s) => s.hiddenHosts);
  const seeded = useHomeStore((s) => s.seeded);
  const seedStarters = useHomeStore((s) => s.seedStarters);
  const showTopSites = useSettingsStore((s) => s.showTopSites);
  const [top, setTop] = useState<TopSite[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!showTopSites) {
      setTop([]);
      setLoaded(true);
      return;
    }
    void getTopSites().then((sites) => {
      if (cancelled) return;
      setTop(sites);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showTopSites]);

  // No most-visited data (dev preview / permission off) and a brand-new profile → offer starters once.
  useEffect(() => {
    if (loaded && top.length === 0 && !seeded && pinned.length === 0) seedStarters();
  }, [loaded, top.length, seeded, pinned.length, seedStarters]);

  const tiles = useMemo<Tile[]>(() => {
    const seen = new Set(pinned.map((p) => hostnameOf(p.url)));
    const fromTop = top
      .filter((t) => {
        const host = hostnameOf(t.url);
        if (seen.has(host) || hiddenHosts.includes(host)) return false;
        seen.add(host);
        return true;
      })
      .map<Tile>((t) => ({ id: `top-${hostnameOf(t.url)}`, title: t.title || hostnameOf(t.url), url: t.url, kind: 'top' }));
    // Pinned shortcuts always show; the cap only limits auto-filled most-visited sites.
    return [...pinned.map<Tile>((p) => ({ ...p, kind: 'pinned' })), ...fromTop.slice(0, Math.max(0, MAX_TILES - pinned.length))];
  }, [pinned, top, hiddenHosts]);

  // Show the grid only once it knows what it will contain (most-visited answered, starters seeded): otherwise tiles pop in one
  // by one and push the "Add" tile — and everything centred around the grid — to a new place after load.
  const ready = loaded && (seeded || pinned.length > 0 || top.length > 0);

  return { tiles, top, links: tiles as SearchableLink[], ready };
}

const PLACEHOLDER_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** Same footprint as a real row of tiles, so the page doesn't change height when the real ones arrive. */
function ShortcutPlaceholder() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading shortcuts" className="flex max-w-[760px] flex-wrap justify-center gap-x-1 gap-y-2">
      {PLACEHOLDER_KEYS.map((k) => (
        <div key={k} className="flex w-[92px] flex-col items-center gap-2 px-1.5 pb-2 pt-3">
          <Skeleton className="size-12" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

export function ShortcutGrid({ tiles, top, ready = true }: { tiles: Tile[]; top: TopSite[]; ready?: boolean }) {
  const pinned = useHomeStore((s) => s.pinned);
  const removeShortcut = useHomeStore((s) => s.removeShortcut);
  const addShortcut = useHomeStore((s) => s.addShortcut);
  const hideTopSite = useHomeStore((s) => s.hideTopSite);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Shortcut | null>(null);

  const pinnedHosts = new Set(pinned.map((p) => hostnameOf(p.url)));
  const suggestions = top.filter((t) => !pinnedHosts.has(hostnameOf(t.url)));

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const remove = async (s: Tile) => {
    const snapshot = pinned.find((p) => p.id === s.id);
    removeShortcut(s.id);
    if (snapshot) notify.undo(`Removed ${s.title}`, () => addShortcut(snapshot.title, snapshot.url));
  };

  return (
    <>
      {!ready && <ShortcutPlaceholder />}
      <ul className={cn('flex max-w-[760px] flex-wrap justify-center gap-x-1 gap-y-2', !ready && 'hidden')} aria-label="Shortcuts">
        {tiles.map((t, i) => (
          <motion.li
            key={t.id}
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ ...spring.soft, delay: Math.min(i * 0.025, 0.3) }}
            className="group relative"
          >
            <a
              href={t.url}
              onClick={(e) => onTileClick(e, t.url)}
              onAuxClick={(e) => e.button === 1 && onTileClick(e, t.url)}
              className="flex w-[92px] flex-col items-center gap-2 rounded-lg px-1.5 pb-2 pt-3 outline-offset-0 transition-[background-color,transform] duration-200 ease-out-expo hover:bg-foreground/[0.06] active:scale-[0.97]"
            >
              <SiteIcon
                url={t.url}
                title={t.title}
                size={48}
                className="transition-[transform,box-shadow] duration-200 ease-out-expo group-hover:-translate-y-0.5 group-hover:shadow-md"
              />
              <span className="tile-label w-full truncate text-center text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                {t.title}
              </span>
            </a>

            <DropdownMenu>
              <DropdownTrigger
                aria-label={`Options for ${t.title}`}
                className="absolute right-0.5 top-0.5 grid size-6 place-items-center rounded-md bg-card/80 text-muted-foreground opacity-0 shadow-xs transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownTrigger>
              <DropdownContent align="end" side="bottom" className="min-w-40">
                {t.kind === 'pinned' ? (
                  <>
                    <DropdownItem
                      icon={<Pencil />}
                      onClick={() => {
                        setEditing(pinned.find((p) => p.id === t.id) ?? null);
                        setDialogOpen(true);
                      }}
                    >
                      Edit
                    </DropdownItem>
                    <DropdownSeparator />
                    <DropdownItem destructive icon={<Trash2 />} onClick={() => void remove(t)}>
                      Remove
                    </DropdownItem>
                  </>
                ) : (
                  <>
                    <DropdownItem
                      icon={<Pin />}
                      onClick={() => {
                        addShortcut(t.title, t.url);
                        notify.success(`Pinned ${t.title}`);
                      }}
                    >
                      Pin to shortcuts
                    </DropdownItem>
                    <DropdownItem
                      icon={<EyeOff />}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Hide ${t.title}?`,
                          description: 'It will no longer appear in your most visited. You can reset hidden sites in Settings.',
                          confirmLabel: 'Hide',
                        });
                        if (ok) hideTopSite(t.url);
                      }}
                    >
                      Hide
                    </DropdownItem>
                  </>
                )}
              </DropdownContent>
            </DropdownMenu>
          </motion.li>
        ))}

        <li>
          <motion.button
            type="button"
            onClick={openAdd}
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...spring.soft, delay: Math.min(tiles.length * 0.025, 0.3) }}
            className="group flex w-[92px] flex-col items-center gap-2 rounded-lg px-1.5 pb-2 pt-3 text-muted-foreground transition-[background-color,color,transform] duration-200 hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.97]"
          >
            <span className="grid size-12 place-items-center rounded-lg border border-dashed border-foreground/25 transition-[border-color,background-color] duration-200 group-hover:border-brand/60 group-hover:bg-brand-soft group-hover:text-brand-text">
              <Plus className="size-5 transition-transform duration-200 group-hover:rotate-90" />
            </span>
            <span className="tile-label text-xs font-medium">Add</span>
          </motion.button>
        </li>
      </ul>

      <ShortcutDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} suggestions={suggestions} />
    </>
  );
}
