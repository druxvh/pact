import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  GroupLabel,
  Input,
  Label,
} from '@/components/ui';
import { SiteIcon } from '@/features/home/SiteIcon';
import { type Shortcut, useHomeStore } from '@/features/home/store';
import type { TopSite } from '@/lib/ext';
import { notify } from '@/lib/toast';
import { hostnameOf, normalizeUrl } from '@/lib/url';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Shortcut | null;
  /** Most-visited sites offered as one-click suggestions when adding. */
  suggestions: TopSite[];
};

export function ShortcutDialog({ open, onOpenChange, editing, suggestions }: Props) {
  const addShortcut = useHomeStore((s) => s.addShortcut);
  const updateShortcut = useHomeStore((s) => s.updateShortcut);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? '');
    setUrl(editing?.url ?? '');
    setError(null);
  }, [open, editing]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError('Enter a valid web address, e.g. github.com');
      return;
    }
    if (editing) {
      updateShortcut(editing.id, { title: title.trim() || hostnameOf(normalized), url: normalized });
      notify.success('Shortcut updated');
    } else {
      addShortcut(title, normalized);
      notify.success('Shortcut added');
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit shortcut' : 'Add shortcut'}</DialogTitle>
            <DialogDescription>Pin a site to your Home page.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <Label htmlFor="sc-url">Address</Label>
              <Input
                id="sc-url"
                autoFocus
                value={url}
                placeholder="github.com"
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
              />
              {error && <p className="mt-1.5 text-xs text-destructive-text">{error}</p>}
            </div>
            <div>
              <Label htmlFor="sc-title">Name (optional)</Label>
              <Input id="sc-title" value={title} placeholder="GitHub" maxLength={32} onChange={(e) => setTitle(e.target.value)} />
            </div>
            {!editing && suggestions.length > 0 && (
              <div>
                <GroupLabel>From your most visited</GroupLabel>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.slice(0, 6).map((s) => (
                    <button
                      key={s.url}
                      type="button"
                      onClick={() => {
                        setUrl(s.url);
                        setTitle(s.title || hostnameOf(s.url));
                        setError(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <SiteIcon url={s.url} title={s.title} size={20} />
                      {s.title || hostnameOf(s.url)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              {editing ? 'Save' : 'Add shortcut'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
