import { CATEGORIES, type Category, convert, type Unit } from '@/features/tools/lib/units';
import type { Answer } from '@/lib/omnibox/types';

type Ref = { cat: Category; unit: Unit };

/** Spoken/written names → unit ids, per category. The unit table's own ids, symbols and labels are added automatically. */
const EXTRA: Record<string, Record<string, string[]>> = {
  length: {
    km: ['kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms'],
    m: ['meter', 'meters', 'metre', 'metres'],
    cm: ['centimeter', 'centimeters', 'centimetre', 'centimetres'],
    mm: ['millimeter', 'millimeters', 'millimetre', 'millimetres'],
    mi: ['mile', 'miles'],
    yd: ['yard', 'yards', 'yds'],
    ft: ['foot', 'feet'],
    in: ['inch', 'inches'],
    nmi: ['nautical mile', 'nautical miles'],
  },
  mass: {
    kg: ['kilogram', 'kilograms', 'kilo', 'kilos', 'kgs'],
    g: ['gram', 'grams', 'gm'],
    mg: ['milligram', 'milligrams'],
    lb: ['pound', 'pounds', 'lbs'],
    oz: ['ounce', 'ounces'],
    t: ['tonne', 'tonnes', 'metric ton'],
    st: ['stone'],
  },
  temperature: { c: ['celsius', 'centigrade'], f: ['fahrenheit'], k: ['kelvin'] },
  volume: {
    l: ['liter', 'liters', 'litre', 'litres'],
    ml: ['milliliter', 'milliliters', 'millilitre', 'millilitres'],
    gal: ['gallon', 'gallons'],
    qt: ['quart', 'quarts'],
    pt: ['pint', 'pints'],
    cup: ['cup', 'cups'],
    floz: ['fl oz', 'fluid ounce', 'fluid ounces'],
    tbsp: ['tablespoon', 'tablespoons', 'tbs'],
    tsp: ['teaspoon', 'teaspoons'],
    m3: ['cubic meter', 'cubic meters', 'cubic metre', 'cubic metres'],
  },
  area: {
    km2: ['sq km', 'sqkm', 'square kilometer', 'square kilometers', 'square kilometre', 'square kilometres'],
    ha: ['hectare', 'hectares'],
    m2: ['sq m', 'sqm', 'square meter', 'square meters', 'square metre', 'square metres'],
    cm2: ['sq cm', 'square centimeter', 'square centimeters'],
    mi2: ['sq mi', 'square mile', 'square miles'],
    acre: ['acres', 'ac'],
    ft2: ['sq ft', 'sqft', 'square foot', 'square feet'],
    in2: ['sq in', 'square inch', 'square inches'],
  },
  speed: {
    ms: ['mps', 'meters per second', 'metres per second'],
    kmh: ['kph', 'kmph', 'kilometers per hour', 'kilometres per hour'],
    mph: ['miles per hour'],
    kn: ['knot', 'knots', 'kt', 'kts'],
    fts: ['fps', 'feet per second'],
  },
  data: {
    b: ['byte', 'bytes'],
    kb: ['kilobyte', 'kilobytes'],
    mb: ['megabyte', 'megabytes'],
    gb: ['gigabyte', 'gigabytes'],
    tb: ['terabyte', 'terabytes'],
    kib: ['kibibyte', 'kibibytes'],
    mib: ['mebibyte', 'mebibytes'],
    gib: ['gibibyte', 'gibibytes'],
    bit: ['bits'],
  },
  time: {
    ms: ['millisecond', 'milliseconds', 'msec'],
    s: ['sec', 'secs', 'second', 'seconds'],
    min: ['mins', 'minute', 'minutes'],
    h: ['hr', 'hrs', 'hour', 'hours'],
    d: ['day', 'days'],
    wk: ['wks', 'week', 'weeks'],
    yr: ['yrs', 'year', 'years'],
  },
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/°/g, '')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/^(?:degrees?|deg)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

let index: Map<string, Ref[]> | undefined;

function table(): Map<string, Ref[]> {
  if (index) return index;
  const map = new Map<string, Ref[]>();
  const add = (key: string, ref: Ref) => {
    const k = norm(key);
    if (!k) return;
    const list = map.get(k) ?? [];
    if (!list.some((r) => r.cat === ref.cat && r.unit === ref.unit)) list.push(ref);
    map.set(k, list);
  };
  for (const cat of CATEGORIES) {
    for (const unit of cat.units) {
      const ref = { cat, unit };
      add(unit.id, ref);
      add(unit.symbol, ref);
      add(unit.label, ref);
      for (const alias of EXTRA[cat.id]?.[unit.id] ?? []) add(alias, ref);
    }
  }
  index = map;
  return map;
}

function lookup(name: string): Ref[] {
  const t = table();
  const k = norm(name);
  const direct = t.get(k);
  if (direct) return direct;
  // plural fallbacks: "miles" → "mile", "inches" → "inch"
  if (k.endsWith('es')) {
    const hit = t.get(k.slice(0, -2));
    if (hit) return hit;
  }
  if (k.endsWith('s')) {
    const hit = t.get(k.slice(0, -1));
    if (hit) return hit;
  }
  return [];
}

const PARSE = /^\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[-+]?\d+)?|-?\.\d+)\s*([^\d\s].*?)\s+(?:in|to|into|as|->|→|=)\s+(.+?)\s*$/i;

/** Significant digits, no float dust, grouped: 6.2137119 → "6.213712", 22.2222222 → "22.22222". */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e12 || abs < 1e-6) return Number(n.toPrecision(6)).toExponential().replace('e+', 'e');
  return Number(n.toPrecision(7)).toLocaleString('en-US', { maximumFractionDigits: 8 });
}

/** `10 km in mi`, `72 f to c`, `3 cups in ml`, `1,000 ft to m`. */
export function convertAnswer(input: string): Answer | null {
  const m = PARSE.exec(input);
  if (!m) return null;
  const value = Number((m[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const from = lookup(m[2] ?? '');
  const to = lookup(m[3] ?? '');
  if (!from.length || !to.length) return null;
  for (const a of from) {
    const b = to.find((x) => x.cat === a.cat);
    if (!b) continue;
    const out = convert(value, a.cat.id, a.unit.id, b.unit.id);
    if (!Number.isFinite(out)) return null;
    const sep = /^[a-z]/i.test(b.unit.symbol) ? ' ' : '';
    const shown = `${formatQuantity(out)}${sep}${b.unit.symbol}`;
    return {
      kind: 'convert',
      expression: `${formatQuantity(value)} ${a.unit.symbol}`,
      value: shown,
      copy: shown,
      caption: `${a.cat.label} · ${a.unit.label} → ${b.unit.label}`,
    };
  }
  return null;
}
