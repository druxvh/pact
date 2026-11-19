/**
 * Engraving plates for the Ultramarine wallpaper: the figure at the heart of the halo. A plate is a small indexed PNG made by
 * `scripts/stylewall/plates.ts` with four pixel classes carried in the alpha channel (see `classOfAlpha`); the scene recolours it for light
 * and dark at run time, so one file serves both. To add a plate: run the script for it, add its PNG under `plates/`, an entry here, and
 * `{ id, label }` to the style's `wallpaper.plates` in lib/appearance/themeStyle.ts (the first listed is the default).
 */
import marcusUrl from './plates/marcus.png';
import melencoliaUrl from './plates/melencolia.png';
import roseUrl from './plates/rose.png';

export const PLATE_CLASS = { empty: 0, lit: 1, shade: 2, edge: 3 } as const;

/** Alpha of a plate pixel → its class (the PNG stores 0 / 96 / 176 / 255). */
export function classOfAlpha(a: number): number {
  return a < 48 ? PLATE_CLASS.empty : a < 136 ? PLATE_CLASS.lit : a < 216 ? PLATE_CLASS.shade : PLATE_CLASS.edge;
}

export type PlateDef = {
  id: string;
  /** The PNG's address and its pixel size (a test compares them with the file's header). */
  src: string;
  w: number;
  h: number;
  /** How tall the plate is drawn, as a fraction of the roundel's diameter (1 = fills it), and where it sits (0 = top-aligned, 1 = bottom-aligned). */
  fill: number;
  valign: number;
  /** A plate that fills the roundel with its own line work (Doré, Dürer) wants the plain ground: no stipple aureole behind it. */
  flat?: boolean;
};

export const PLATES: Readonly<Record<string, PlateDef>> = {
  /** Marcus Aurelius, a bust stippled from the repo's own dither mask; sits on the floor of the roundel. */
  halo: { id: 'halo', src: marcusUrl, w: 540, h: 636, fill: 0.97, valign: 1 },
  /** Doré's celestial rose, a circular crop re-cut as concentric lines; its circle slightly overfills the roundel so the pointer parallax never shows its edge. */
  rose: { id: 'rose', src: roseUrl, w: 780, h: 780, fill: 1.07, valign: 0.5, flat: true },
  /** Dürer's Melencolia I, a circular crop on the angel, line work kept as lines. */
  melencolia: { id: 'melencolia', src: melencoliaUrl, w: 900, h: 900, fill: 1.07, valign: 0.5, flat: true },
};

export const DEFAULT_PLATE = 'halo';

export const plateById = (id: string): PlateDef => PLATES[id] ?? (PLATES[DEFAULT_PLATE] as PlateDef);

/** Decode a plate into one class byte per pixel (browser only: uses an <img> and a canvas). */
export async function loadPlateClasses(def: PlateDef): Promise<Uint8Array> {
  const img = new Image();
  // `onload`, not `img.decode()`: decode() can stall in a backgrounded tab
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('plate failed to load'));
    img.src = def.src;
  });
  const c = document.createElement('canvas');
  c.width = def.w;
  c.height = def.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, def.w, def.h).data;
  const out = new Uint8Array(def.w * def.h);
  for (let i = 0; i < out.length; i++) out[i] = classOfAlpha(px[i * 4 + 3] as number);
  return out;
}
