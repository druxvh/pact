import { Check, Copy, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
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
  IconButton,
  Input,
  Label,
  Segmented,
  Select,
  Slider,
  Textarea,
} from '@/components/ui';
import { copyText } from '@/lib/clipboard';
import { pactUrl } from '@/lib/ext';
import { relativeTime } from '@/lib/format';
import { notify } from '@/lib/toast';
import { CommunityIcon } from './CommunityIcon';
import { isPlausibleInviteCode, parseInviteCode } from './links';
import { describeError } from './mapping';
import type { Channel, Community, Invite, InvitePreview } from './types';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

/** A stable empty list (a selector must never build a new array, or React re-renders forever). */
const NO_CHANNELS: Channel[] = [];

// ── create or join ───────────────────────────────────────────────────────────

export function CreateOrJoinDialog({ open, onOpenChange, initialCode }: { open: boolean; onOpenChange: (o: boolean) => void; initialCode?: string }) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hue, setHue] = useState(() => Math.floor(Math.random() * 360));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    if (initialCode) {
      setMode('join');
      setCode(initialCode);
    }
  }, [open, initialCode]);

  const clean = parseInviteCode(code);
  // Look the invite up as soon as a complete code is in the box.
  useEffect(() => {
    setPreview(null);
    setChecked(false);
    if (!open || mode !== 'join' || !isPlausibleInviteCode(clean)) return;
    let cancelled = false;
    getCommunityApi()
      .previewInvite(clean)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setChecked(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setProblem(describeError(err));
        setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clean, mode, open]);

  const finish = async (id: string) => {
    await useCommunityStore.getState().refreshCommunities();
    await useCommunityStore.getState().select(id);
    onOpenChange(false);
    setCode('');
    setName('');
    setDescription('');
  };

  const join = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const id = await getCommunityApi().joinCommunity(clean);
      if (!id) setProblem('That invite is invalid, expired or used up.');
      else {
        await finish(id);
        notify.success('You’re in', preview ? `Welcome to ${preview.name}` : undefined);
      }
    } catch (err) {
      setProblem(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const id = await getCommunityApi().createCommunity({ name, description, hue });
      await finish(id);
      notify.success('Community created', 'Invite people from the menu next to its name.');
    } catch (err) {
      setProblem(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{mode === 'join' ? 'Join a community' : 'Create a community'}</DialogTitle>
          <DialogDescription>Communities are private: you get in with an invite from a member.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Segmented<'join' | 'create'>
            aria-label="Join or create"
            value={mode}
            onValueChange={(m) => {
              setMode(m);
              setProblem(null);
            }}
            options={[
              { value: 'join', label: 'Join with an invite' },
              { value: 'create', label: 'Create your own' },
            ]}
          />

          {mode === 'join' ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="join-code">Invite code or link</Label>
                <Input
                  id="join-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setProblem(null);
                  }}
                  placeholder="e.g. 3f9a0c1b7d2e4a68"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  autoFocus
                />
              </div>
              {preview && (
                <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <CommunityIcon name={preview.name} hue={preview.hue} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{preview.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{preview.description || 'No description'}</p>
                    <p className="text-xs text-subtle-foreground">
                      {preview.members} {preview.members === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                </div>
              )}
              {checked && !preview && !problem && <p className="text-[13px] text-destructive-text">That invite is invalid, expired or used up.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="cm-name">Name</Label>
                <Input id="cm-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Design club" autoFocus />
              </div>
              <div>
                <Label htmlFor="cm-desc">What’s it about? (optional)</Label>
                <Textarea id="cm-desc" value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="flex items-center gap-3">
                <CommunityIcon name={name || 'New'} hue={hue} size="lg" />
                <div className="flex-1">
                  <Label htmlFor="cm-hue">Colour</Label>
                  <Slider aria-label="Colour" value={hue} min={0} max={359} onValueChange={setHue} />
                </div>
              </div>
            </div>
          )}
          {problem && (
            <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-[13px] text-destructive-text">
              {problem}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {mode === 'join' ? (
            <Button variant="primary" loading={busy} disabled={!preview} onClick={() => void join()}>
              Join {preview?.name ?? ''}
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={name.trim().length < 2} onClick={() => void create()}>
              Create community
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── invites ──────────────────────────────────────────────────────────────────

const inviteLink = (code: string) => pactUrl(`#/chat/${encodeURIComponent(`join:${code}`)}`);

export function InviteDialog({ community, open, onOpenChange }: { community: Community; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [uses, setUses] = useState('any');
  const [expires, setExpires] = useState('168');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    try {
      setInvites(await getCommunityApi().listInvites(community.id));
    } catch (err) {
      notify.error('Couldn’t load invites', describeError(err));
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload each time the dialog opens
  useEffect(() => {
    if (open) void load();
  }, [open, community.id]);

  const create = async () => {
    setBusy(true);
    try {
      const inv = await getCommunityApi().createInvite(community.id, {
        maxUses: uses === 'any' ? null : Number(uses),
        expiresInHours: expires === 'never' ? null : Number(expires),
      });
      setInvites((c) => [inv, ...c]);
    } catch (err) {
      notify.error('Couldn’t create an invite', describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, key: string) => {
    if (await copyText(text, '')) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    }
  };

  const status = (i: Invite) => {
    const bits = [`${i.uses}${i.maxUses ? ` / ${i.maxUses}` : ''} used`];
    bits.push(i.expiresAt ? (Date.parse(i.expiresAt) <= Date.now() ? 'expired' : `expires ${relativeTime(i.expiresAt)}`) : 'never expires');
    return bits.join(' · ');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Invite people to {community.name}</DialogTitle>
          <DialogDescription>
            Share a code or link. Anyone who has it can join, so limit uses or set an expiry for anything you post publicly.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <GroupLabel>Max uses</GroupLabel>
              <Select
                aria-label="Max uses"
                value={uses}
                onValueChange={setUses}
                options={[
                  { value: 'any', label: 'No limit' },
                  { value: '1', label: '1 use' },
                  { value: '5', label: '5 uses' },
                  { value: '25', label: '25 uses' },
                ]}
              />
            </div>
            <div>
              <GroupLabel>Expires</GroupLabel>
              <Select
                aria-label="Expires"
                value={expires}
                onValueChange={setExpires}
                options={[
                  { value: '1', label: 'In 1 hour' },
                  { value: '24', label: 'In 1 day' },
                  { value: '168', label: 'In 7 days' },
                  { value: 'never', label: 'Never' },
                ]}
              />
            </div>
          </div>
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            Create invite
          </Button>

          <ul className="space-y-2" aria-label="Active invites">
            {invites.length === 0 && <li className="text-[13px] text-muted-foreground">No invites yet.</li>}
            {invites.map((i) => (
              <li key={i.code} className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm">{i.code}</p>
                  <p className="text-xs text-muted-foreground">{status(i)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void copy(i.code, `c-${i.code}`)}>
                  {copied === `c-${i.code}` ? <Check className="text-success-text" /> : <Copy />} Code
                </Button>
                <Button variant="outline" size="sm" onClick={() => void copy(inviteLink(i.code), `l-${i.code}`)}>
                  {copied === `l-${i.code}` ? <Check className="text-success-text" /> : <Copy />} Link
                </Button>
                <IconButton
                  label={`Revoke invite ${i.code}`}
                  size="icon-sm"
                  onClick={async () => {
                    try {
                      await getCommunityApi().revokeInvite(i.code);
                      setInvites((c) => c.filter((x) => x.code !== i.code));
                    } catch (err) {
                      notify.error('Couldn’t revoke', describeError(err));
                    }
                  }}
                >
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle-foreground">
            A link only works for people who have pact installed; the code works anywhere in the “Join a community” box.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// ── settings (admin) ─────────────────────────────────────────────────────────

export function SettingsDialog({ community, open, onOpenChange }: { community: Community; open: boolean; onOpenChange: (o: boolean) => void }) {
  const channels = useCommunityStore((s) => s.channels[community.id]) ?? NO_CHANNELS;
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description);
  const [channelName, setChannelName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(community.name);
      setDescription(community.description);
    }
  }, [open, community.name, community.description]);

  const save = async () => {
    setBusy(true);
    try {
      await getCommunityApi().updateCommunity(community.id, { name, description });
      await useCommunityStore.getState().refreshCommunities();
      notify.success('Saved');
    } catch (err) {
      notify.error('Couldn’t save', describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const addChannel = async () => {
    const slug = channelName.trim().toLowerCase().replace(/\s+/g, '-');
    try {
      await getCommunityApi().createChannel(community.id, slug, '');
      setChannelName('');
      await useCommunityStore.getState().refreshChannels();
    } catch (err) {
      notify.error('Couldn’t add the channel', describeError(err));
    }
  };

  const removeCommunity = async () => {
    const ok = await confirm({
      title: `Delete ${community.name}?`,
      description: 'Every channel, message and invite is deleted for everyone. This can’t be undone.',
      confirmLabel: 'Delete community',
      destructive: true,
    });
    if (!ok) return;
    try {
      await getCommunityApi().deleteCommunity(community.id);
      onOpenChange(false);
      await useCommunityStore.getState().refreshCommunities();
      await useCommunityStore.getState().select(useCommunityStore.getState().communities[0]?.id ?? null);
    } catch (err) {
      notify.error('Couldn’t delete', describeError(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Community settings</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-3">
            <div>
              <Label htmlFor="cs-name">Name</Label>
              <Input id="cs-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cs-desc">Description</Label>
              <Textarea id="cs-desc" value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <Button
              variant="primary"
              loading={busy}
              disabled={name.trim().length < 2 || (name.trim() === community.name && description === community.description)}
              onClick={() => void save()}
            >
              Save changes
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Channels</p>
            <ul className="space-y-1">
              {channels.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <span className="text-muted-foreground">#</span>
                  <span className="flex-1">{c.name}</span>
                  <IconButton
                    label={`Delete #${c.name}`}
                    size="icon-sm"
                    disabled={channels.length <= 1}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: `Delete #${c.name}?`,
                          description: 'Its messages are deleted for everyone.',
                          confirmLabel: 'Delete channel',
                          destructive: true,
                        }))
                      )
                        return;
                      try {
                        await getCommunityApi().deleteChannel(c.id);
                        await useCommunityStore.getState().refreshChannels();
                      } catch (err) {
                        notify.error('Couldn’t delete', describeError(err));
                      }
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addChannel();
              }}
            >
              <Input
                aria-label="New channel name"
                placeholder="new-channel"
                maxLength={30}
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!channelName.trim()}>
                Add
              </Button>
            </form>
          </div>

          <div className="rounded-lg border border-destructive/40 p-3">
            <p className="text-sm font-medium text-destructive-text">Danger zone</p>
            <p className="mb-2 text-[13px] text-muted-foreground">Deleting a community removes it for every member.</p>
            <Button variant="danger" onClick={() => void removeCommunity()}>
              <Trash2 /> Delete community
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
