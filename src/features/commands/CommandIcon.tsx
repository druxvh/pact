import type { LucideIcon } from 'lucide-react';
import {
  Bookmark,
  BookOpen,
  Briefcase,
  Calendar,
  Code,
  FileText,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  House,
  Image,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Music,
  Rocket,
  Search,
  ShoppingCart,
  Star,
  Video,
  Wrench,
  Zap,
} from 'lucide-react';
import { type CommandIconKey, cleanIcon } from '@/features/commands/model';
import { SiteIcon } from '@/features/home/SiteIcon';
import { cn } from '@/lib/cn';

/** The glyphs a quicklink can pick (keyed by `COMMAND_ICON_KEYS`, so a new key without an icon is a type error). */
export const COMMAND_ICONS: Record<CommandIconKey, LucideIcon> = {
  link: Link2,
  globe: Globe,
  search: Search,
  bookmark: Bookmark,
  star: Star,
  code: Code,
  mail: Mail,
  music: Music,
  video: Video,
  book: BookOpen,
  cart: ShoppingCart,
  map: MapPin,
  calendar: Calendar,
  chat: MessageSquare,
  file: FileText,
  folder: Folder,
  image: Image,
  heart: Heart,
  home: House,
  rocket: Rocket,
  zap: Zap,
  wrench: Wrench,
  school: GraduationCap,
  briefcase: Briefcase,
};

export type ResolvedCommandIcon = { kind: 'emoji'; emoji: string } | { kind: 'lucide'; Icon: LucideIcon } | { kind: 'site' };

/** `emoji:🍵` / `icon:rocket` / anything else (the site's favicon). */
export function resolveCommandIcon(icon: string): ResolvedCommandIcon {
  const v = cleanIcon(icon);
  if (v.startsWith('emoji:')) return { kind: 'emoji', emoji: v.slice('emoji:'.length) };
  if (v.startsWith('icon:')) return { kind: 'lucide', Icon: COMMAND_ICONS[v.slice('icon:'.length) as CommandIconKey] };
  return { kind: 'site' };
}

/** A quicklink's icon: the emoji or glyph they chose, otherwise the site's favicon (through the shared `SiteIcon`). */
export function CommandIcon({ icon, url, title, size = 32, className }: { icon: string; url: string; title?: string; size?: number; className?: string }) {
  const r = resolveCommandIcon(icon);
  const tile = size >= 24;
  if (r.kind === 'site')
    return url ? <SiteIcon url={url} title={title} size={size} chip={tile} className={className} /> : <Fallback size={size} className={className} />;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn('grid shrink-0 place-items-center text-muted-foreground', tile && 'rounded-md bg-muted text-foreground', className)}
    >
      {r.kind === 'emoji' ? (
        <span style={{ fontSize: Math.round(size * 0.55) }} className="leading-none">
          {r.emoji}
        </span>
      ) : (
        <r.Icon style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }} />
      )}
    </span>
  );
}

function Fallback({ size, className }: { size: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn('grid shrink-0 place-items-center rounded-md bg-muted text-muted-foreground', className)}
    >
      <Link2 style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }} />
    </span>
  );
}
