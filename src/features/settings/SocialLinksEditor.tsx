import { Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { SocialIcon } from '@/components/SocialIcon';
import { Button, GroupLabel, IconButton, Input, Label, Popover, PopoverContent, PopoverTrigger, Select } from '@/components/ui';
import { linkLabel, MAX_LINKS, normalizeLink, PLATFORMS, SOCIAL_KINDS, type SocialKind, type SocialLink } from '@/lib/socialLinks';
import { notify } from '@/lib/toast';
import { useUserStore } from '@/store/useUserStore';

// a stable empty list: a selector that returns a fresh [] on every call makes zustand re-render forever
const NONE: SocialLink[] = [];
const OPTIONS = SOCIAL_KINDS.map((k) => ({ value: k, label: PLATFORMS[k].label }));

function AddLink({
  links,
  onAdd,
  onClose,
  inputRef,
}: {
  links: SocialLink[];
  onAdd: (l: SocialLink) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [kind, setKind] = useState<SocialKind>('instagram');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = normalizeLink(kind, value);
    if (!r.ok) return setError(r.error);
    if (links.some((l) => l.url === r.url)) return setError('You already added that link');
    onAdd({ kind, url: r.url });
    onClose();
  };

  return (
    <form onSubmit={submit} className="w-72 space-y-3 p-3">
      <div>
        <GroupLabel>Platform</GroupLabel>
        <Select
          size="sm"
          aria-label="Platform"
          value={kind}
          onValueChange={(v) => {
            setKind(v as SocialKind);
            setError(null);
          }}
          options={OPTIONS}
        />
      </div>
      <div>
        <Label htmlFor="sl-url">Link or username</Label>
        <Input
          id="sl-url"
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder={PLATFORMS[kind].placeholder}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby="sl-err"
        />
        <p id="sl-err" role={error ? 'alert' : undefined} className="mt-1 min-h-4 text-xs text-destructive-text">
          {error}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!value.trim()}>
          Add link
        </Button>
      </div>
    </form>
  );
}

/** Up to five links to your profiles elsewhere. They show on your profile card. Saved as you add or remove them. */
export function SocialLinksEditor() {
  const links = useUserStore((s) => s.currentUser.links ?? NONE);
  const updateProfile = useUserStore((s) => s.updateProfile);
  const [open, setOpen] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const full = links.length >= MAX_LINKS;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Social links</p>
        <span className="tabular text-xs text-subtle-foreground">
          {links.length}/{MAX_LINKS}
        </span>
      </div>
      {links.length > 0 && (
        <ul className="mb-2 divide-y rounded-md border">
          {links.map((l) => (
            <li key={l.url} className="flex items-center gap-2.5 px-2.5 py-1.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground">
                <SocialIcon kind={l.kind} className="size-3.5" />
              </span>
              <span className="w-20 shrink-0 text-[13px] font-medium">{PLATFORMS[l.kind].label}</span>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground hover:text-foreground hover:underline"
              >
                {linkLabel(l)}
              </a>
              <IconButton
                label={`Remove ${PLATFORMS[l.kind].label} link`}
                size="icon-xs"
                onClick={() => {
                  updateProfile({ links: links.filter((x) => x.url !== l.url) });
                  notify.success('Link removed');
                }}
              >
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="outline" size="sm" disabled={full} />}>
          <Plus /> {full ? 'Limit reached' : 'Add a link'}
        </PopoverTrigger>
        <PopoverContent align="start" initialFocus={urlRef}>
          <AddLink links={links} onAdd={(l) => updateProfile({ links: [...links, l] })} onClose={() => setOpen(false)} inputRef={urlRef} />
        </PopoverContent>
      </Popover>
      {links.length === 0 && <p className="mt-1.5 text-xs text-subtle-foreground">Instagram, X, Snapchat, Pinterest, YouTube and more — up to {MAX_LINKS}.</p>}
    </div>
  );
}
