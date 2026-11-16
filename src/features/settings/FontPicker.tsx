import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { Select } from '@/components/ui';
import { ensureFont } from '@/lib/appearance/fontLoader';
import { type FontDef, fontById, fontStack, interfaceFonts, monoFonts } from '@/lib/appearance/fonts';
import { cn } from '@/lib/cn';
import { useAppearanceStore } from '@/store/useAppearanceStore';

const GROUPS: Array<{ title: string; match: (f: FontDef) => boolean }> = [
  { title: 'Sans-serif', match: (f) => f.category === 'sans' },
  { title: 'Serif', match: (f) => f.category === 'serif' },
  { title: 'System', match: (f) => f.category === 'system' },
];

function FontCard({ font, selected, onClick }: { font: FontDef; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'relative flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left outline-offset-2 transition-[border-color,background-color,transform] duration-150 active:scale-[0.98]',
        selected ? 'border-brand/60 bg-brand-soft' : 'hover:border-foreground/25 hover:bg-accent/60',
      )}
    >
      <span className="text-2xl leading-none" style={{ fontFamily: fontStack(font) }}>
        Aa
      </span>
      <span className="mt-1 truncate text-[12px] font-medium text-muted-foreground" style={{ fontFamily: 'var(--font-sans)' }}>
        {font.label}
      </span>
      {selected && <Check className="absolute right-2 top-2 size-3.5 text-brand-text" />}
    </button>
  );
}

/** Interface font (a grid you can see) + the font used for code and numbers. */
export function FontPicker() {
  const font = useAppearanceStore((s) => s.font);
  const monoFont = useAppearanceStore((s) => s.monoFont);
  const setFont = useAppearanceStore((s) => s.setFont);
  const setMonoFont = useAppearanceStore((s) => s.setMonoFont);

  // Preview every option in its own typeface: load them (locally bundled, a few KB each) while this is on screen.
  useEffect(() => {
    for (const f of [...interfaceFonts(), ...monoFonts()]) void ensureFont(f.id);
  }, []);

  const chosen = fontById(font);

  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const fonts = interfaceFonts().filter(g.match);
        if (fonts.length === 0) return null;
        return (
          <div key={g.title}>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{g.title}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {fonts.map((f) => (
                <FontCard key={f.id} font={f} selected={font === f.id} onClick={() => setFont(f.id)} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="space-y-2 rounded-lg border bg-background/40 p-3">
        <p className="text-xs text-muted-foreground">Preview · {chosen?.label}</p>
        <p className="text-[15px] leading-relaxed">The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</p>
        <p className="text-[13px] text-muted-foreground">
          <span className="font-light">Light</span> · <span>Regular</span> · <span className="font-medium">Medium</span> ·{' '}
          <span className="font-semibold">Semibold</span> · <span className="font-bold">Bold</span> — 0123456789
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Code &amp; numbers</p>
          <p className="text-[13px] text-muted-foreground">Used for shortcuts, the timer digits, code blocks and the calculator.</p>
        </div>
        <Select
          aria-label="Monospace font"
          value={monoFont}
          onValueChange={setMonoFont}
          options={monoFonts().map((f) => ({ value: f.id, label: f.label }))}
          className="w-48"
        />
      </div>
      <p className="rounded-lg border bg-background/40 px-3 py-2 font-mono text-[13px] text-muted-foreground">
        {'const answer = 42; // 0123456789 {} [] => !=='}
      </p>
    </div>
  );
}
