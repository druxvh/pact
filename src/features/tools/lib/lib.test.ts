import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor, suggestForeground, toHex, toHslString, toOklchString, toRgbString, wcag } from '@/features/tools/lib/color';
import { base64Decode, base64Encode, formatJson, minifyJson, urlDecode, urlEncode } from '@/features/tools/lib/encode';
import { entropyBits, generatePassword, randomInt, SETS, strengthLabel } from '@/features/tools/lib/password';
import { CASES, LINES, reverseText, textStats } from '@/features/tools/lib/text';
import { convert, formatUnit } from '@/features/tools/lib/units';

describe('units', () => {
  it('converts linear units through the base unit', () => {
    expect(convert(10, 'length', 'km', 'mi')).toBeCloseTo(6.21371, 4);
    expect(convert(1, 'mass', 'kg', 'lb')).toBeCloseTo(2.20462, 4);
    expect(convert(1, 'data', 'gb', 'mb')).toBe(1000);
    expect(convert(1, 'data', 'gib', 'mib')).toBe(1024);
    expect(convert(90, 'time', 'min', 'h')).toBe(1.5);
  });
  it('handles temperature, including the −40 crossover', () => {
    expect(convert(100, 'temperature', 'c', 'f')).toBeCloseTo(212);
    expect(convert(32, 'temperature', 'f', 'c')).toBeCloseTo(0);
    expect(convert(0, 'temperature', 'c', 'k')).toBeCloseTo(273.15);
    expect(convert(-40, 'temperature', 'c', 'f')).toBeCloseTo(-40);
  });
  it('round-trips and rejects unknown units', () => {
    expect(convert(convert(42.5, 'length', 'ft', 'm'), 'length', 'm', 'ft')).toBeCloseTo(42.5);
    expect(convert(1, 'length', 'nope', 'm')).toBeNaN();
    expect(convert(1, 'nope', 'm', 'm')).toBeNaN();
  });
  it('formats without float noise', () => {
    expect(formatUnit(0.1 + 0.2)).toBe('0.3');
    expect(formatUnit(Number.NaN)).toBe('—');
  });
});

describe('colour', () => {
  it('parses hex in every length (the old tool printed NaN:1 for short hex)', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('0a0a0a')).toEqual({ r: 10, g: 10, b: 10, a: 1 });
    expect(parseColor('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 0.533 });
    expect(parseColor('#ff000080')?.a).toBeCloseTo(0.502, 2);
  });
  it('parses rgb()/hsl() in comma and space syntax', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('hsl(0 100% 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('hsl(120, 100%, 25%)')).toEqual({ r: 0, g: 128, b: 0, a: 1 });
  });
  it('rejects garbage', () => {
    for (const bad of ['', 'banana', '#12', '#12345', 'rgb(a,b,c)', 'hsl()']) expect(parseColor(bad)).toBeNull();
  });
  it('computes WCAG contrast', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // #767676 is the lightest grey that passes AA on white
    const grey = parseColor('#767676') ?? black;
    expect(contrastRatio(grey, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseColor('#777') ?? black, white)).toBeLessThan(4.6);
    expect(wcag(4.6)).toEqual({ aaNormal: true, aaaNormal: false, aaLarge: true, aaaLarge: true });
    expect(wcag(2.9).aaLarge).toBe(false);
  });
  it('formats colours', () => {
    const c = parseColor('#fb923c') ?? { r: 0, g: 0, b: 0, a: 1 };
    expect(toHex(c)).toBe('#fb923c');
    expect(toRgbString(c)).toBe('rgb(251 146 60)');
    expect(toHslString(c)).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(toOklchString({ r: 255, g: 255, b: 255, a: 1 })).toBe('oklch(1 0 0)');
    expect(toOklchString({ r: 0, g: 0, b: 0, a: 1 })).toBe('oklch(0 0 0)');
    expect(toHex({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('#01020380');
  });
  it('suggests a foreground that actually passes', () => {
    const bg = parseColor('#0a0a0a') ?? { r: 0, g: 0, b: 0, a: 1 };
    const fg = parseColor('#2a2a2a') ?? bg;
    const fixed = suggestForeground(fg, bg, 4.5);
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5);
    // already-passing colours are returned untouched
    const good = parseColor('#ffffff') ?? bg;
    expect(suggestForeground(good, bg)).toBe(good);
  });
});

describe('text tools', () => {
  it('converts between identifier cases', () => {
    expect(CASES.camel('hello world-foo_bar')).toBe('helloWorldFooBar');
    expect(CASES.pascal('hello world')).toBe('HelloWorld');
    expect(CASES.snake('Hello World FooBar')).toBe('hello_world_foo_bar');
    expect(CASES.kebab('someCamelCase')).toBe('some-camel-case');
    expect(CASES.constant('some camelCase')).toBe('SOME_CAMEL_CASE');
    expect(CASES.slug('  Crème Brûlée & Co.  ')).toBe('creme-brulee-co');
  });
  it('title/sentence case', () => {
    expect(CASES.title('the quick-brown fox')).toBe('The Quick-Brown Fox');
    expect(CASES.sentence('hello there. how ARE you? fine!')).toBe('Hello there. How are you? Fine!');
  });
  it('reverses by grapheme, not UTF-16 unit (the old version tore emoji apart)', () => {
    expect(reverseText('abc')).toBe('cba');
    expect(reverseText('a👨‍👩‍👧b')).toBe('b👨‍👩‍👧a');
    expect(reverseText('éx')).toBe('xé');
  });
  it('line tools', () => {
    expect(LINES.sort('b\na\nc10\nc2')).toBe('a\nb\nc2\nc10');
    expect(LINES.unique('a\nb\na')).toBe('a\nb');
    expect(LINES.dropEmpty('a\n\n  \nb')).toBe('a\nb');
    expect(LINES.reverse('1\n2\n3')).toBe('3\n2\n1');
  });
  it('counts', () => {
    const s = textStats('Hello world. This is pact!\nSecond line.');
    expect(s.words).toBe(7);
    expect(s.lines).toBe(2);
    expect(s.sentences).toBe(3);
    expect(textStats('').words).toBe(0);
    expect(textStats('👍👍').chars).toBe(2);
  });
});

describe('encoders', () => {
  it('base64 is unicode-safe (btoa alone throws on emoji)', () => {
    const text = 'héllo 👋 世界';
    const enc = base64Encode(text);
    expect(enc).toBe('aMOpbGxvIPCfkYsg5LiW55WM');
    expect(base64Decode(enc)).toEqual({ ok: true, value: text });
  });
  it('base64 url-safe + unpadded input', () => {
    const enc = base64Encode('???>>>', true);
    expect(enc).not.toMatch(/[+/=]/);
    expect(base64Decode(enc)).toEqual({ ok: true, value: '???>>>' });
  });
  it('base64 rejects garbage', () => {
    expect(base64Decode('%%%').ok).toBe(false);
  });
  it('url encode/decode', () => {
    expect(urlEncode('a b&c=d/é')).toEqual({ ok: true, value: 'a%20b%26c%3Dd%2F%C3%A9' });
    expect(urlEncode('https://x.dev/a b?q=é', true)).toEqual({ ok: true, value: 'https://x.dev/a%20b?q=%C3%A9' });
    expect(urlDecode('a%20b+c')).toEqual({ ok: true, value: 'a b c' });
    expect(urlDecode('%E0%A4%A').ok).toBe(false);
  });
  it('json format / minify / sort / errors', () => {
    expect(formatJson('{"b":1,"a":[1,2]}', 2)).toEqual({ ok: true, value: '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}' });
    expect(formatJson('{"b":1,"a":2}', 2, true)).toEqual({ ok: true, value: '{\n  "a": 2,\n  "b": 1\n}' });
    expect(minifyJson('{ "a" : [ 1 , 2 ] }')).toEqual({ ok: true, value: '{"a":[1,2]}' });
    const bad = formatJson('{"a":');
    expect(bad.ok).toBe(false);
  });
});

describe('password generation', () => {
  const opts = { length: 24, sets: { lower: true, upper: true, digits: true, symbols: true }, excludeAmbiguous: false };

  it('produces the requested length and at least one char from every selected set', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword(opts);
      expect(p).toHaveLength(24);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
    }
  });
  it('honours restricted sets and the ambiguity filter', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword({ ...opts, sets: { lower: false, upper: false, digits: true, symbols: false } })).toMatch(/^\d+$/);
      expect(generatePassword({ ...opts, excludeAmbiguous: true })).not.toMatch(/[Il1O0o|]/);
    }
  });
  it('returns empty when nothing is selected', () => {
    expect(generatePassword({ ...opts, sets: { lower: false, upper: false, digits: false, symbols: false } })).toBe('');
  });
  it('randomInt is in range and unbiased enough (rejection sampling)', () => {
    const N = 70_000;
    const dist = new Array(7).fill(0) as number[];
    for (let i = 0; i < N; i++) {
      const v = randomInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      dist[v] = (dist[v] ?? 0) + 1;
    }
    for (const c of dist) expect(Math.abs(c / N - 1 / 7)).toBeLessThan(0.01);
    expect(() => randomInt(0)).toThrow();
  });
  it('estimates entropy sensibly', () => {
    expect(entropyBits({ ...opts, length: 20 })).toBeGreaterThan(110);
    expect(entropyBits({ length: 8, sets: { lower: true, upper: false, digits: false, symbols: false }, excludeAmbiguous: false })).toBeCloseTo(37.6, 0);
    expect(strengthLabel(30).label).toBe('Weak');
    expect(strengthLabel(100).label).toBe('Excellent');
    expect(SETS.digits).toHaveLength(10);
  });
});
