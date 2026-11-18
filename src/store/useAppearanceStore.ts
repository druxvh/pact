import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type AccentChoice, DEFAULT_ACCENT_ID } from '@/lib/appearance/accent';
import { DEFAULT_MONO, DEFAULT_SANS } from '@/lib/appearance/fonts';
import { coerceRadius, DEFAULT_RADIUS, type RadiusId } from '@/lib/appearance/radius';
import { type Dim, defaultDim, NO_WALLPAPER, uniformDim, type Wallpaper } from '@/lib/appearance/wallpaper';
import { syncAcrossTabs } from '@/lib/persist';

export type AppearanceState = {
  accent: AccentChoice;
  /** Interface font id (see lib/appearance/fonts). */
  font: string;
  /** Font for code, numbers and shortcuts. */
  monoFont: string;
  /** Corner roundness of buttons, cards, inputs… (`md` is the stock look). */
  radius: RadiusId;
  wallpaper: Wallpaper;
  /** 0–80 per theme: how much of the page background colour is laid over the wallpaper. */
  dim: Dim;
  /** 0–24 px; only meaningful for image wallpapers. */
  blur: number;
  /** Measured average luminance of an image wallpaper (0–1), for the legibility hint. */
  imageLuminance: number | null;

  setAccent: (accent: AccentChoice) => void;
  setFont: (id: string) => void;
  setMonoFont: (id: string) => void;
  setRadius: (radius: RadiusId) => void;
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
  accent: { kind: 'preset', id: DEFAULT_ACCENT_ID } as AccentChoice,
  font: DEFAULT_SANS,
  monoFont: DEFAULT_MONO,
  radius: DEFAULT_RADIUS as RadiusId,
  wallpaper: NO_WALLPAPER,
  dim: uniformDim(0),
  blur: 0,
  imageLuminance: null as number | null,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...APPEARANCE_DEFAULTS,
      setAccent: (accent) => set({ accent }),
      setFont: (font) => set({ font }),
      setMonoFont: (monoFont) => set({ monoFont }),
      setRadius: (radius) => set({ radius: coerceRadius(radius) }),
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
      version: 3,
      // v1 kept one dim for both themes; v2 had no roundness setting (everyone had the stock one).
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2 && typeof p.dim === 'number') p.dim = uniformDim(clamp(p.dim, 0, 80));
        if (version < 3) p.radius = DEFAULT_RADIUS;
        return p as unknown as AppearanceState;
      },
      partialize: (s) => ({
        accent: s.accent,
        font: s.font,
        monoFont: s.monoFont,
        radius: s.radius,
        wallpaper: s.wallpaper,
        dim: s.dim,
        blur: s.blur,
        imageLuminance: s.imageLuminance,
      }),
    },
  ),
);

syncAcrossTabs('pact-appearance', useAppearanceStore);
