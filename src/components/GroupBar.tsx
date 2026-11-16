import { MoreHorizontal, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import { useId } from 'react';
import { AvatarGroup, Badge, Button, DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { hueFrom } from '@/lib/format';
import { spring } from '@/lib/motion';

export type GroupItem = {
  id: string;
  name: string;
  count: number;
  members: Array<{ id: string; name: string }>;
};

type Props = {
  items: GroupItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string) => void;
  onInvite: (id: string) => void;
  onDelete: (id: string) => void;
  /** Singular noun for the empty/new button, e.g. "notebook" or "board". */
  noun: string;
  /** Deleting the last group is blocked. */
  canDelete: boolean;
};

/** "Groups on top": a horizontally scrolling pill row with a sliding active background. */
export function GroupBar({ items, activeId, onSelect, onCreate, onRename, onInvite, onDelete, noun, canDelete }: Props) {
  const scope = useId();
  const active = items.find((i) => i.id === activeId);

  return (
    <div className="flex items-center gap-2">
      <LayoutGroup id={scope}>
        <div role="tablist" aria-label={`${noun}s`} className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-1">
          {items.map((g) => {
            const isActive = g.id === activeId;
            const hue = hueFrom(g.name);
            return (
              <button
                key={g.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => onSelect(g.id)}
                className={cn(
                  'relative flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium outline-offset-2 transition-colors duration-150 active:scale-[0.97]',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {isActive && <motion.span layoutId="group-pill" transition={spring.layout} className="absolute inset-0 rounded-lg border bg-card shadow-sm" />}
                <span
                  aria-hidden="true"
                  className="relative grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white"
                  style={{ background: `linear-gradient(135deg, oklch(0.64 0.16 ${hue}), oklch(0.48 0.16 ${(hue + 40) % 360}))` }}
                >
                  {(Array.from(g.name.trim())[0] ?? '?').toUpperCase()}
                </span>
                <span className="relative max-w-[140px] truncate">{g.name}</span>
                <Badge mono className="relative">
                  {g.count}
                </Badge>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {active && (
        <div className="flex shrink-0 items-center gap-1">
          {active.members.length > 1 && (
            <button
              type="button"
              onClick={() => onInvite(active.id)}
              aria-label={`${active.members.length} members — manage`}
              className="hidden rounded-lg outline-offset-2 transition-transform hover:scale-105 sm:block"
            >
              <AvatarGroup people={active.members} max={3} size="sm" />
            </button>
          )}
          <Button variant="outline" size="sm" onClick={() => onInvite(active.id)}>
            <UserPlus /> <span className="hidden sm:inline">Invite</span>
          </Button>
          <DropdownMenu>
            <DropdownTrigger render={<IconButton label={`${noun} options`} size="icon-sm" />}>
              <MoreHorizontal />
            </DropdownTrigger>
            <DropdownContent align="end" className="min-w-44">
              <DropdownItem icon={<Pencil />} onClick={() => onRename(active.id)}>
                Rename {noun}
              </DropdownItem>
              <DropdownItem icon={<UserPlus />} onClick={() => onInvite(active.id)}>
                Members &amp; invites
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem destructive icon={<Trash2 />} disabled={!canDelete} onClick={() => onDelete(active.id)}>
                Delete {noun}
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      )}

      <Button variant="soft" size="sm" onClick={onCreate} className="shrink-0">
        <Plus /> <span className="hidden sm:inline">New {noun}</span>
      </Button>
    </div>
  );
}
