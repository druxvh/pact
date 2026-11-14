import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@/components/ui';
import { useChatStore } from '@/features/chat/store';
import { cn } from '@/lib/cn';
import { useUserStore } from '@/store/useUserStore';

export function NewGroupDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const teammates = useUserStore((s) => s.teammates);
  const friendIds = useUserStore((s) => s.friendIds);
  const createGroup = useChatStore((s) => s.createGroup);
  const friends = teammates.filter((t) => friendIds.includes(t.id));
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setSelected([]);
      setError(null);
    }
  }, [open]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the group a name');
    if (selected.length === 0) return setError('Pick at least one friend');
    onCreated(createGroup(name, selected));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>A shared chat for you and your friends.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <Label htmlFor="grp-name">Group name</Label>
              <Input
                id="grp-name"
                autoFocus
                value={name}
                maxLength={40}
                placeholder="e.g. Friday movie night"
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <div>
              <Label>Members</Label>
              {friends.length === 0 ? (
                <p className="rounded-lg bg-muted/50 px-3 py-3 text-[13px] text-muted-foreground">Add some friends first, then you can create groups.</p>
              ) : (
                <ul className="-mx-1 max-h-56 space-y-0.5 overflow-y-auto">
                  {friends.map((p) => {
                    const on = selected.includes(p.id);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => toggle(p.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors',
                            on ? 'bg-brand-soft' : 'hover:bg-accent',
                          )}
                        >
                          <Avatar name={p.displayName} size="md" status={p.isOnline ? 'online' : 'offline'} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{p.displayName}</span>
                            <span className="block truncate text-xs text-muted-foreground">@{p.username}</span>
                          </span>
                          <span
                            className={cn(
                              'grid size-5 place-items-center rounded-md border transition-colors',
                              on ? 'border-brand bg-brand text-brand-foreground' : 'border-input',
                            )}
                          >
                            {on && <Check className="size-3.5" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {error && <p className="text-xs text-destructive-text">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
