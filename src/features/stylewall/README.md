# Style wallpapers

A theme style can ship an **animated wallpaper**: a low-resolution canvas scene painted behind the whole app. Ultramarine has
"Engraved Halo", Dusk has "Dithered Dusk". Default and Dot Matrix have none and load none of this code (every scene is a lazy
`import()`).

This file is the contract for the two style helpers (Ultramarine / Dusk CSS) and for anyone adding a scene.

## What is on the page

`<StyleWallpaper />` is mounted in `AppShell`, next to `<WallpaperLayer />`, as the first child of the isolated shell container:

```html
<div class="stylewall" data-stylewall="dusk" aria-hidden="true">   <!-- fixed, inset 0, z -20, pointer-events none -->
  <canvas />                                                         <!-- the scene; fades in once the first frame is drawn -->
  <div class="stylewall-scrim" />                                    <!-- the legibility scrim, see below -->
  <div class="stylewall-vignette" />                                 <!-- optional edge vignette (--sw-scrim-edge) -->
</div>
```

It renders **only** when all three hold: the active style has a `wallpaper` entry in `THEME_STYLES`, the user's _Style wallpaper_
setting is on (default **on**, and switched on again whenever a style is picked), and no colour / gradient / mesh / image wallpaper
is chosen (a wallpaper the user picked always wins). In that case `apply.ts` also writes

```
<html data-style="ultramarine" data-wallpaper="style">
```

(and caches `data-wallpaper` in the first-paint boot cache, so cards are translucent from the first frame). **Key your CSS on
`html[data-wallpaper='style']`** to restyle surfaces _only while the scene is behind them_, and on `html[data-style='…']` for the
rest of the style as before. A user wallpaper sets `data-wallpaper="color"|"image"` instead; the stock rules for those keep applying.

## CSS variables (all optional; defaults live in `src/styles/stylewall.css`)

Set them on `html[data-style='ultramarine']` (or `[data-wallpaper='style']`) — they are read at paint time, not by JS.

| Variable              | Default             | Meaning                                                                                                                                                                                                                    |
| --------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--sw-card`           | `76%`               | Opacity of the page `.bg-card` surfaces over the scene (`color-mix(var(--card) var(--sw-card), transparent)`). Raise it for a calmer page, lower it to let the art through.                                                |
| `--sw-blur`           | `14px`              | `backdrop-filter` blur on `.bg-card` over the scene. `0px` for a crisp printed look.                                                                                                                                       |
| `--sw-scrim`          | `0`                 | 0 … 1: how much of `var(--background)` is laid over the whole scene, on top of the user's Dim slider (`--wp-dim`). The scenes are composed to stay calm behind the content column, so 0 is right unless your type is thin. |
| `--sw-scrim-edge`     | `0`                 | Extra scrim toward the **edges** (a vignette in the page colour).                                                                                                                                                          |
| `--sw-canvas-opacity` | `1`                 | Opacity of the canvas itself.                                                                                                                                                                                              |
| `--sw-bg`             | `var(--background)` | What shows behind the canvas before its first frame (the scenes also paint their own base colour).                                                                                                                         |

The user's **Dim** slider (Settings → Appearance → Wallpaper) works for style wallpapers like for pictures: it drives `--wp-dim`,
which the scrim layer reads. Surfaces that sit _directly_ on the wallpaper (sidebar, top bar) already use `bg-background/70`, so a
dim scene stays readable.

Hooks you can rely on: `.stylewall`, `.stylewall > canvas`, `.stylewall-scrim`, `data-stylewall="<scene id>"`.

## Palettes

Scenes carry their own palettes in TypeScript (`scenes/<id>/palette.ts`), given by the style's tokens:

- **Dusk**: dark = `#191724 → #2a2342 → #6b3f6e → #eb6f92 → #f6c177`, ridges `#1f1d2e / #26233a / #403d52`; light dawn =
  `#faf4ed → #f2e9e1 → #ebbcba → #f6c177`. (Rose Pine's palette; tune in `scenes/dusk/palette.ts`.)
- **Ultramarine**: ink-navy field `#0a0b2a`-ish, ultramarine `#2323ff` and lavender `#b9b4ff`; light = navy ink on pale lavender paper.
  The scene follows the user's accent for the main ink.

If a token in `src/styles/<style>.css` changes, change the matching constant in that palette file (the scene does not read CSS at runtime).

## The engine (`engine.ts`)

One `mountStyleWallpaper(host, canvas, { scene, … })` per page. It owns everything a scene should not think about:

- **One shared rAF loop** (`loop.ts`) with an fps cap per scene (24–30) — the loop and its rAF stop when nothing is subscribed or the tab is hidden, and
  a long gap (a throttled/hidden tab) resumes at one normal frame, so nothing jumps.
- **Size**: the scene says how many canvas pixels it wants for a viewport (`scene.size`), the engine sets the canvas and a
  `ResizeObserver` follows the viewport. DPR-aware, never layout-thrashing (it only touches the canvas when the size key changes).
- **Reduced motion** — OS `prefers-reduced-motion`, `<html data-motion='reduced'>` or `useSettingsStore().motion === 'reduced'`
  (and `'full'` overrides the OS) → exactly one frame at `scene.stillTime`, then the loop is off and the pointer listener is gone.
- **Light/dark**: `options.dark` eases 0↔1 over 450 ms after the theme flips; scenes lerp their palettes by it (no second canvas).
- **Pointer parallax**: `options.px/py` (−1…1, smoothed) from `pointermove` on the window; 0 when still.
- **Teardown**: `dispose()` cancels the loop subscription, observers and listeners, then `scene.dispose()`, and zeroes the canvas.

## Writing a scene

```ts
// scenes/<id>/scene.ts
import type { SceneFactory } from '../../types';
export const create: SceneFactory = ({ ctx, options, seed }) => ({
  fps: 30,
  stillTime: 12,
  size: (vw, vh, dpr) => ({ w: Math.ceil(vw / 3), h: Math.ceil(vh / 3), smooth: false }),
  resize(w, h, dpr) {
    /* build buffers */
  },
  frame(t, dt) {
    /* draw everything; read options.dark / options.px … fresh every frame */
  },
  dispose() {},
});
```

Then add the loader to `registry.ts` and a `wallpaper` entry to the style in `lib/appearance/themeStyle.ts`. Rules a scene lives by:
no `Math.random` (use the seeded `rng.ts`), no allocation per frame, ≤ ~3 ms of main-thread work per frame at 1440×900,
no timers/rAF of its own, nothing drawn outside `frame`.

## Plates (Ultramarine)

A _plate_ is the figure at the heart of Engraved Halo: a small indexed PNG (`plates/*.png`, 2 bits per pixel) with four pixel
classes carried in the **alpha channel** (0 empty, 96 lit, 176 shade, 255 contour — a browser may colour-manage RGB, never alpha),
which the scene recolours per theme (lit dots in lavender on the ultramarine ground in dark; shade dots in navy on paper in light).
`plates.ts` holds the placement (`fill`, `valign`) and the PNG's size (a test compares it with the file header); the style lists the
choices in `wallpaper.plates` (`lib/appearance/themeStyle.ts`; the first is the default) and Settings → Appearance → Wallpaper → Style
shows a thumbnail picker when there is more than one.

- `halo` — the Marcus Aurelius bust (the Metropolitan Museum's, public domain), stippled from the repo's existing dither mask by
  `scripts/stylewall/plates.ts` (matte-aware tone reconstruction, ×3 Catmull-Rom upscale, blue-noise stipple, drawn contour). It sits on the
  floor of the roundel.
- `rose` — Gustave Doré, _Paradiso_ canto 31 (public domain): a circular crop on the celestial rose, re-engraved as a tone-modulated line screen
  whose lines run in wobbling ellipses round the star (following the rose's own tiers), with a solid star and tangent-detected rays at the centre.
- `melencolia` — Albrecht Dürer, _Melencolia I_ (public domain): a circular crop on the angel, reduced only ~1.2× so the burin lines survive,
  then an unsharp mask and a threshold that follows the local mean _and_ the absolute tone (paper = lit, line = shade): a positive print in both themes.
- Doré and Dürer fill the roundel (`fill: 1.07`, a little over the roundel's circle so the pointer parallax never shows the plate's edge; `flat: true`: no stipple ground behind them). Their source JPEGs are **not** in the repo; the
  script takes them with `--dore <jpg> --durer <jpg>` ("File:Paradiso Canto 31 (no caption).jpg" 2448×2992 and "File:Dürer Melancholia I.jpg"
  3146×4000 on Wikimedia Commons).
- To add one: add a job to the script, run `bun scripts/stylewall/plates.ts [--dore …] --preview <dir>` (preview sheets stay out of the repo),
  commit the PNG, add its entry to `plates.ts`, the `{ id, label }` to the style, and a credit to `credits.ts` (listed in Settings → About).

## Tests

`bun run test src/features/stylewall src/lib/appearance/stylewall.test.ts` — seeded unit tests for the pure parts (Bayer / blue-noise
thresholds, palette quantisation, ridgelines, ray / ring / dust layout, stipple masks, the plate PNGs), the engine (loop, fps cap, resize,
dispose, hidden tab, reduced motion, crossfade, pointer, a 20-minute simulated run) and the registry/CSS contract.

## Dev harness

`src/dev/wall-harness.html?scene=dusk|ultramarine&theme=dark|light&t=24&px=0&py=0` mounts one scene full screen and freezes the live loop;
`canvas.swDev.step(n, dt)`, `.at(t)`, `.pointer(x, y)` step it by hand (dev builds only — `import.meta.env.DEV`, absent from the production bundle).
