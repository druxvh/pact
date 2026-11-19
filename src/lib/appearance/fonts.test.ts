import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONTS, fontById, fontFaceCss, fontStack, interfaceFonts, monoFonts } from './fonts';

describe('font registry', () => {
  it('has unique ids', () => {
    expect(new Set(FONTS.map((f) => f.id)).size).toBe(FONTS.length);
  });

  it('every bundled font is open-licensed (SIL OFL / Apache) — nothing proprietary ships in the extension', () => {
    for (const f of FONTS.filter((x) => x.pkg && !x.builtIn)) {
      const scope = f.source === 'static' ? '@fontsource' : '@fontsource-variable';
      const pkg = JSON.parse(readFileSync(resolve(__dirname, `../../../node_modules/${scope}/${f.pkg}/package.json`), 'utf8')) as { license: string };
      expect(['OFL-1.1', 'Apache-2.0'], `${f.id} (${pkg.license})`).toContain(pkg.license);
    }
  });

  it('never bundles Nothing’s own typefaces', () => {
    for (const f of FONTS) expect(`${f.id} ${f.label} ${f.family}`, f.id).not.toMatch(/ndot|ntype|lettera/i);
  });
});

describe('Doto (display) and Space Mono (code)', () => {
  it('Doto is a variable display font that the interface and code pickers never offer', () => {
    const doto = fontById('doto');
    expect(doto?.category).toBe('display');
    expect(doto?.source).toBe('variable');
    expect(doto?.axes).toBe('full'); // the ROND (round dots) axis lives in the "full" file
    expect(interfaceFonts().some((f) => f.id === 'doto')).toBe(false);
    expect(monoFonts().some((f) => f.id === 'doto')).toBe(false);
  });

  it('Doto falls back to a monospace stack, and its @font-face covers every weight', () => {
    const doto = fontById('doto');
    if (!doto) throw new Error('doto missing');
    expect(fontStack(doto)).toBe("'Doto Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace");
    expect(fontFaceCss(doto, { variable: '/doto.woff2' })).toContain('font-weight:100 900');
  });

  it('Space Mono is a regular + bold code font, offered in the code picker', () => {
    const sm = fontById('space-mono');
    expect(sm?.category).toBe('mono');
    expect(sm?.weights).toEqual([400, 700]);
    expect(monoFonts().some((f) => f.id === 'space-mono')).toBe(true);
    const css = fontFaceCss(sm ?? (FONTS[0] as never), { '400': '/a.woff2', '700': '/b.woff2' });
    expect(css).toContain('font-weight:400');
    expect(css).toContain('font-weight:700');
  });

  it('the files the loader globs for really exist in the installed packages', () => {
    const root = resolve(__dirname, '../../../node_modules');
    for (const rel of [
      '@fontsource-variable/doto/files/doto-latin-full-normal.woff2',
      '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2',
      '@fontsource/space-mono/files/space-mono-latin-700-normal.woff2',
      '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2',
    ]) {
      expect(() => readFileSync(resolve(root, rel)), rel).not.toThrow();
    }
  });
});
