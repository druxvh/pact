import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type AccentChoice, DEFAULT_ACCENT_ID } from '@/lib/appearance/accent';
import { DEFAULT_MONO, DEFAULT_SANS } from '@/lib/appearance/fonts';
import { coerceOmniEffect, DEFAULT_OMNI_EFFECT, type OmniEffectId } from '@/lib/appearance/omniEffect';
import { coerceRadius, DEFAULT_RADIUS, type RadiusId } from '@/lib/appearance/radius';
import { coercePlate, coerceThemeStyle, DEFAULT_THEME_STYLE, retiredStyleSuccessor, styleBundle, type ThemeStyleId } from '@/lib/appearance/themeStyle';
import { type Dim, defaultDim, NO_WALLPAPER, uniformDim, type Wallpaper } from '@/lib/appearance/wallpaper';
import { syncAcrossTabs } from '@/lib/persist';

export type AppearanceState = {
  /** The whole look next to Light/Dark (see lib/appearance/themeStyle). `default` is the stock pact. */
  style: ThemeStyleId;
  accent: AccentChoice;
  /** Interface font id (see lib/appearance/fonts). */
  font: string;
  /** Font for code, numbers and shortcuts. */
  monoFont: string;
  /** Corner roundness of buttons, cards, inputs… (`md` is the stock look). */
  radius: RadiusId;
  /** Light show around the Home search box (see lib/appearance/omniEffect). */
  omniEffect: OmniEffectId;
  wallpaper: Wallpaper;
  /** Paint the style's own animated wallpaper (features/stylewall) when it has one and no wallpaper of your own is chosen. On by default, and on again whenever a style is picked. */
  styleWallpaper: boolean;
  /** Which variant of the style's wallpaper ("plate"); '' for a style whose wallpaper has none. */
  plate: string;
  /** 0–80 per theme: how much of the page background colour is laid over the wallpaper. */
  dim: Dim;
  /** 0–24 px; only meaningful for image wallpapers. */
  blur: number;
  /** Measured average luminance of an image wallpaper (0–1), for the legibility hint. */
  imageLuminance: number | null;

  /**
   * Pick a style: its bundle (accent, fonts, roundness) is applied once, then each of those can still be changed and the
   * style stays selected. Picking the style that is already on changes nothing (so your tweaks survive a stray click).
   */
  setStyle: (style: ThemeStyleId) => void;
  setAccent: (accent: AccentChoice) => void;
  setFont: (id: string) => void;
  setMonoFont: (id: string) => void;
  setRadius: (radius: RadiusId) => void;
  setOmniEffect: (effect: OmniEffectId) => void;
  setStyleWallpaper: (on: boolean) => void;
  setPlate: (plate: string) => void;
  /** Switching kind resets dim to a sensible default for that kind. */
  setWallpaper: (wallpaper: Wallpaper, imageLuminance?: number | null) => void;
  /** Set the dim for one theme. */
  setDim: (theme: 'light' | 'dark', dim: number) => void;
  /** Set both themes' dim at once (e.g. to the readable suggestion for a new wallpaper). */
  setDims: (dim: Dim) => void;
  setBlur: (blur: number) => void;
  resetAppearance: () => void;
};

export const APPEARANCE_DEFAULTS = {
  style: DEFAULT_THEME_STYLE as ThemeStyleId,
  accent: { kind: 'preset', id: DEFAULT_ACCENT_ID } as AccentChoice,
  font: DEFAULT_SANS,
  monoFont: DEFAULT_MONO,
  radius: DEFAULT_RADIUS as RadiusId,
  omniEffect: DEFAULT_OMNI_EFFECT as OmniEffectId,
  wallpaper: NO_WALLPAPER,
  styleWallpaper: true,
  plate: '',
  dim: uniformDim(0),
  blur: 0,
  imageLuminance: null as number | null,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...APPEARANCE_DEFAULTS,
      setStyle: (style) =>
        set((s) => {
          const next = coerceThemeStyle(style);
          return next === s.style ? s : { style: next, ...styleBundle(next), styleWallpaper: true, plate: coercePlate(next, '') };
        }),
      setAccent: (accent) => set({ accent }),
      setFont: (font) => set({ font }),
      setMonoFont: (monoFont) => set({ monoFont }),
      setRadius: (radius) => set({ radius: coerceRadius(radius) }),
      setOmniEffect: (omniEffect) => set({ omniEffect: coerceOmniEffect(omniEffect) }),
      setStyleWallpaper: (styleWallpaper) => set({ styleWallpaper }),
      setPlate: (plate) => set((s) => ({ plate: coercePlate(s.style, plate) })),
      setWallpaper: (wallpaper, imageLuminance) =>
        set((s) => ({
          wallpaper,
          imageLuminance: wallpaper.kind === 'image' ? (imageLuminance ?? s.imageLuminance) : null,
          dim: wallpaper.kind === s.wallpaper.kind ? s.dim : uniformDim(defaultDim(wallpaper.kind)),
          blur: wallpaper.kind === 'image' ? s.blur : 0,
        })),
      setDim: (theme, dim) => set((s) => ({ dim: { ...s.dim, [theme]: clamp(dim, 0, 80) } })),
      setDims: (dim) => set({ dim: { light: clamp(dim.light, 0, 80), dark: clamp(dim.dark, 0, 80) } }),
      setBlur: (blur) => set({ blur: clamp(blur, 0, 24) }),
      resetAppearance: () => set({ ...APPEARANCE_DEFAULTS }),
    }),
    {
      name: 'pact-appearance',
      version: 4,
      // v1 kept one dim for both themes; v2 had no roundness setting (everyone had the stock one); v3 had no style and no
      // search bar effect (everyone had the default look and a plain box).
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2 && typeof p.dim === 'number') p.dim = uniformDim(clamp(p.dim, 0, 80));
        if (version < 3) p.radius = DEFAULT_RADIUS;
        if (version < 4) {
          p.style = DEFAULT_THEME_STYLE;
          p.omniEffect = DEFAULT_OMNI_EFFECT;
        }
        return p as unknown as AppearanceState;
      },
      // Unknown values (a hand-edited file, a style from a newer build) fall back to the stock choice instead of reaching the CSS.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppearanceState>;
        const style = coerceThemeStyle(p.style);
        // A style that was retired (Stoic → Ultramarine, Terminal → Dusk): its successor comes with its own accent, fonts and roundness,
        // not the old style's (a red accent and a serif would not suit a navy look).
        const successor = retiredStyleSuccessor(p.style);
        return {
          ...current,
          ...p,
          ...(successor ? styleBundle(successor) : {}),
          style,
          // (the successor's roundness too: the persisted one belonged to the style it replaces)
          radius: coerceRadius(successor ? styleBundle(successor).radius : p.radius),
          omniEffect: coerceOmniEffect(p.omniEffect),
          styleWallpaper: typeof p.styleWallpaper === 'boolean' ? p.styleWallpaper : true,
          plate: coercePlate(style, p.plate),
        };
      },
      partialize: (s) => ({
        style: s.style,
        accent: s.accent,
        font: s.font,
        monoFont: s.monoFont,
        radius: s.radius,
        omniEffect: s.omniEffect,
        wallpaper: s.wallpaper,
        styleWallpaper: s.styleWallpaper,
        plate: s.plate,
        dim: s.dim,
        blur: s.blur,
        imageLuminance: s.imageLuminance,
      }),
    },
  ),
);

syncAcrossTabs('pact-appearance', useAppearanceStore);
