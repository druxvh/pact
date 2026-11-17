/**
 * A tiny validator for data that comes from a file (or an old build) and must never be trusted.
 *
 * Every parser returns the clean value or `INVALID`. `obj` copies *only the declared keys* (so unknown or hostile keys
 * such as `__proto__` can't ride along), and in *strict* mode (the data is in the current store version) it applies
 * defaults and treats missing required fields as an invalid element; in *lenient* mode (an older version, which the
 * store's own `migrate` will upgrade) every field is optional but still type-checked. Arrays drop invalid elements
 * and count them, so the preview can say "3 entries were unreadable and skipped".
 */
export const INVALID: unique symbol = Symbol('invalid');
export type Invalid = typeof INVALID;
export type Counter = { dropped: number };
export type Parser<T = unknown> = (v: unknown, c: Counter) => T | Invalid;
export type Rec = Record<string, unknown>;

export const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export function str(o: { min?: number; max?: number; truncate?: boolean; pattern?: RegExp } = {}): Parser<string> {
  return (v) => {
    if (typeof v !== 'string') return INVALID;
    let s = v;
    if (o.max !== undefined && s.length > o.max) {
      if (!o.truncate) return INVALID;
      s = s.slice(0, o.max);
    }
    if (o.min !== undefined && s.length < o.min) return INVALID;
    if (o.pattern && !o.pattern.test(s)) return INVALID;
    return s;
  };
}

export function num(o: { min?: number; max?: number; int?: boolean } = {}): Parser<number> {
  return (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return INVALID;
    if (o.int && !Number.isInteger(v)) return INVALID;
    if (o.min !== undefined && v < o.min) return INVALID;
    if (o.max !== undefined && v > o.max) return INVALID;
    return v;
  };
}

export const bool: Parser<boolean> = (v) => (typeof v === 'boolean' ? v : INVALID);

export function oneOf<T extends string>(...allowed: readonly T[]): Parser<T> {
  return (v) => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : INVALID);
}

/** A parseable date string (ISO). */
export const iso: Parser<string> = (v) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : INVALID);

export const nullable =
  <T>(p: Parser<T>): Parser<T | null> =>
  (v, c) => {
    if (v === null) return null;
    const r = p(v, c);
    return r === INVALID ? INVALID : r;
  };

/** Wrong type or missing → the field is simply left out (the store's default applies). */
export const optional =
  <T>(p: Parser<T>): Parser<T | undefined> =>
  (v, c) => {
    if (v === undefined) return undefined;
    const r = p(v, c);
    return r === INVALID ? undefined : r;
  };

export const withDefault =
  <T>(p: Parser<T>, d: () => T): Parser<T> =>
  (v, c) => {
    const r = p(v, c);
    return r === INVALID ? d() : r;
  };

/** An array of valid elements; invalid ones are dropped (and counted). Not an array → invalid. */
export function arr<T>(p: Parser<T>, o: { max?: number } = {}): Parser<T[]> {
  return (v, c) => {
    if (!Array.isArray(v)) return INVALID;
    const out: T[] = [];
    for (const item of v) {
      if (o.max !== undefined && out.length >= o.max) {
        c.dropped++;
        continue;
      }
      const r = p(item, c);
      if (r === INVALID) c.dropped++;
      else out.push(r);
    }
    return out;
  };
}

/** A string-keyed map of valid values. */
export function record<T>(p: Parser<T>, o: { maxKeys?: number } = {}): Parser<Record<string, T>> {
  return (v, c) => {
    if (!isRecord(v)) return INVALID;
    const out: Record<string, T> = Object.create(null);
    let n = 0;
    for (const [k, item] of Object.entries(v)) {
      if (k === '__proto__' || (o.maxKeys !== undefined && n >= o.maxKeys)) {
        c.dropped++;
        continue;
      }
      const r = p(item, c);
      if (r === INVALID) c.dropped++;
      else {
        out[k] = r;
        n++;
      }
    }
    return out;
  };
}

/** Any plain JSON object of bounded size (for values the store sanitises itself, like the Home layout). */
export function jsonObject(maxChars: number): Parser<Rec> {
  return (v) => {
    if (!isRecord(v)) return INVALID;
    try {
      return JSON.stringify(v).length <= maxChars ? (JSON.parse(JSON.stringify(v)) as Rec) : INVALID;
    } catch {
      return INVALID;
    }
  };
}

export type Field = { p: Parser; req?: boolean; def?: () => unknown };
/** A field that must be valid (strict mode) or the whole element is dropped. */
export const required = (p: Parser): Field => ({ p, req: true });
/** A field with a fallback for strict mode. */
export const field = (p: Parser, def?: () => unknown): Field => ({ p, def });

/** A bare parser is an optional field: missing or malformed → left out. */
export function obj(fields: Record<string, Field | Parser>, strict: boolean): Parser<Rec> {
  return (v, c) => {
    if (!isRecord(v)) return INVALID;
    const out: Rec = {};
    for (const [k, spec] of Object.entries(fields)) {
      const f: Field = typeof spec === 'function' ? { p: spec } : spec;
      const raw = Object.hasOwn(v, k) ? v[k] : undefined;
      const r = raw === undefined ? INVALID : f.p(raw, c);
      if (r !== INVALID) {
        if (r !== undefined) out[k] = r;
      } else if (strict && f.req) {
        return INVALID;
      } else if (strict && f.def) {
        out[k] = f.def();
      }
    }
    return out;
  };
}

/** Number of top-level state fields that were present but unusable (dropped), for the preview's warning. */
export const newCounter = (): Counter => ({ dropped: 0 });
