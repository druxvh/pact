import { CalendarClock, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton, Input, Label } from '@/components/ui';
import { daysUntil, useHomeLayoutStore } from '@/features/home/layout';
import { WidgetCard } from '@/features/home/widgets/WidgetCard';
import { pluralize } from '@/lib/format';

const MAX_TITLE = 40;

/** Days until (or since) a date you choose — set it once, and it keeps counting on every new tab. */
export function CountdownWidget() {
  const countdown = useHomeLayoutStore((s) => s.countdown);
  const setCountdown = useHomeLayoutStore((s) => s.setCountdown);
  const [editing, setEditing] = useState(false);
  const days = daysUntil(countdown.date);
  const showForm = editing || days === null;

  if (showForm) {
    return (
      <WidgetCard
        icon={CalendarClock}
        title="Countdown"
        action={
          days !== null ? (
            <IconButton label="Cancel" size="icon-xs" onClick={() => setEditing(false)}>
              <X />
            </IconButton>
          ) : undefined
        }
      >
        <div className="flex flex-1 flex-col justify-between gap-3">
          <div className="space-y-2.5">
            <div>
              <Label htmlFor="cd-title">What are you counting down to?</Label>
              <Input
                id="cd-title"
                value={countdown.title}
                maxLength={MAX_TITLE}
                placeholder="Holiday, launch, birthday…"
                onChange={(e) => setCountdown({ title: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cd-date">Date</Label>
              <Input id="cd-date" type="date" value={countdown.date ?? ''} onChange={(e) => setCountdown({ date: e.target.value || null })} />
            </div>
          </div>
          {days !== null && (
            <Button variant="primary" size="sm" className="self-end" onClick={() => setEditing(false)}>
              Done
            </Button>
          )}
        </div>
      </WidgetCard>
    );
  }

  const n = Math.abs(days);
  return (
    <WidgetCard
      icon={CalendarClock}
      title="Countdown"
      action={
        <IconButton label="Edit countdown" size="icon-xs" onClick={() => setEditing(true)}>
          <Pencil />
        </IconButton>
      }
    >
      <div className="flex flex-1 flex-col justify-between gap-3">
        <div>
          <p className="tabular text-4xl font-light leading-none tracking-tight">{days === 0 ? 'Today' : n}</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{days === 0 ? 'is the day' : `${n === 1 ? 'day' : 'days'} ${days > 0 ? 'to go' : 'ago'}`}</p>
        </div>
        <p className="truncate text-[15px] font-medium" title={countdown.title}>
          {countdown.title.trim() || pluralize(n, 'day')}
        </p>
      </div>
    </WidgetCard>
  );
}
