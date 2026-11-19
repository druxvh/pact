/**
 * Ultramarine's engraved plates: small squares of hairline line art — cobalt ground, lavender ink — drawn procedurally (no photograph,
 * nothing downloaded), after the plates on the reference site: a figure in a circular halo with threads radiating from it, and a
 * celestial diagram. `scripts/gen-ultramarine-plates.ts` writes them into `styles/ultramarine-plates.css` as data URLs, which the
 * style's CSS lays behind empty states, the sign-in gate and the welcome form; a test checks the file is the generator's output.
 *
 * Pure and deterministic: a seeded generator, rounded numbers, no timestamps — the same call always makes the same bytes.
 */

/** The plate's colours. A plate is an object, so it is the same in light and dark: ground, ink, and a bright for the highlights. */
export const PLATE = { ground: '#0f0fe0', ink: '#c9c9ee', bright: '#fafaff' } as const;

/** mulberry32: a tiny seeded generator, so plates (and their tests) are repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coordinates to a tenth of a unit (a plate is 96 units across: that is a tenth of a pixel, finer than a hairline). */
const n = (v: number) => String(Math.round(v * 10) / 10);
/** Stroke widths to a hundredth. */
const w = (v: number) => String(Math.round(v * 100) / 100);
const TAU = Math.PI * 2;

/** `<svg>` text → a CSS `url("data:…")` with nothing in it that breaks a quoted CSS url. */
export function svgUrl(svg: string): string {
  const encoded = svg.replace(/\s+/g, ' ').replace(/"/g, "'").replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E');
  return `url("data:image/svg+xml,${encoded}")`;
}

/** A run of round dots as one path (each is a zero-length stroke with round caps): `M x y h0`. */
const dots = (pts: readonly (readonly [number, number])[], width: number, ink: string, opacity: number) =>
  pts.length
    ? `<path d='${pts.map(([x, y]) => `M${n(x)} ${n(y)}h0`).join('')}' stroke='${ink}' stroke-width='${w(width)}' stroke-linecap='round' stroke-opacity='${n(opacity)}'/>`
    : '';

/** Specks of grain: tiny bright dots at random, in three strengths, as on a printed plate. */
function grain(rand: () => number, width: number, height: number, count: number, ink: string, max = 0.2): string {
  const buckets: [number, number][][] = [[], [], []];
  for (let i = 0; i < count; i++) (buckets[Math.floor(rand() * 3)] as [number, number][]).push([rand() * width, rand() * height]);
  return buckets.map((pts, i) => dots(pts, 0.5 + i * 0.12, ink, max * (0.35 + i * 0.35))).join('');
}

/** Light from the upper left, as a unit vector (x right, y down, z toward the viewer). */
const LIGHT = (() => {
  const v = { x: -0.55, y: -0.6, z: 0.58 };
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
})();

/** Lambert shade of a point (x, y) on the unit sphere: 1 in full light, 0 in full shadow, -1 off the sphere. */
function shadeAt(x: number, y: number): number {
  const d2 = x * x + y * y;
  if (d2 > 1) return -1;
  return Math.max(0, x * LIGHT.x + y * LIGHT.y + Math.sqrt(1 - d2) * LIGHT.z);
}

/**
 * Parallel hatching over a sphere: every line is cut into runs, each drawn at a weight that follows the shade under it — nothing where it
 * is lit, a hairline in half-light, a heavy stroke in shadow. That is how an engraver models a form with one tool, and it is what makes the
 * orb read as engraved rather than dotted. `bands` = [shade ceiling, stroke width] from the lightest band to the darkest.
 */
function hatch(cx: number, cy: number, r: number, angleDeg: number, gap: number, bands: readonly (readonly [number, number])[], ink: string): string {
  const a = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(a), y: Math.sin(a) };
  const nor = { x: -dir.y, y: dir.x };
  const paths = bands.map(() => '');
  const steps = 32;
  for (let t = -r + gap / 2; t < r; t += gap) {
    const half = Math.sqrt(Math.max(0, r * r - t * t));
    let run: { band: number; from: number } | null = null;
    const at = (s: number) => `${n(cx + nor.x * t + dir.x * s)} ${n(cy + nor.y * t + dir.y * s)}`;
    const flush = (to: number) => {
      if (run) paths[run.band] += `M${at(run.from)}L${at(to)}`;
      run = null;
    };
    for (let i = 0; i <= steps; i++) {
      const s = -half + (2 * half * i) / steps;
      const shade = shadeAt((nor.x * t + dir.x * s) / r, (nor.y * t + dir.y * s) / r);
      const band = bands.findIndex(([ceiling]) => shade < ceiling);
      if (band < 0 || shade < 0) {
        flush(s);
      } else if (!run || run.band !== band) {
        flush(s);
        run = { band, from: s };
      }
    }
    flush(half);
  }
  return paths
    .map((d, i) =>
      d ? `<path d='${d}' fill='none' stroke='${ink}' stroke-width='${w((bands[i] as readonly [number, number])[1])}' stroke-opacity='0.95'/>` : '',
    )
    .join('');
}

/** An engraved sphere: hatching modelled by the light, a cross-hatch in the deepest shadow, a little stipple at the edge of the shade, a lit rim. */
function engravedOrb(rand: () => number, cx: number, cy: number, r: number, scale: number): string {
  let out = `<circle cx='${n(cx)}' cy='${n(cy)}' r='${n(r)}' fill='${PLATE.ground}'/>`;
  out += hatch(
    cx,
    cy,
    r,
    36,
    0.85 * scale,
    [
      [0.8, 0.16],
      [0.55, 0.3],
      [0.32, 0.48],
      [0.14, 0.7],
    ],
    PLATE.ink,
  );
  out += hatch(
    cx,
    cy,
    r,
    -48,
    1.1 * scale,
    [
      [0.3, 0.2],
      [0.12, 0.36],
    ],
    PLATE.ink,
  );
  const speck: [number, number][] = [];
  for (let tries = 0; speck.length < Math.round(60 * scale * scale) && tries < 4000; tries++) {
    const x = rand() * 2 - 1;
    const y = rand() * 2 - 1;
    const shade = shadeAt(x, y);
    if (shade > 0.34 && shade < 0.7 && rand() < 0.5) speck.push([cx + x * r, cy + y * r]);
  }
  out += dots(speck, 0.5, PLATE.bright, 0.7);
  out += `<circle cx='${n(cx)}' cy='${n(cy)}' r='${n(r)}' fill='none' stroke='${PLATE.bright}' stroke-width='0.5' stroke-opacity='0.9'/>`;
  return out;
}

/** The line screen under a plate: faint horizontal hairlines, as in the engraved plates of the reference — one tone laid in rules. */
function lineScreen(width: number, height: number, gap: number): string {
  let d = '';
  for (let y = gap / 2; y < height; y += gap) d += `M0 ${n(y)}H${width}`;
  return `<path d='${d}' stroke='${PLATE.ink}' stroke-width='0.18' stroke-opacity='0.14'/>`;
}

/**
 * The halo: a stippled orb inside a ring, with hairline threads radiating from it to the edge of the plate — some short and dense
 * near the ring, a handful long, like the strings in the reference engraving. 96 × 96.
 */
export function haloPlateSvg(size = 96, width = size): string {
  const rand = rng(1913);
  const cx = width / 2;
  const cy = size * 0.52;
  const ring = size * 0.4;
  let threads = '';
  const count = 176;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + (rand() - 0.5) * 0.03;
    // three lengths: a few long threads that run off the plate, a middle rank, and a dense short fringe
    const reach =
      i % 11 === 5
        ? Math.max(size, width * 0.5) * (0.8 + rand() * 0.24)
        : i % 3 === 0
          ? ring + size * (0.1 + rand() * 0.07)
          : ring + size * (0.035 + rand() * 0.05);
    const r0 = ring + size * (0.008 + rand() * 0.02);
    threads += `M${n(cx + Math.cos(a) * r0)} ${n(cy + Math.sin(a) * r0)}L${n(cx + Math.cos(a) * reach)} ${n(cy + Math.sin(a) * reach)}`;
  }
  // tick marks on the inner side of the ring
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU;
    const r0 = ring - (i % 6 === 0 ? size * 0.05 : size * 0.025);
    ticks += `M${n(cx + Math.cos(a) * r0)} ${n(cy + Math.sin(a) * r0)}L${n(cx + Math.cos(a) * ring)} ${n(cy + Math.sin(a) * ring)}`;
  }
  return [
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${size}' viewBox='0 0 ${width} ${size}'>`,
    `<rect width='${width}' height='${size}' fill='${PLATE.ground}'/>`,
    lineScreen(width, size, 1.5),
    grain(rand, width, size, Math.round(150 * Math.sqrt(width / size)), PLATE.bright, 0.16),
    `<path d='${threads}' fill='none' stroke='${PLATE.ink}' stroke-width='0.35' stroke-opacity='0.78'/>`,
    `<circle cx='${n(cx)}' cy='${n(cy)}' r='${n(ring)}' fill='none' stroke='${PLATE.ink}' stroke-width='0.6' stroke-opacity='0.9'/>`,
    `<path d='${ticks}' fill='none' stroke='${PLATE.ink}' stroke-width='0.4' stroke-opacity='0.8'/>`,
    `<circle cx='${n(cx)}' cy='${n(cy)}' r='${n(ring - size * 0.075)}' fill='none' stroke='${PLATE.ink}' stroke-width='0.3' stroke-opacity='0.55' stroke-dasharray='0.5 1.6'/>`,
    engravedOrb(rand, cx, cy, size * 0.17, 1),
    `</svg>`,
  ].join('');
}

/** The halo laid across a strip (the About page's frontispiece): the same rings and threads, the threads running out to both ends. 352 × 64. */
export const bannerPlateSvg = (): string => haloPlateSvg(64, 352);

/** The armillary: a celestial diagram of nested rings, a tilted axis, an orbit with its bodies, and a graduated outer band. 96 × 96. */
export function armillaryPlateSvg(size = 96): string {
  const rand = rng(7001);
  const c = size / 2;
  const R = size * 0.42;
  const ellipse = (rx: number, ry: number, rot: number, extra = '') =>
    `<ellipse cx='${n(c)}' cy='${n(c)}' rx='${n(rx)}' ry='${n(ry)}' transform='rotate(${rot} ${n(c)} ${n(c)})' fill='none' stroke='${PLATE.ink}' stroke-width='0.5' stroke-opacity='0.85' ${extra}/>`;
  // the graduated band between two circles
  let band = '';
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * TAU;
    const r1 = R + size * 0.055;
    const r0 = R + (i % 10 === 0 ? size * 0.012 : i % 5 === 0 ? size * 0.026 : size * 0.04);
    band += `M${n(c + Math.cos(a) * r0)} ${n(c + Math.sin(a) * r0)}L${n(c + Math.cos(a) * r1)} ${n(c + Math.sin(a) * r1)}`;
  }
  // the axis, tilted 23.4°
  const tilt = (-23.4 * Math.PI) / 180;
  const ax = (r: number) => `${n(c + Math.sin(tilt) * r)} ${n(c - Math.cos(tilt) * r)}`;
  const axis = `M${ax(R + size * 0.09)}L${ax(-(R + size * 0.09))}`;
  // a few bodies on the inner orbit
  let bodies = '';
  for (const [deg, rad] of [
    [38, 1.9],
    [152, 1.3],
    [236, 2.3],
    [318, 1.5],
  ] as const) {
    const a = (deg * Math.PI) / 180;
    const rr = R * 0.62;
    bodies += `<circle cx='${n(c + Math.cos(a) * rr)}' cy='${n(c + Math.sin(a) * rr)}' r='${n(rad)}' fill='${PLATE.ground}' stroke='${PLATE.bright}' stroke-width='0.5'/>`;
  }
  return [
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>`,
    `<rect width='${size}' height='${size}' fill='${PLATE.ground}'/>`,
    lineScreen(size, size, 1.5),
    grain(rand, size, size, 150, PLATE.bright, 0.16),
    `<circle cx='${n(c)}' cy='${n(c)}' r='${n(R)}' fill='none' stroke='${PLATE.ink}' stroke-width='0.6' stroke-opacity='0.9'/>`,
    `<circle cx='${n(c)}' cy='${n(c)}' r='${n(R + size * 0.055)}' fill='none' stroke='${PLATE.ink}' stroke-width='0.4' stroke-opacity='0.7'/>`,
    `<path d='${band}' fill='none' stroke='${PLATE.ink}' stroke-width='0.3' stroke-opacity='0.75'/>`,
    ellipse(R, R * 0.34, -23),
    ellipse(R, R * 0.34, 23),
    ellipse(R * 0.34, R, -23),
    `<circle cx='${n(c)}' cy='${n(c)}' r='${n(R * 0.62)}' fill='none' stroke='${PLATE.ink}' stroke-width='0.35' stroke-opacity='0.6' stroke-dasharray='0.6 1.4'/>`,
    `<path d='${axis}' fill='none' stroke='${PLATE.bright}' stroke-width='0.4' stroke-opacity='0.8'/>`,
    bodies,
    engravedOrb(rand, c, c, size * 0.085, 0.55),
    `</svg>`,
  ].join('');
}

/** Grain for the page: a tile of faint bright specks, tiled over the page colour at a few percent (opaque dots on a transparent tile). 112 × 112. */
export function grainTileSvg(size = 112): string {
  const rand = rng(404);
  return [
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>`,
    grain(rand, size, size, 220, '#ffffff', 0.7),
    `</svg>`,
  ].join('');
}

/** The generated stylesheet: one custom property per plate. `scripts/gen-ultramarine-plates.ts` writes it; a test compares. */
export function ultramarinePlatesCss(): string {
  return [
    '/* GENERATED by scripts/gen-ultramarine-plates.ts from features/ultramarine/plates.ts — do not edit by hand. */',
    ':root {',
    `  --um-plate-halo: ${svgUrl(haloPlateSvg())};`,
    `  --um-plate-armillary: ${svgUrl(armillaryPlateSvg())};`,
    `  --um-plate-banner: ${svgUrl(bannerPlateSvg())};`,
    `  --um-grain: ${svgUrl(grainTileSvg())};`,
    '}',
    '',
  ].join('\n');
}
