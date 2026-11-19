import { Check, Search, Type } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Button, InputGroup, Popover, PopoverTrigger, Segmented } from '@/components/ui';
import { ensureFont } from '@/lib/appearance/fontLoader';
import { type FontDef, fontById, fontStack, interfaceFonts, monoFonts } from '@/lib/appearance/fonts';
import { cn } from '@/lib/cn';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { Panel, SettingsRow } from './ui';

type Slot = 'sans' | 'mono';

const GROUPS: Array<{ title: string; match: (f: FontDef) => boolean }> = [
  { title: 'Sans-serif', match: (f) => f.category === 'sans' },
  { title: 'Serif', match: (f) => f.category === 'serif' },
  { title: 'System', match: (f) => f.category === 'system' },
  // only ever shown while a style has set one (a style may choose a monospace interface font) — the list itself never offers these
  { title: 'Set by the style', match: (f) => f.category === 'mono' },
];

const SAMPLE = {
  sans: 'The quick brown fox jumps over the lazy dog — 0123456789',
  mono: 'const answer = 42; // 0123456789 {} [] => !==',
} as const;

/**
 * Up / Down move through the font buttons — from the search box into the list and back — and Home / End jump to the first /
 * last one (Tab still works too). Inside the search box Home / End keep their usual meaning.
 */
function onFontsKey(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const input = e.currentTarget.querySelector('input');
  const inInput = document.activeElement === input;
  if (inInput && (e.key === 'Home' || e.key === 'End')) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-font]')];
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  e.preventDefault();
  if (e.key === 'ArrowUp' && i <= 0) return input?.focus();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : i - 1;
  items[next]?.focus();
}

function FontItem({ font, selected, onPick }: { font: FontDef; selected: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        data-font={font.id}
        aria-pressed={selected}
        onClick={onPick}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          selected ? 'bg-brand-soft' : 'hover:bg-accent',
        )}
      >
        <span className="truncate text-[15px] leading-6" style={{ fontFamily: fontStack(font) }}>
          {font.label}
        </span>
        {selected && <Check className="size-3.5 shrink-0 text-brand-text" />}
      </button>
    </li>
  );
}

/** Search, pick and preview — interface font and the font for code and numbers. Choosing applies instantly. */
function FontPanel() {
  const font = useAppearanceStore((s) => s.font);
  const monoFont = useAppearanceStore((s) => s.monoFont);
  const setFont = useAppearanceStore((s) => s.setFont);
  const setMonoFont = useAppearanceStore((s) => s.setMonoFont);
  const [slot, setSlot] = useState<Slot>('sans');
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);

  // Preview every option in its own typeface: load them (locally bundled, a few KB each) while this is open.
  useEffect(() => {
    for (const f of [...interfaceFonts(), ...monoFonts()]) void ensureFont(f.id);
  }, []);

  const current = slot === 'sans' ? font : monoFont;
  const pick = slot === 'sans' ? setFont : setMonoFont;
  const q = query.trim().toLowerCase();
  const chosen = fontById(current);
  const listed = slot === 'sans' ? interfaceFonts() : monoFonts();
  // A style can set an interface font the list doesn't offer; keep it visible (and selected) instead of showing nothing picked.
  const offered = chosen && !listed.includes(chosen) ? [...listed, chosen] : listed;
  const fonts = offered.filter((f) => !q || f.label.toLowerCase().includes(q));

  return (
    <Panel align="end" className="w-[min(22rem,calc(100vw-1.5rem))] space-y-2.5" initialFocus={search}>
      <Segmented<Slot>
        aria-label="Which font"
        fullWidth
        value={slot}
        onValueChange={(v) => {
          setSlot(v);
          setQuery('');
        }}
        options={[
          { value: 'sans', label: 'Interface' },
          { value: 'mono', label: 'Code & numbers' },
        ]}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow-key roving between the search box and the buttons inside; those are the interactive elements */}
      <div onKeyDown={onFontsKey} className="space-y-2.5">
        <InputGroup
          ref={search}
          aria-label={slot === 'sans' ? 'Search interface fonts' : 'Search code fonts'}
          placeholder="Search fonts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leading={<Search />}
          inputClassName="h-8"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="max-h-56 overflow-y-auto overscroll-contain rounded-md border p-1">
          {fonts.length === 0 && <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">No font called “{query.trim()}”.</p>}
          {slot === 'mono' || q ? (
            <ul>
              {fonts.map((f) => (
                <FontItem key={f.id} font={f} selected={current === f.id} onPick={() => pick(f.id)} />
              ))}
            </ul>
          ) : (
            GROUPS.map((g) => {
              const list = fonts.filter(g.match);
              if (list.length === 0) return null;
              return (
                <div key={g.title} className="[&:not(:first-child)]:mt-1">
                  <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{g.title}</p>
                  <ul>
                    {list.map((f) => (
                      <FontItem key={f.id} font={f} selected={current === f.id} onPick={() => pick(f.id)} />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      </div>
      <p
        className={cn('truncate rounded-md bg-muted px-2.5 py-2 text-[13px] text-muted-foreground', slot === 'mono' && 'font-mono')}
        style={{ fontFamily: chosen ? fontStack(chosen) : undefined }}
      >
        {SAMPLE[slot]}
      </p>
    </Panel>
  );
}

/** Settings → Appearance → Font: what you have now, shown in the font itself; the full list is one click away. */
export function FontRow() {
  const font = useAppearanceStore((s) => s.font);
  const monoFont = useAppearanceStore((s) => s.monoFont);
  const sans = fontById(font);
  const mono = fontById(monoFont);

  // The summary is set in the fonts it names, so make sure they're loaded (a no-op for the built-in ones).
  useEffect(() => {
    void ensureFont(font);
    void ensureFont(monoFont);
  }, [font, monoFont]);

  return (
    <SettingsRow
      label="Font"
      description={
        <span className="block truncate">
          <span className="text-[13px] text-foreground" style={{ fontFamily: sans ? fontStack(sans) : undefined }}>
            {sans?.label ?? 'Geist'}
          </span>
          {' · '}
          <span className="font-mono text-foreground" style={{ fontFamily: mono ? fontStack(mono) : undefined }}>
            {mono?.label ?? 'Geist Mono'}
          </span>
          {' for code and numbers'}
        </span>
      }
    >
      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="sm" />}>
          <Type /> Change font…
        </PopoverTrigger>
        <FontPanel />
      </Popover>
    </SettingsRow>
  );
}
