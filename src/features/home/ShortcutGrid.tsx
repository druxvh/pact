import { EyeOff, MoreHorizontal, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ShortcutDialog } from '@/features/home/ShortcutDialog';
import { SiteIcon } from '@/features/home/SiteIcon';
import { type Shortcut, useHomeStore } from '@/features/home/store';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  confirm,
} from '@/components/ui';
import type { SearchableLink } from '@/features/home/OmniSearch';
import { type TopSite, getTopSites, openUrl } from '@/lib/ext';
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
    return [
      ...pinned.map<Tile>((p) => ({ ...p, kind: 'pinned' })),
      ...fromTop.slice(0, Math.max(0, MAX_TILES - pinned.length)),
    ];
  }, [pinned, top, hiddenHosts]);

  return { tiles, top, links: tiles as SearchableLink[] };
}

export function ShortcutGrid({ tiles, top }: { tiles: Tile[]; top: TopSite[] }) {
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
      <div className="flex flex-wrap justify-center gap-3" role="list" aria-label="Shortcuts">
        {tiles.map((t, i) => (
          <motion.div
            key={t.id}
            role="listitem"
            layout
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ ...spring.soft, delay: Math.min(i * 0.025, 0.3) }}
            className="group relative"
          >
            <a
              href={t.url}
              data-spotlight
              onClick={(e) => onTileClick(e, t.url)}
              onAuxClick={(e) => e.button === 1 && onTileClick(e, t.url)}
              className="spotlight flex h-[92px] w-[96px] flex-col items-center justify-center gap-2.5 rounded-2xl border bg-card/60 px-2 shadow-xs backdrop-blur-sm transition-[transform,border-color,box-shadow] duration-200 ease-out-expo hover:-translate-y-1 hover:border-foreground/20 hover:shadow-md active:scale-[0.96]"
            >
              <SiteIcon url={t.url} title={t.title} size={30} />
              <span className="w-full truncate text-center text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                {t.title}
              </span>
            </a>

            <DropdownMenu>
              <DropdownTrigger
                aria-label={`Options for ${t.title}`}
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
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
          </motion.div>
        ))}

        <motion.button
          layout
          type="button"
          onClick={openAdd}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="group flex h-[92px] w-[96px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-muted-foreground transition-[color,border-color,background-color,transform] duration-200 hover:border-brand/60 hover:bg-brand-soft hover:text-brand-text active:scale-[0.96]"
        >
          <span className="grid size-8 place-items-center rounded-full bg-muted transition-[background-color,transform] duration-200 group-hover:rotate-90 group-hover:bg-brand-soft">
            <Plus className="size-4" />
          </span>
          <span className="text-xs font-medium">Add</span>
        </motion.button>
      </div>

      <ShortcutDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} suggestions={suggestions} />
    </>
  );
}
