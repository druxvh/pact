/**
 * A small, safe expression evaluator (recursive descent) — no eval / Function.
 * (The old calculator used `Function()`, which MV3's CSP blocks, so it never worked in the real
 * extension — and it executed arbitrary code from the input box.)
 *
 * Supports: + − × ÷ * / % ^ ** ! ( ) , numbers (1.5e3), implicit multiplication (2(3+4), 2pi),
 * postfix percent (50%), constants (pi e tau phi), and common functions. Angles: deg | rad.
 */
export type AngleMode = 'deg' | 'rad';
export type CalcResult = { ok: true; value: number } | { ok: false; error: string };

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '%' | '^' | '!' }
  | { t: '(' }
  | { t: ')' }
  | { t: ',' };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

class CalcError extends Error {}

/** Own-property lookup only — plain `in`/index lookups would resolve `__proto__`, `constructor`, `toString`… */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function tokenize(input: string): Token[] {
  const src = input
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/π/g, ' pi ')
    .replace(/√/g, ' sqrt ')
    .replace(/\*\*/g, '^');
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new CalcError('Invalid number');
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-z_]/i.test(ch)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i));
      const id = (m?.[0] ?? '').toLowerCase();
      out.push({ t: 'id', v: id });
      i += id.length;
    } else if ('+-*/%^!'.includes(ch)) {
      out.push({ t: 'op', v: ch as '+' });
      i++;
    } else if (ch === '(' || ch === ')' || ch === ',') {
      out.push({ t: ch });
      i++;
    } else {
      throw new CalcError(`Unexpected “${ch}”`);
    }
  }
  return out;
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new CalcError('Factorial needs a whole number ≥ 0');
  if (n > 170) return Number.POSITIVE_INFINITY;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

function makeFunctions(angle: AngleMode): Record<string, (...a: number[]) => number> {
  const toRad = (x: number) => (angle === 'deg' ? (x * Math.PI) / 180 : x);
  const fromRad = (x: number) => (angle === 'deg' ? (x * 180) / Math.PI : x);
  // Clean up float dust like sin(180°) = 1.2e-16.
  const clean = (x: number) => (Math.abs(x) < 1e-14 ? 0 : x);
  return {
    sin: (x = 0) => clean(Math.sin(toRad(x))),
    cos: (x = 0) => clean(Math.cos(toRad(x))),
    tan: (x = 0) => clean(Math.tan(toRad(x))),
    asin: (x = 0) => fromRad(Math.asin(x)),
    acos: (x = 0) => fromRad(Math.acos(x)),
    atan: (x = 0) => fromRad(Math.atan(x)),
    sinh: (x = 0) => Math.sinh(x),
    cosh: (x = 0) => Math.cosh(x),
    tanh: (x = 0) => Math.tanh(x),
    sqrt: (x = 0) => Math.sqrt(x),
    cbrt: (x = 0) => Math.cbrt(x),
    abs: (x = 0) => Math.abs(x),
    ln: (x = 0) => Math.log(x),
    log: (x = 0) => Math.log10(x),
    log2: (x = 0) => Math.log2(x),
    exp: (x = 0) => Math.exp(x),
    floor: (x = 0) => Math.floor(x),
    ceil: (x = 0) => Math.ceil(x),
    round: (x = 0, d = 0) => {
      const f = 10 ** d;
      return Math.round(x * f) / f;
    },
    trunc: (x = 0) => Math.trunc(x),
    sign: (x = 0) => Math.sign(x),
    fact: (x = 0) => factorial(x),
    pow: (a = 0, b = 1) => a ** b,
    min: (...a) => Math.min(...a),
    max: (...a) => Math.max(...a),
    hypot: (...a) => Math.hypot(...a),
  };
}

export function evaluate(input: string, angle: AngleMode = 'deg'): CalcResult {
  if (!input.trim()) return { ok: false, error: '' };
  try {
    const tokens = tokenize(input);
    const fns = makeFunctions(angle);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    const isOp = (tok: Token | undefined, ...ops: string[]) => tok?.t === 'op' && ops.includes(tok.v);
    /** Can this token begin a primary (used for implicit multiplication / modulo-vs-percent)? */
    const startsPrimary = (tok: Token | undefined) => tok?.t === 'num' || tok?.t === 'id' || tok?.t === '(';

    function expr(): number {
      let v = term();
      while (isOp(peek(), '+', '-')) {
        const op = (next() as { v: string }).v;
        const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }

    function term(): number {
      let v = unary();
      for (;;) {
        const tok = peek();
        if (isOp(tok, '*', '/')) {
          next();
          const r = unary();
          if (tok && (tok as { v: string }).v === '/') {
            if (r === 0) throw new CalcError('Division by zero');
            v /= r;
          } else v *= r;
        } else if (isOp(tok, '%')) {
          // "7 % 3" → modulo; "50%" / "50% * 2" → percent
          if (startsPrimary(tokens[pos + 1])) {
            next();
            const r = unary();
            if (r === 0) throw new CalcError('Division by zero');
            v %= r;
          } else {
            next();
            v /= 100;
          }
        } else if (tok?.t === '(' || tok?.t === 'id') {
          // implicit multiplication: 2(3+4), 2pi, (1+2)(3+4), 3sqrt(4)
          v *= unary();
        } else {
          return v;
        }
      }
    }

    function unary(): number {
      if (isOp(peek(), '-')) {
        next();
        return -unary();
      }
      if (isOp(peek(), '+')) {
        next();
        return unary();
      }
      return power();
    }

    function power(): number {
      const base = postfix();
      if (isOp(peek(), '^')) {
        next();
        return base ** unary(); // right-associative, allows 2^-3
      }
      return base;
    }

    function postfix(): number {
      let v = primary();
      while (isOp(peek(), '!')) {
        next();
        v = factorial(v);
      }
      return v;
    }

    function primary(): number {
      const tok = next();
      if (!tok) throw new CalcError('Unexpected end');
      if (tok.t === 'num') return tok.v;
      if (tok.t === '(') {
        const v = expr();
        if (next()?.t !== ')') throw new CalcError('Missing )');
        return v;
      }
      if (tok.t === 'id') {
        if (peek()?.t === '(') {
          next();
          const args: number[] = [];
          if (peek()?.t !== ')') {
            do {
              args.push(expr());
            } while (peek()?.t === ',' && next());
          }
          if (next()?.t !== ')') throw new CalcError('Missing )');
          const fn = own(fns, tok.v);
          if (!fn) throw new CalcError(`Unknown function “${tok.v}”`);
          return fn(...args);
        }
        const constant = own(CONSTANTS, tok.v);
        if (constant !== undefined) return constant;
        // a bare function name followed by a number, e.g. "sqrt 16"
        const fn = own(fns, tok.v);
        if (fn && startsPrimary(peek())) return fn(unary());
        throw new CalcError(`Unknown name “${tok.v}”`);
      }
      throw new CalcError(`Unexpected “${tok.t === 'op' ? tok.v : tok.t}”`);
    }

    const value = expr();
    if (pos < tokens.length) throw new CalcError('Unexpected input');
    if (Number.isNaN(value)) return { ok: false, error: 'Not a number' };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof CalcError ? e.message : 'Invalid expression' };
  }
}

/** Display formatting: no float dust (0.1+0.2 → 0.3), grouping, and exponent notation at the extremes. */
export function formatResult(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '−∞' : 'Error';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-9) return Number(n.toPrecision(10)).toExponential().replace('e+', 'e');
  return Number(n.toPrecision(12)).toLocaleString(undefined, { maximumFractionDigits: 10 });
}

/** Plain (ungrouped) string for copy/paste and for feeding back into the expression. */
export function plainResult(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(Number(n.toPrecision(12)));
}
