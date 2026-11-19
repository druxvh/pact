import { Trash2 } from 'lucide-react';
import { useState } from 'react';
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
  Input,
  Label,
  Slider,
} from '@/components/ui';
import { PresetIcon } from '@/features/timer/PresetIcon';
import {
  emojiIcon,
  emojiOf,
  PRESET_ICON_KEYS,
  PRESET_MAX_MINUTES,
  PRESET_MIN_MINUTES,
  PRESET_NAME_MAX,
  resolveIcon,
  sanitizePreset,
  type TimerPreset,
} from '@/features/timer/presets';
import { useTimerStore } from '@/features/timer/store';
import { cn } from '@/lib/cn';
import { formatMinutes } from '@/lib/format';
import { notify } from '@/lib/toast';

/** Create a custom timer, or edit/delete an existing one. Mount with a `key` so it starts fresh each time it opens. */
export function PresetDialog({ preset, open, onOpenChange }: { preset: TimerPreset | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const save = useTimerStore((s) => s.savePreset);
  const remove = useTimerStore((s) => s.removePreset);
  const apply = useTimerStore((s) => s.applyPreset);
  const running = useTimerStore((s) => s.status === 'running');

  const [name, setName] = useState(preset?.name ?? '');
  const [minutes, setMinutes] = useState(preset?.minutes ?? 25);
  const [icon, setIcon] = useState(preset?.icon ?? 'focus');
  const [emojiText, setEmojiText] = useState(() => {
    const r = resolveIcon(preset?.icon ?? '');
    return r.kind === 'emoji' ? r.emoji : '';
  });

  const clean = sanitizePreset({ id: preset?.id ?? 'new', name, icon, minutes });
  const emojiInvalid = emojiText.trim() !== '' && emojiOf(emojiText) === null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clean) return;
    const id = save({ id: preset?.id, name: clean.name, icon: clean.icon, minutes: clean.minutes });
    if (!id) {
      notify.error('Timer limit reached', 'Delete one to make room for another.');
      return;
    }
    // A brand-new timer is made to be used: switch to it right away (unless one is already counting down).
    if (!preset && !running) apply(id);
    notify.success(preset ? 'Timer updated' : 'Timer added', clean.name);
    onOpenChange(false);
  };

  const pickEmoji = (text: string) => {
    setEmojiText(text);
    const e = emojiOf(text);
    if (e) setIcon(emojiIcon(e));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{preset ? 'Edit timer' : 'New timer'}</DialogTitle>
            <DialogDescription>A name, a length and an icon — then it’s one tap away on the Focus page.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {/* live preview */}
            <div className="flex items-center gap-3 rounded-lg border bg-card/50 p-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-brand-soft text-lg text-brand-text">
                <PresetIcon icon={icon} className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{clean?.name ?? 'Untitled timer'}</p>
                <p className="tabular text-xs text-muted-foreground">{formatMinutes(minutes)}</p>
              </div>
            </div>

            <div>
              <Label htmlFor="preset-name">Name</Label>
              <Input
                id="preset-name"
                value={name}
                maxLength={PRESET_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="Deep work, Language class, Tea…"
                autoComplete="off"
              />
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <GroupLabel className="mb-0">Length</GroupLabel>
                <p className="tabular font-mono text-sm text-muted-foreground">{minutes} min</p>
              </div>
              <Slider aria-label="Minutes" value={minutes} min={PRESET_MIN_MINUTES} max={PRESET_MAX_MINUTES} onValueChange={setMinutes} />
            </div>

            <div>
              <GroupLabel>Icon</GroupLabel>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5" role="radiogroup" aria-label="Icon">
                {PRESET_ICON_KEYS.map((key) => (
                  // biome-ignore lint/a11y/useSemanticElements: a styled radio tile; the group's roving state is the aria-checked value
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={icon === key}
                    aria-label={key}
                    onClick={() => {
                      setIcon(key);
                      setEmojiText('');
                    }}
                    className={cn(
                      'grid aspect-square place-items-center rounded-lg border transition-colors',
                      icon === key ? 'border-brand/50 bg-brand-soft text-brand-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <PresetIcon icon={key} className="size-[18px]" />
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Label htmlFor="preset-emoji" className="mb-0 shrink-0">
                  …or any emoji
                </Label>
                <Input
                  id="preset-emoji"
                  value={emojiText}
                  onChange={(e) => pickEmoji(e.target.value)}
                  placeholder="🍵"
                  aria-invalid={emojiInvalid || undefined}
                  autoComplete="off"
                  className="w-20 text-center text-base"
                />
                {emojiInvalid && <span className="text-xs text-destructive-text">That isn’t an emoji</span>}
              </div>
            </div>
          </DialogBody>
          <DialogFooter className="justify-between">
            {preset ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive-text"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete “${preset.name}”?`,
                    description: 'Sessions you already finished with it stay in your history.',
                    confirmLabel: 'Delete',
                    destructive: true,
                  });
                  if (!ok) return;
                  remove(preset.id);
                  onOpenChange(false);
                }}
              >
                <Trash2 /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!clean}>
                {preset ? 'Save' : 'Add timer'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
