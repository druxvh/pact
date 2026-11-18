import { ArrowDown, ArrowUp, ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, GroupLabel, IconButton, Input, Popover, PopoverTrigger, Segmented, Switch } from '@/components/ui';
import { type ClockStyle, orderedWidgets, useHomeLayoutStore, WIDGET_INFO } from '@/features/home/layout';
import { useHomeStore } from '@/features/home/store';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { type ClockFormat, useSettingsStore } from '@/store/useSettingsStore';
import { Panel, ScrollX, SettingsRow } from './ui';

/** A switch with its label, for inside a popover. */
function PanelSwitch({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className={cn('flex min-h-9 items-center justify-between gap-3 py-1', disabled && 'opacity-60')}>
      <label htmlFor={id} className="min-w-0 flex-1 text-[13px]">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs leading-snug text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

const join = (parts: Array<string | false | null | undefined>, sep = ' · ') => parts.filter(Boolean).join(sep);

// ── clock ────────────────────────────────────────────────────────────────────

const CLOCK_LABEL: Record<ClockStyle, string> = { digital: 'Digital', compact: 'Compact', analog: 'Analog', none: 'No clock' };
const FORMAT_LABEL: Record<ClockFormat, string> = { auto: 'Auto', '12h': '12-hour', '24h': '24-hour' };

export function ClockRow() {
  const layout = useHomeLayoutStore((s) => s.layout);
  const setLayout = useHomeLayoutStore((s) => s.setLayout);
  const clock = useSettingsStore((s) => s.clock);
  const showGreeting = useSettingsStore((s) => s.showGreeting);
  const set = useSettingsStore((s) => s.set);
  const hasClock = layout.clockStyle !== 'none';
  const hasSeconds = layout.clockStyle === 'digital' || layout.clockStyle === 'analog';

  const summary = join([
    hasClock && `${FORMAT_LABEL[clock]} time`,
    hasClock && hasSeconds && layout.showSeconds && 'seconds',
    layout.showDate && 'date',
    showGreeting && 'greeting',
  ]);

  return (
    <SettingsRow label="Clock" description={summary || 'Just the search box.'}>
      <ScrollX>
        <Segmented<ClockStyle>
          aria-label="Clock style"
          value={layout.clockStyle}
          onValueChange={(v) => setLayout({ clockStyle: v })}
          options={(Object.keys(CLOCK_LABEL) as ClockStyle[]).map((v) => ({ value: v, label: v === 'none' ? 'None' : CLOCK_LABEL[v] }))}
        />
      </ScrollX>
      <Popover>
        <PopoverTrigger render={<IconButton label="Clock options" variant="outline" />}>
          <SlidersHorizontal />
        </PopoverTrigger>
        <Panel align="end" className="w-[min(20rem,calc(100vw-1.5rem))]">
          <div className="flex min-h-9 items-center justify-between gap-3 py-1">
            <span className="text-[13px] font-medium">Time format</span>
            <Segmented<ClockFormat>
              aria-label="Clock format"
              size="sm"
              value={clock}
              onValueChange={(v) => set('clock', v)}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: '12h', label: '12h' },
                { value: '24h', label: '24h' },
              ]}
            />
          </div>
          <PanelSwitch
            id="set-seconds"
            label="Seconds"
            hint={hasSeconds ? undefined : 'Digital and analog clocks only.'}
            checked={layout.showSeconds}
            disabled={!hasSeconds}
            onChange={(v) => setLayout({ showSeconds: v })}
          />
          <PanelSwitch id="set-date" label="Date" checked={layout.showDate} onChange={(v) => setLayout({ showDate: v })} />
          <PanelSwitch
            id="set-greeting"
            label="Greeting"
            hint="“Good evening, Sam” above the date."
            checked={showGreeting}
            onChange={(v) => set('showGreeting', v)}
          />
        </Panel>
      </Popover>
    </SettingsRow>
  );
}

// ── on the page ──────────────────────────────────────────────────────────────

export function PageRow() {
  const layout = useHomeLayoutStore((s) => s.layout);
  const setLayout = useHomeLayoutStore((s) => s.setLayout);
  const showTopSites = useSettingsStore((s) => s.showTopSites);
  const set = useSettingsStore((s) => s.set);
  const hidden = useHomeStore((s) => s.hiddenHosts.length);
  const resetHidden = useHomeStore((s) => s.resetHidden);

  const summary = join([
    layout.showSearch && 'Search box',
    layout.showSearch && layout.showHints && 'hints',
    layout.showShortcuts && 'Shortcuts',
    layout.showShortcuts && showTopSites && 'most visited',
  ]);

  return (
    <SettingsRow label="On the page" description={summary || 'Nothing but the clock and widgets.'}>
      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="sm" />}>
          Customize…
          <ChevronDown />
        </PopoverTrigger>
        <Panel align="end" className="w-[min(21rem,calc(100vw-1.5rem))]">
          <PanelSwitch
            id="set-search"
            label="Search box"
            hint="The web, your notes and tasks, your shortcuts."
            checked={layout.showSearch}
            onChange={(v) => setLayout({ showSearch: v })}
          />
          <PanelSwitch
            id="set-hints"
            label="Keyboard hints"
            hint="The “Press / to search” line."
            checked={layout.showHints}
            disabled={!layout.showSearch}
            onChange={(v) => setLayout({ showHints: v })}
          />
          <PanelSwitch
            id="set-shortcuts"
            label="Shortcuts"
            hint="Your pinned sites as icon tiles."
            checked={layout.showShortcuts}
            onChange={(v) => setLayout({ showShortcuts: v })}
          />
          <PanelSwitch
            id="set-topsites"
            label="Most visited sites"
            hint="Asked of your browser; nothing leaves your device."
            checked={showTopSites}
            disabled={!layout.showShortcuts}
            onChange={(v) => set('showTopSites', v)}
          />
          <div className="mt-1 flex min-h-9 items-center justify-between gap-3 border-t pt-2">
            <p className="text-[13px]">
              <span className="font-medium">Hidden sites</span>
              <span className="block text-xs text-muted-foreground">{hidden ? `${hidden} removed from Home.` : 'None removed.'}</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={hidden === 0}
              onClick={() => {
                resetHidden();
                notify.success('Hidden sites restored');
              }}
            >
              Show again
            </Button>
          </div>
        </Panel>
      </Popover>
    </SettingsRow>
  );
}

// ── widgets ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <GroupLabel className="mb-1">{label}</GroupLabel>
      {children}
    </div>
  );
}

export function WidgetsRow() {
  const layout = useHomeLayoutStore((s) => s.layout);
  const toggleWidget = useHomeLayoutStore((s) => s.toggleWidget);
  const moveWidget = useHomeLayoutStore((s) => s.moveWidget);
  const countdown = useHomeLayoutStore((s) => s.countdown);
  const setCountdown = useHomeLayoutStore((s) => s.setCountdown);
  const widgets = orderedWidgets(layout.widgets);
  const names = layout.widgets.map((id) => WIDGET_INFO[id].label);
  const summary =
    names.length === 0
      ? 'None — Home is just the search box and shortcuts.'
      : join([names.slice(0, 3).join(', '), names.length > 3 && `+${names.length - 3} more`], ' ');

  return (
    <SettingsRow label="Widgets" description={summary}>
      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="sm" />}>
          Customize…
          <ChevronDown />
        </PopoverTrigger>
        <Panel align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-2">
          <p className="px-1.5 pb-1 pt-0.5 text-xs text-muted-foreground">
            Small cards under the search box, made only from what’s already in pact. Use the arrows to reorder.
          </p>
          <ul className="divide-y divide-border/70">
            {widgets.map((id) => {
              const on = layout.widgets.includes(id);
              const i = layout.widgets.indexOf(id);
              const info = WIDGET_INFO[id];
              return (
                <li key={id} className="flex items-center gap-2 px-1.5 py-1.5">
                  <label htmlFor={`widget-${id}`} className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13px] font-medium', !on && 'text-muted-foreground')}>{info.label}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={info.description}>
                      {info.description}
                    </span>
                  </label>
                  <IconButton label={`Move ${info.label} earlier`} size="icon-xs" disabled={!on || i === 0} onClick={() => moveWidget(id, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label={`Move ${info.label} later`}
                    size="icon-xs"
                    disabled={!on || i === layout.widgets.length - 1}
                    onClick={() => moveWidget(id, 1)}
                  >
                    <ArrowDown />
                  </IconButton>
                  <Switch id={`widget-${id}`} checked={on} onCheckedChange={() => toggleWidget(id)} aria-label={info.label} />
                </li>
              );
            })}
          </ul>
          {layout.widgets.includes('countdown') && (
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-t px-1.5 pb-1 pt-2.5">
              <Field label="Countdown to…">
                <Input
                  aria-label="Countdown title"
                  value={countdown.title}
                  maxLength={40}
                  placeholder="Holiday, launch, birthday…"
                  onChange={(e) => setCountdown({ title: e.target.value })}
                  className="h-7"
                />
              </Field>
              <Field label="Date">
                <Input
                  aria-label="Countdown date"
                  type="date"
                  value={countdown.date ?? ''}
                  onChange={(e) => setCountdown({ date: e.target.value || null })}
                  className="h-7 w-36"
                />
              </Field>
            </div>
          )}
        </Panel>
      </Popover>
    </SettingsRow>
  );
}
