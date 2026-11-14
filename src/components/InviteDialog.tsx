import { Check, UserPlus, X } from 'lucide-react';
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
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { ME_ID } from '@/store/useUserStore';
import type { Person } from '@/types/user';

type Result = { ok: boolean; msg: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "design jam" */
  groupName: string;
  noun: string;
  members: Person[];
  /** People who could be added (shown as one-click chips). */
  suggestions: Person[];
  onInvite: (username: string) => Result;
  onRemove: (personId: string) => void;
};

export function InviteDialog({ open, onOpenChange, groupName, noun, members, suggestions, onInvite, onRemove }: Props) {
  const [username, setUsername] = useState('');
  const [feedback, setFeedback] = useState<(Result & { key: number }) | null>(null);

  const invite = (name: string) => {
    const r = onInvite(name);
    setFeedback({ ...r, key: Date.now() });
    if (r.ok) setUsername('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setUsername('');
          setFeedback(null);
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Invite to “{groupName}”</DialogTitle>
          <DialogDescription>Add people by username to share this {noun}.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              invite(username);
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
                      transition={spring.snappy}
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
              <UserPlus /> Invite
            </Button>
          </form>

          {suggestions.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Suggestions</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => invite(p.username)}
                    className="inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-colors hover:bg-accent"
                  >
                    <Avatar name={p.displayName} size="xs" />@{p.username}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{members.length} members</p>
            <ul className="-mx-2 max-h-52 overflow-y-auto">
              <AnimatePresence initial={false}>
                {members.map((m) => (
                  <motion.li
                    key={m.id}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={spring.soft}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                      <Avatar name={m.displayName} size="md" status={m.isOnline ? 'online' : 'offline'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{m.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">@{m.username}</p>
                      </div>
                      {m.id === ME_ID ? (
                        <Badge>You</Badge>
                      ) : (
                        <IconButton label={`Remove ${m.displayName}`} variant="danger" size="icon-xs" onClick={() => onRemove(m.id)}>
                          <X />
                        </IconButton>
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
