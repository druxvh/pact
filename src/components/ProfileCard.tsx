import { PreviewCard } from '@base-ui/react/preview-card';
import { type ReactElement, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SocialIcon } from '@/components/SocialIcon';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';
import { linkLabel, PLATFORMS, type SocialLink, sanitizeLinks } from '@/lib/socialLinks';

export type ProfileCardData = {
  name: string;
  username?: string;
  /** What they do ("Designer") */
  role?: string;
  bio?: string;
  avatarUrl?: string;
  links?: unknown;
  /** A small label next to the name, e.g. the community role ("Admin"). */
  badge?: string;
  /** Extra line under the bio (e.g. "Member since Nov 2026"). */
  meta?: string;
};

/** The card itself: banner, avatar, name, @username, role, bio and up to five social links. Pure display. */
export function ProfileCard({ person, footer, className }: { person: ProfileCardData; footer?: ReactNode; className?: string }) {
  const links: SocialLink[] = sanitizeLinks(person.links);
  return (
    <div className={cn('w-72 max-w-full overflow-hidden', className)}>
      <div aria-hidden="true" className="h-14 bg-gradient-to-br from-brand/35 via-brand-soft to-transparent" />
      <div className="px-4 pb-4">
        <Avatar name={person.name} src={person.avatarUrl} size="xl" className="-mt-8 size-16 border-4 border-popover text-xl" />
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="max-w-full truncate text-[15px] font-semibold leading-tight tracking-tight">{person.name}</p>
          {person.badge && (
            <span className="rounded-sm bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-text">{person.badge}</span>
          )}
        </div>
        {person.username && <p className="truncate text-[13px] text-muted-foreground">@{person.username}</p>}
        {person.role && <p className="mt-1.5 truncate text-[13px] font-medium">{person.role}</p>}
        {person.bio && <p className="mt-1.5 line-clamp-4 whitespace-pre-line break-words text-[13px] leading-relaxed text-muted-foreground">{person.bio}</p>}
        {person.meta && <p className="mt-2 text-xs text-subtle-foreground">{person.meta}</p>}
        {links.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Links">
            {links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  title={`${PLATFORMS[l.kind].label} · ${linkLabel(l)}`}
                  aria-label={`${PLATFORMS[l.kind].label}: ${linkLabel(l)}`}
                  className="grid size-8 place-items-center rounded-md border bg-card/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <SocialIcon kind={l.kind} />
                </a>
              </li>
            ))}
          </ul>
        )}
        {footer && <div className="mt-3 border-t pt-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Is there any pointer that can hover? Touch-only devices (phones, most tablets) can't, so they never get the card. */
const HOVER = '(any-hover: hover)';
let cached: { source: typeof window.matchMedia; list: MediaQueryList } | null = null;
/** One shared media query list (every trigger in a long message list asks on every render). */
function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  if (cached?.source !== window.matchMedia) cached = { source: window.matchMedia, list: window.matchMedia(HOVER) };
  return cached.list;
}
function subscribeHover(onChange: () => void) {
  const mq = media();
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}
const canHoverNow = () => media()?.matches ?? true;
export const useCanHover = () => useSyncExternalStore(subscribeHover, canHoverNow, () => true);

/**
 * Hover (or keyboard-focus) a name or avatar to see the person's card, like X or Discord. `children` is the thing to hover —
 * a single element; it is rendered as the trigger itself, so it keeps its own layout and click behaviour.
 *
 * - `focusable`: make the trigger a tab stop so the card also opens for keyboard users (use it on names, not on avatars or on
 *   things that are already buttons). Esc closes the card.
 * - `disabled`: nothing to show yet (e.g. the profile hasn't loaded). Cancels opening instead of changing the tree, so the
 *   trigger isn't remounted when it flips and a list never flickers.
 * - Hover opens only for a mouse or trackpad, never for touch; with no hover-capable pointer at all the card is off entirely
 *   (and `focusable` adds no tab stops).
 * - Esc closes the card first: while it is open it takes the key, so a dialog or popover it floats over stays open.
 * - The popup is portalled, so no `overflow-hidden` ancestor can clip it; it flips/shifts to stay inside the window.
 */
export function ProfileHover({
  person,
  children,
  footer,
  disabled,
  focusable,
  side = 'right',
  align = 'start',
}: {
  person: ProfileCardData;
  children: ReactElement<Record<string, unknown>>;
  footer?: ReactNode;
  disabled?: boolean;
  focusable?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}) {
  const canHover = useCanHover();
  const off = disabled || !canHover;
  const [open, setOpen] = useState(false);
  const actions = useRef<PreviewCard.Root.Actions>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.stopPropagation(); // before any dialog/popover underneath hears it
      actions.current?.close();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <PreviewCard.Root
      actionsRef={actions}
      onOpenChange={(next, details) => {
        if (next && off) details.cancel();
        else setOpen(next);
      }}
    >
      <PreviewCard.Trigger render={children} delay={350} closeDelay={150} tabIndex={focusable && !off ? 0 : undefined} />
      <PreviewCard.Portal>
        <PreviewCard.Positioner side={side} align={align} sideOffset={8} collisionPadding={12} className="z-50">
          <PreviewCard.Popup className="popup-motion max-w-(--available-width) rounded-lg border bg-popover text-popover-foreground shadow-pop outline-none">
            <ProfileCard person={person} footer={footer} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
