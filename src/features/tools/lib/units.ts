/** Unit conversion data + maths. Linear units convert through a base unit; temperature is special-cased. */
export type Unit = { id: string; label: string; symbol: string; /** multiply to reach the base unit */ factor: number };
export type Category = { id: string; label: string; base: string; units: Unit[] };

const u = (id: string, label: string, symbol: string, factor: number): Unit => ({ id, label, symbol, factor });

export const CATEGORIES: Category[] = [
  {
    id: 'length',
    label: 'Length',
    base: 'm',
    units: [
      u('km', 'Kilometres', 'km', 1000),
      u('m', 'Metres', 'm', 1),
      u('cm', 'Centimetres', 'cm', 0.01),
      u('mm', 'Millimetres', 'mm', 0.001),
      u('mi', 'Miles', 'mi', 1609.344),
      u('yd', 'Yards', 'yd', 0.9144),
      u('ft', 'Feet', 'ft', 0.3048),
      u('in', 'Inches', 'in', 0.0254),
      u('nmi', 'Nautical miles', 'nmi', 1852),
    ],
  },
  {
    id: 'mass',
    label: 'Mass',
    base: 'kg',
    units: [
      u('t', 'Tonnes', 't', 1000),
      u('kg', 'Kilograms', 'kg', 1),
      u('g', 'Grams', 'g', 0.001),
      u('mg', 'Milligrams', 'mg', 1e-6),
      u('lb', 'Pounds', 'lb', 0.45359237),
      u('oz', 'Ounces', 'oz', 0.028349523125),
      u('st', 'Stone', 'st', 6.35029318),
    ],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    base: 'K',
    units: [u('c', 'Celsius', '°C', 1), u('f', 'Fahrenheit', '°F', 1), u('k', 'Kelvin', 'K', 1)],
  },
  {
    id: 'volume',
    label: 'Volume',
    base: 'L',
    units: [
      u('l', 'Litres', 'L', 1),
      u('ml', 'Millilitres', 'mL', 0.001),
      u('m3', 'Cubic metres', 'm³', 1000),
      u('gal', 'US gallons', 'gal', 3.785411784),
      u('qt', 'US quarts', 'qt', 0.946352946),
      u('pt', 'US pints', 'pt', 0.473176473),
      u('cup', 'US cups', 'cup', 0.2365882365),
      u('floz', 'US fluid ounces', 'fl oz', 0.0295735295625),
      u('tbsp', 'Tablespoons', 'tbsp', 0.01478676478125),
      u('tsp', 'Teaspoons', 'tsp', 0.00492892159375),
    ],
  },
  {
    id: 'area',
    label: 'Area',
    base: 'm²',
    units: [
      u('km2', 'Square kilometres', 'km²', 1e6),
      u('ha', 'Hectares', 'ha', 10000),
      u('m2', 'Square metres', 'm²', 1),
      u('cm2', 'Square centimetres', 'cm²', 0.0001),
      u('mi2', 'Square miles', 'mi²', 2589988.110336),
      u('acre', 'Acres', 'ac', 4046.8564224),
      u('ft2', 'Square feet', 'ft²', 0.09290304),
      u('in2', 'Square inches', 'in²', 0.00064516),
    ],
  },
  {
    id: 'speed',
    label: 'Speed',
    base: 'm/s',
    units: [
      u('ms', 'Metres / second', 'm/s', 1),
      u('kmh', 'Kilometres / hour', 'km/h', 1 / 3.6),
      u('mph', 'Miles / hour', 'mph', 0.44704),
      u('kn', 'Knots', 'kn', 0.514444444),
      u('fts', 'Feet / second', 'ft/s', 0.3048),
    ],
  },
  {
    id: 'data',
    label: 'Data',
    base: 'B',
    units: [
      u('b', 'Bytes', 'B', 1),
      u('kb', 'Kilobytes', 'KB', 1e3),
      u('mb', 'Megabytes', 'MB', 1e6),
      u('gb', 'Gigabytes', 'GB', 1e9),
      u('tb', 'Terabytes', 'TB', 1e12),
      u('kib', 'Kibibytes', 'KiB', 1024),
      u('mib', 'Mebibytes', 'MiB', 1024 ** 2),
      u('gib', 'Gibibytes', 'GiB', 1024 ** 3),
      u('bit', 'Bits', 'bit', 1 / 8),
    ],
  },
  {
    id: 'time',
    label: 'Time',
    base: 's',
    units: [
      u('ms', 'Milliseconds', 'ms', 0.001),
      u('s', 'Seconds', 's', 1),
      u('min', 'Minutes', 'min', 60),
      u('h', 'Hours', 'h', 3600),
      u('d', 'Days', 'd', 86400),
      u('wk', 'Weeks', 'wk', 604800),
      u('yr', 'Years (365.25 d)', 'yr', 31_557_600),
    ],
  },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<string, Category>;

const toKelvin = (v: number, unit: string) => (unit === 'c' ? v + 273.15 : unit === 'f' ? ((v - 32) * 5) / 9 + 273.15 : v);
const fromKelvin = (k: number, unit: string) => (unit === 'c' ? k - 273.15 : unit === 'f' ? ((k - 273.15) * 9) / 5 + 32 : k);

/** Convert `value` between two units of the same category. Returns NaN for unknown units. */
export function convert(value: number, categoryId: string, from: string, to: string): number {
  const cat = CATEGORY_BY_ID[categoryId];
  if (!cat) return Number.NaN;
  if (categoryId === 'temperature') return fromKelvin(toKelvin(value, from), to);
  const a = cat.units.find((x) => x.id === from);
  const b = cat.units.find((x) => x.id === to);
  if (!a || !b) return Number.NaN;
  return (value * a.factor) / b.factor;
}

/** Trim float noise and pick a sensible number of digits. */
export function formatUnit(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e12 || abs < 1e-6) return Number(n.toPrecision(8)).toExponential().replace('e+', 'e');
  return Number(n.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 8 });
}
