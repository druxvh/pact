import { describe, expect, it } from 'vitest';
import { evaluate, formatResult, plainResult } from '@/features/tools/lib/calc';

const val = (expr: string, angle: 'deg' | 'rad' = 'deg') => {
  const r = evaluate(expr, angle);
  if (!r.ok) throw new Error(`"${expr}" failed: ${r.error}`);
  return r.value;
};
const err = (expr: string) => {
  const r = evaluate(expr);
  return r.ok ? null : r.error;
};

describe('calculator', () => {
  it('does arithmetic with correct precedence', () => {
    expect(val('1+2*3')).toBe(7);
    expect(val('(1+2)*3')).toBe(9);
    expect(val('10-4-3')).toBe(3);
    expect(val('2*3+4*5')).toBe(26);
    expect(val('10/4')).toBe(2.5);
  });

  it('handles unary minus and right-associative powers like a calculator', () => {
    expect(val('-2^2')).toBe(-4);
    expect(val('2^3^2')).toBe(512); // 2^(3^2)
    expect(val('2^-3')).toBe(0.125);
    expect(val('--5')).toBe(5);
    expect(val('3*-2')).toBe(-6);
  });

  it('supports implicit multiplication', () => {
    expect(val('2(3+4)')).toBe(14);
    expect(val('2(3+4)^2/7')).toBe(14);
    expect(val('(1+2)(3+4)')).toBe(21);
    expect(val('2pi')).toBeCloseTo(Math.PI * 2);
    expect(val('3sqrt(16)')).toBe(12);
  });

  it('distinguishes modulo from percent', () => {
    expect(val('7%3')).toBe(1);
    expect(val('50%')).toBe(0.5);
    expect(val('200*50%')).toBe(100);
    expect(val('sqrt(16)+50%*200')).toBe(104);
  });

  it('evaluates functions and constants', () => {
    expect(val('sqrt(144)')).toBe(12);
    expect(val('max(1,100,7)')).toBe(100);
    expect(val('min(4,2)')).toBe(2);
    expect(val('abs(-3.5)')).toBe(3.5);
    expect(val('round(2.567,2)')).toBe(2.57);
    expect(val('log(1000)')).toBeCloseTo(3);
    expect(val('ln(e)')).toBeCloseTo(1);
    expect(val('5!')).toBe(120);
    expect(val('pi')).toBeCloseTo(Math.PI);
    expect(val('sqrt 16')).toBe(4);
  });

  it('respects the angle mode and cleans up float dust', () => {
    expect(val('sin(30)', 'deg')).toBeCloseTo(0.5);
    expect(val('sin(180)', 'deg')).toBe(0); // not 1.2e-16
    expect(val('cos(90)', 'deg')).toBe(0);
    expect(val('sin(pi/2)', 'rad')).toBeCloseTo(1);
    expect(val('asin(1)', 'deg')).toBeCloseTo(90);
  });

  it('accepts typographic operators', () => {
    expect(val('6×7')).toBe(42);
    expect(val('20÷4')).toBe(5);
    expect(val('9−4')).toBe(5);
    expect(val('2**10')).toBe(1024);
    expect(val('√9')).toBe(3);
    expect(val('2π')).toBeCloseTo(Math.PI * 2);
  });

  it('reports errors instead of throwing', () => {
    expect(err('1+')).toBeTruthy();
    expect(err('(1+2')).toBe('Missing )');
    expect(err('10/0')).toBe('Division by zero');
    expect(err('foo(2)')).toMatch(/Unknown function/);
    expect(err('banana')).toMatch(/Unknown name/);
    expect(err('2 $ 3')).toMatch(/Unexpected/);
    expect(err('(-1)!')).toMatch(/Factorial/);
  });

  it('never executes code — the old Function() eval hole is gone', () => {
    expect(err('process.exit()')).toBeTruthy();
    expect(err('constructor.constructor("return 1")()')).toBeTruthy();
    expect(err('alert(1)')).toBeTruthy();
    expect(err('globalThis')).toBeTruthy();
    expect(err('__proto__')).toBeTruthy();
    // prototype keys must not resolve as functions/constants
    expect(err('toString(1)')).toBeTruthy();
    expect(err('hasOwnProperty')).toBeTruthy();
  });

  it('returns an empty (non-error) state for blank input', () => {
    const r = evaluate('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('');
  });
});

describe('formatting', () => {
  it('removes floating point dust', () => {
    expect(plainResult(0.1 + 0.2)).toBe('0.3');
    expect(plainResult(1 / 3)).toBe('0.333333333333');
  });
  it('handles extremes and non-finite values', () => {
    expect(formatResult(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatResult(0)).toBe('0');
    expect(formatResult(1e20)).toMatch(/e/);
    expect(plainResult(Number.NaN)).toBe('');
  });
});
