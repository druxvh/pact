import { Check, Clock3, MessageCircle, UserPlus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  InputGroup,
  Segmented,
} from '@/components/ui';
import { useChatStore } from '@/features/chat/store';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { acceptIncoming, declineIncoming, requestFriend } from '@/store/demoServer';
import { ME_ID, useUserStore } from '@/store/useUserStore';

type Tab = 'add' | 'requests' | 'friends';

export function FriendsDialog({ open, onOpenChange, onOpenChat }: { open: boolean; onOpenChange: (o: boolean) => void; onOpenChat: (id: string) => void }) {
  const teammates = useUserStore((s) => s.teammates);
  const friendIds = useUserStore((s) => s.friendIds);
  const requests = useUserStore((s) => s.friendRequests);
  const ensureDm = useChatStore((s) => s.ensureDm);
  const [tab, setTab] = useState<Tab>('add');
  const [username, setUsername] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string; key: number } | null>(null);

  const incoming = requests.filter((r) => r.status === 'pending' && r.toId === ME_ID);
  const outgoing = requests.filter((r) => r.status === 'pending' && r.fromId === ME_ID);
  const friends = teammates.filter((t) => friendIds.includes(t.id));
  const suggestions = teammates.filter((t) => !friendIds.includes(t.id) && !outgoing.some((r) => r.toId === t.id));
  const person = (id: string) => teammates.find((t) => t.id === id);

  const add = (name: string) => {
    const r = requestFriend(name);
    setFeedback({ ok: r.ok, msg: r.msg, key: Date.now() });
    if (r.ok) setUsername('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Friends</DialogTitle>
          <DialogDescription>Add people by username to chat, share boards and watch together.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Segmented<Tab>
            aria-label="Friends sections"
            fullWidth
            value={tab}
            onValueChange={setTab}
            options={[
              { value: 'add', label: 'Add friend' },
              { value: 'requests', label: incoming.length ? `Requests (${incoming.length})` : 'Requests' },
              { value: 'friends', label: `Friends (${friends.length})` },
            ]}
          />

          {tab === 'add' && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  add(username);
                }}
                className="flex items-start gap-2"
              >
                <div className="flex-1">
                  <InputGroup
                    autoFocus
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setFeedback(null);
                    }}
                    leading={<span className="text-sm">@</span>}
                    placeholder="username"
                    aria-label="Username"
                    aria-invalid={feedback && !feedback.ok ? true : undefined}
                  />
                  <div className="h-5 pt-1.5">
                    <AnimatePresence mode="wait">
                      {feedback && (
                        <motion.p
                          key={feedback.key}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          role="status"
                          className={cn('flex items-center gap-1 text-xs', feedback.ok ? 'text-success-text' : 'text-destructive-text')}
                        >
                          {feedback.ok && <Check className="size-3" />}
                          {feedback.msg}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                <Button type="submit" variant="primary" disabled={!username.trim()}>
                  <UserPlus /> Add
                </Button>
              </form>

              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">People in the demo directory</p>
                <ul className="-mx-2">
                  {suggestions.length === 0 && <li className="px-2 py-3 text-[13px] text-muted-foreground">You’ve added everyone — nice!</li>}
                  {suggestions.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                      <Avatar name={p.displayName} size="md" status={p.isOnline ? 'online' : 'offline'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{p.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          @{p.username}
                          {p.designation ? ` · ${p.designation}` : ''}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => add(p.username)}>
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  pact is in demo mode: these people are simulated on your device. Real accounts arrive once a backend is connected.
                </p>
              </div>
            </div>
          )}

          {tab === 'requests' && (
            <div className="space-y-4">
              <section>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Received</p>
                {incoming.length === 0 ? (
                  <p className="py-3 text-[13px] text-muted-foreground">No pending requests.</p>
                ) : (
                  <ul className="-mx-2">
                    {incoming.map((r) => {
                      const p = person(r.fromId);
                      return (
                        <li key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                          <Avatar name={p?.displayName ?? '?'} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{p?.displayName ?? 'Someone'}</p>
                            <p className="truncate text-xs text-muted-foreground">@{p?.username} wants to connect</p>
                          </div>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              const id = acceptIncoming(r.id);
                              if (id) onOpenChat(id);
                            }}
                          >
                            Accept
                          </Button>
                          <IconButton label="Decline" size="icon-sm" onClick={() => declineIncoming(r.id)}>
                            <X />
                          </IconButton>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              {outgoing.length > 0 && (
                <section>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Sent</p>
                  <ul className="-mx-2">
                    {outgoing.map((r) => {
                      const p = person(r.toId);
                      return (
                        <li key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                          <Avatar name={p?.displayName ?? '?'} size="md" />
                          <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{p?.displayName}</p>
                          <Badge>
                            <Clock3 /> Pending
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}

          {tab === 'friends' && (
            <ul className="-mx-2">
              {friends.length === 0 && (
                <li className="px-2 py-6 text-center text-[13px] text-muted-foreground">No friends yet — add someone in the first tab.</li>
              )}
              <AnimatePresence initial={false}>
                {friends.map((p) => (
                  <motion.li
                    key={p.id}
                    layout
                    transition={spring.soft}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                  >
                    <Avatar name={p.displayName} size="md" status={p.isOnline ? 'online' : 'offline'} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{p.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">@{p.username}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onOpenChat(ensureDm(p.id));
                        onOpenChange(false);
                      }}
                    >
                      <MessageCircle /> Message
                    </Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
