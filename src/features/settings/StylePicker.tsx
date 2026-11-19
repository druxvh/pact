import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { StyleWallThumb } from '@/features/stylewall/StyleWallThumb';
import { swatchHex } from '@/lib/appearance/accent';
import { ensureFont } from '@/lib/appearance/fontLoader';
import { fontById, fontStack } from '@/lib/appearance/fonts';
import { RADIUS_SCALE } from '@/lib/appearance/radius';
import { THEME_STYLES, type ThemeStyleDef, themeStyleById } from '@/lib/appearance/themeStyle';
import { cn } from '@/lib/cn';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { useThemeStore } from '@/store/useThemeStore';

const choiceHex = (def: ThemeStyleDef) => (def.bundle.accent.kind === 'custom' ? def.bundle.accent.hex : swatchHex(def.bundle.accent));

/**
 * A tiny picture of Home in a style — drawn from the registry entry (palette, texture, display font, accent, roundness), not a
 * screenshot, so it can't drift from the real thing and a style added later gets a preview for free. It always shows the
 * *current* light or dark, whichever style is switched on.
 */
export function StylePreview({ style, className }: { style: ThemeStyleDef; className?: string }) {
  const dark = useThemeStore((s) => s.resolved) === 'dark';
  const pal = dark ? style.preview.dark : style.preview.light;
  const accent = choiceHex(style);
  const display = style.preview.displayFont ? fontById(style.preview.displayFont) : undefined;
  const r = RADIUS_SCALE[style.bundle.radius];
  const radius = Math.max(0, Math.round(r.lg * 0.55));
  const small = Math.max(0, Math.round(r.md * 0.5));

  useEffect(() => {
    if (display) void ensureFont(display.id);
  }, [display]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative flex h-[104px] flex-col justify-center gap-2 overflow-hidden rounded-md border',
        style.preview.art ? 'items-start gap-1.5 pl-3 pt-3' : 'items-center',
        className,
      )}
      style={{
        background: pal.bg,
        borderColor: pal.line,
        color: pal.ink,
        boxShadow: style.preview.frame ? `inset 0 0 0 2px ${accent}` : undefined,
      }}
    >
      {style.preview.wallpaperStill && style.wallpaper && (
        <>
          <StyleWallThumb scene={style.wallpaper.scene} dark={dark} accent={accent} width={152} height={104} />
          {/* a veil of the page colour, as the real page has, so the little clock and search box stay readable over the picture */}
          <span className="absolute inset-0" style={{ background: pal.bg, opacity: 0.5 }} />
        </>
      )}
      {style.preview.art === 'halo' && (
        // an engraved plate (features/ultramarine/plates.ts, generated into styles/ultramarine-plates.css): cobalt ground, lavender hairlines
        <span
          className="absolute right-2.5 top-2.5 size-9"
          style={{ backgroundImage: 'var(--um-plate-halo)', backgroundSize: 'cover', boxShadow: `0 0 0 1px ${pal.line}` }}
        />
      )}
      {style.preview.eyebrow && (
        <span
          className="relative -mb-0.5 text-[8px] font-medium uppercase leading-none tracking-[0.2em]"
          style={{ fontFamily: display ? fontStack(display) : undefined, color: pal.muted }}
        >
          {style.preview.eyebrow}
        </span>
      )}
      {style.preview.texture === 'dots' && (
        <span
          className="absolute inset-0"
          style={{ backgroundImage: `radial-gradient(circle, ${pal.line} 0.7px, transparent 1.1px)`, backgroundSize: '7px 7px' }}
        />
      )}
      <span
        className="relative text-[26px] leading-none tracking-tight tabular"
        style={{
          fontFamily: display ? fontStack(display) : undefined,
          // a one-weight display face is drawn in its own weight, not a faux bold; a light display face (Oswald) says its own
          fontWeight: display ? (display.source === 'static' ? (display.weights?.[0] ?? 400) : (style.preview.displayWeight ?? 600)) : 300,
        }}
      >
        10<span style={{ color: accent }}>:</span>24
      </span>
      <span
        className={cn('relative flex h-[18px] items-center gap-1 border px-1.5', style.preview.art ? 'w-[52%]' : 'w-[76%]')}
        style={{ background: pal.card, borderColor: pal.line, borderRadius: style.preview.pill ? 999 : radius }}
      >
        <span className="size-1.5 rounded-full" style={{ background: pal.muted }} />
        <span className="h-[3px] w-9 rounded-full" style={{ background: pal.muted, opacity: 0.55 }} />
        {style.preview.button ? (
          // the style's primary button: white on dark, the accent on light
          <span className="ml-auto h-[11px] w-6" style={{ background: dark ? '#fafaff' : accent, borderRadius: Math.min(small, 2) + 1 }} />
        ) : (
          <span
            className={cn('ml-auto', style.preview.pill ? 'h-[11px] w-[17px]' : 'size-[11px]')}
            style={{ background: accent, borderRadius: style.preview.pill ? 999 : small }}
          />
        )}
      </span>
      <span className="relative flex gap-1">
        {['a', 'b', 'c', 'd', 'e'].map((k) => (
          <span key={k} className="size-3.5 border" style={{ background: pal.card, borderColor: pal.line, borderRadius: small }} />
        ))}
      </span>
    </div>
  );
}

/**
 * Settings → Appearance → Style: a whole look — palette, texture, type — next to Light / Dark / System. Picking one applies its
 * accent, fonts and roundness; each can still be changed afterwards and the style stays on. "Reset" (top right) goes back to Default.
 */
export function StyleRow() {
  const style = useAppearanceStore((s) => s.style);
  const setStyle = useAppearanceStore((s) => s.setStyle);
  const current = themeStyleById(style);

  return (
    <div className="py-3">
      <div className="mb-2.5 min-w-0">
        <p className="text-[13px] font-medium leading-5">Style</p>
        <p className="text-xs leading-snug text-muted-foreground">
          {current.description} A style sets its accent, fonts and roundness too; change any of them afterwards and the style stays.
        </p>
      </div>
      <fieldset className="m-0 grid min-w-0 grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2 border-0 p-0">
        <legend className="sr-only">Style</legend>
        {THEME_STYLES.map((s) => {
          const selected = style === s.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={selected}
              title={s.description}
              onClick={() => setStyle(s.id)}
              className={cn(
                'flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 text-left outline-offset-2 transition-[border-color,background-color,transform] duration-150 active:scale-[0.98]',
                selected ? 'border-brand/60 bg-brand-soft' : 'hover:border-foreground/25 hover:bg-accent/50',
              )}
            >
              <StylePreview style={s} />
              <span className="flex items-center justify-between px-0.5 text-[13px] font-medium">
                {s.label}
                {selected && <Check className="size-3.5 text-brand-text" aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
