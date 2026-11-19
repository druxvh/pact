/**
 * Loads a bundled font on demand. The glob makes Vite emit each woff2 as a hashed asset and hands back a lazy
 * importer, so nothing is downloaded (or even parsed) until a font is chosen or previewed.
 */
import { type FontDef, fontById, fontFaceCss } from './fonts';

const variableFiles = import.meta.glob<string>(
  ['/node_modules/@fontsource-variable/*/files/*-latin-wght-normal.woff2', '!/node_modules/@fontsource-variable/{doto,fraunces}/**'],
  {
    query: '?url',
    import: 'default',
  },
);
// Doto's round-dot axis and Fraunces' optical-size + SOFT axes live in their "full" files; explicit paths so no other family's extra axes get bundled.
const fullFiles = import.meta.glob<string>(
  [
    '/node_modules/@fontsource-variable/doto/files/doto-latin-full-normal.woff2',
    '/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2',
  ],
  { query: '?url', import: 'default' },
);
const staticFiles = import.meta.glob<string>(
  '/node_modules/@fontsource/{roboto,lato,poppins,ibm-plex-mono,space-mono}/files/*-latin-{300,400,500,600,700}-normal.woff2',
  {
    query: '?url',
    import: 'default',
  },
);

const cssCache = new Map<string, Promise<string>>();

/** The @font-face CSS for a font (resolving its file URLs). Cached per font. */
export function fontCss(font: FontDef): Promise<string> {
  if (font.builtIn || !font.pkg) return Promise.resolve('');
  let p = cssCache.get(font.id);
  if (!p) {
    p = (async () => {
      const urls: Record<string, string> = {};
      if (font.source === 'variable') {
        const axes = font.axes ?? 'wght';
        const path = `/node_modules/@fontsource-variable/${font.pkg}/files/${font.pkg}-latin-${axes}-normal.woff2`;
        const load = axes === 'full' ? fullFiles[path] : variableFiles[path];
        if (load) urls.variable = await load();
      } else {
        await Promise.all(
          (font.weights ?? []).map(async (w) => {
            const load = staticFiles[`/node_modules/@fontsource/${font.pkg}/files/${font.pkg}-latin-${w}-normal.woff2`];
            if (load) urls[String(w)] = await load();
          }),
        );
      }
      return fontFaceCss(font, urls);
    })();
    cssCache.set(font.id, p);
  }
  return p;
}

const injected = new Set<string>();

/** Make a font available to the page (idempotent). Resolves once its CSS is in place; glyphs then load lazily. */
export async function ensureFont(id: string): Promise<void> {
  const font = fontById(id);
  if (!font || injected.has(id)) return;
  const css = await fontCss(font);
  injected.add(id);
  if (!css) return;
  const el = document.createElement('style');
  el.dataset.pactFont = id;
  el.textContent = css;
  document.head.append(el);
}
