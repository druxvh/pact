import { Ban, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  confirm,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  GroupLabel,
  Segmented,
  Select,
  Skeleton,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { notify } from '@/lib/toast';
import { MemberHover } from './MemberHover';
import { describeError } from './mapping';
import { can, canUnban } from './permissions';
import { SLOWMODE_OPTIONS, slowmodeLabel, TIMEOUT_OPTIONS } from './safety';
import type { Ban as BanRecord, Channel, Community, Profile } from './types';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

const NO_CHANNELS: Channel[] = [];

const nameOf = (p: Profile | undefined) => p?.displayName || p?.username || 'Someone';

// ── slowmode ─────────────────────────────────────────────────────────────────

/** The slowmode picker for one channel (Off, 5 seconds … 6 hours). Moderators and the admin only — the server checks again. */
export function SlowmodeSelect({ channel, size = 'sm', className }: { channel: Channel; size?: 'sm' | 'md'; className?: string }) {
  return (
    <Select
      aria-label={`Slowmode for #${channel.name}`}
      size={size}
      className={className}
      value={String(channel.slowmodeSeconds)}
      options={SLOWMODE_OPTIONS.map((s) => ({ value: String(s), label: slowmodeLabel(s) }))}
      onValueChange={async (v) => {
        try {
          await useCommunityStore.getState().setSlowmode(channel.id, Number(v));
        } catch (err) {
          notify.error('Couldn’t change slowmode', describeError(err));
        }
      }}
    />
  );
}

// ── timeouts ─────────────────────────────────────────────────────────────────

/** Pick how long to time someone out for. `onConfirm` gets the duration in seconds. */
export function TimeoutDialog({
  name,
  open,
  onOpenChange,
  onConfirm,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (seconds: number) => Promise<void>;
}) {
  const [seconds, setSeconds] = useState('3600');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setSeconds('3600');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Time out {name}</DialogTitle>
          <DialogDescription>
            They can keep reading, but can’t send messages or react until the time is up. You can end it early from the same menu.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <GroupLabel>For how long</GroupLabel>
          <Select
            aria-label="Timeout duration"
            value={seconds}
            onValueChange={setSeconds}
            options={TIMEOUT_OPTIONS.map((o) => ({ value: String(o.seconds), label: o.label }))}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(Number(seconds));
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Timer /> Time out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── bans ─────────────────────────────────────────────────────────────────────

function BansList({ community }: { community: Community }) {
  const me = getCommunityApi().me;
  const [bans, setBans] = useState<BanRecord[] | null>(null);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getCommunityApi().listBans(community.id);
        const ids = [...new Set(list.flatMap((b) => [b.userId, ...(b.bannedBy ? [b.bannedBy] : [])]))];
        const profiles = await getCommunityApi()
          .getProfiles(ids)
          .catch(() => [] as Profile[]);
        if (cancelled) return;
        setPeople(Object.fromEntries(profiles.map((p) => [p.id, p])));
        setBans(list);
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [community.id]);

  const unban = async (b: BanRecord) => {
    const name = nameOf(people[b.userId]);
    if (
      !(await confirm({
        title: `Unban ${name}?`,
        description: 'They’ll be able to join again, but only with a new invite — they aren’t added back automatically.',
        confirmLabel: 'Unban',
      }))
    )
      return;
    try {
      await getCommunityApi().unbanMember(community.id, b.userId);
      setBans((cur) => cur?.filter((x) => x.userId !== b.userId) ?? null);
      notify.success(`${name} was unbanned`);
    } catch (err) {
      notify.error('Couldn’t unban', describeError(err));
    }
  };

  if (error)
    return (
      <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-[13px] text-destructive-text">
        {error}
      </p>
    );
  if (!bans)
    return (
      <div className="space-y-2" role="status" aria-label="Loading bans">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  if (bans.length === 0)
    return <p className="rounded-lg border border-dashed px-3 py-6 text-center text-[13px] text-muted-foreground">Nobody is banned from this community.</p>;

  return (
    <ul className="space-y-2" aria-label="Banned people">
      {bans.map((b) => {
        const who = people[b.userId];
        const by = b.bannedBy ? people[b.bannedBy] : undefined;
        const name = nameOf(who);
        return (
          <li key={b.userId} className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
            <MemberHover profile={who} focusable side="bottom">
              <div className="flex min-w-0 items-center gap-3 rounded-sm">
                <Avatar name={name} src={who?.avatarUrl} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {name}
                    {who && <span className="ml-1.5 text-xs font-normal text-subtle-foreground">@{who.username}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{b.reason ? `“${b.reason}”` : 'No reason given'}</p>
                  <p className="truncate text-[11px] text-subtle-foreground">
                    {b.bannedBy ? (b.bannedBy === me ? 'You' : by ? nameOf(by) : 'A former moderator') : 'A former moderator'} · {relativeTime(b.createdAt)}
                  </p>
                </div>
              </div>
            </MemberHover>
            {canUnban(community.role, b, me) && (
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => void unban(b)}>
                Unban
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── the moderation dialog (moderators and the admin) ─────────────────────────

export type ModerationTab = 'slowmode' | 'bans';

export function ModerationDialog({
  community,
  tab,
  onTabChange,
  open,
  onOpenChange,
}: {
  community: Community;
  tab: ModerationTab;
  onTabChange: (tab: ModerationTab) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const channels = useCommunityStore((s) => s.channels[community.id]) ?? NO_CHANNELS;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Moderation</DialogTitle>
          <DialogDescription>Tools for keeping {community.name} friendly. Hiding messages and removing links is in each message’s menu.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Segmented<ModerationTab>
            aria-label="Moderation tools"
            value={tab}
            onValueChange={onTabChange}
            options={[
              { value: 'slowmode', label: 'Slowmode', icon: <Timer /> },
              ...(can(community.role, 'viewBans') ? [{ value: 'bans' as const, label: 'Banned people', icon: <Ban /> }] : []),
            ]}
          />
          {tab === 'slowmode' ? (
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground">
                Slowmode limits how often each member can send a message in a channel. Moderators and the admin aren’t affected.
              </p>
              <ul className="space-y-1.5" aria-label="Channels">
                {channels.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-lg border px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="text-muted-foreground">#</span> {c.name}
                    </span>
                    <SlowmodeSelect channel={c} className="w-32" />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            open && <BansList community={community} />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
