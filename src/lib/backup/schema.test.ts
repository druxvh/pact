import { describe, expect, it } from 'vitest';
import { arr, bool, field, INVALID, iso, jsonObject, newCounter, nullable, num, obj, oneOf, optional, record, required, str } from './schema';

const c = () => newCounter();

describe('primitive parsers', () => {
  it('str / num / bool / oneOf / iso only accept the right type and range', () => {
    expect(str({ max: 3 })('abc', c())).toBe('abc');
    expect(str({ max: 3 })('abcd', c())).toBe(INVALID);
    expect(str({ max: 3, truncate: true })('abcd', c())).toBe('abc');
    expect(str({ min: 1 })('', c())).toBe(INVALID);
    expect(str({ pattern: /^\d+$/ })('12', c())).toBe('12');
    expect(str()(5, c())).toBe(INVALID);
    expect(num({ min: 0, max: 10, int: true })(5, c())).toBe(5);
    for (const bad of [-1, 11, 1.5, Number.NaN, Infinity, '5', null]) expect(num({ min: 0, max: 10, int: true })(bad, c())).toBe(INVALID);
    expect(bool(true, c())).toBe(true);
    expect(bool('true', c())).toBe(INVALID);
    expect(oneOf('a', 'b')('a', c())).toBe('a');
    expect(oneOf('a', 'b')('c', c())).toBe(INVALID);
    expect(iso('2026-11-17T12:00:00Z', c())).toBe('2026-11-17T12:00:00Z');
    expect(iso('not a date', c())).toBe(INVALID);
    expect(iso('x'.repeat(100), c())).toBe(INVALID);
  });

  it('nullable and optional', () => {
    expect(nullable(str())(null, c())).toBeNull();
    expect(nullable(str())(3, c())).toBe(INVALID);
    expect(optional(str())(undefined, c())).toBeUndefined();
    expect(optional(str())(3, c())).toBeUndefined();
  });
});

describe('collections', () => {
  it('arr drops invalid elements and counts them; a non-array is invalid', () => {
    const counter = c();
    expect(arr(str())(['a', 1, 'b', null], counter)).toEqual(['a', 'b']);
    expect(counter.dropped).toBe(2);
    expect(arr(str())('nope', c())).toBe(INVALID);
  });

  it('arr caps its length', () => {
    const counter = c();
    expect(arr(num(), { max: 2 })([1, 2, 3, 4], counter)).toEqual([1, 2]);
    expect(counter.dropped).toBe(2);
  });

  it('record builds a prototype-less map and refuses __proto__', () => {
    const counter = c();
    const out = record(str())(JSON.parse('{"a":"x","__proto__":"evil","b":5}'), counter) as Record<string, string>;
    expect(Object.keys(out)).toEqual(['a']);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(counter.dropped).toBe(2);
  });

  it('jsonObject bounds the size', () => {
    expect(jsonObject(20)({ a: 1 }, c())).toEqual({ a: 1 });
    expect(jsonObject(5)({ a: 'x'.repeat(50) }, c())).toBe(INVALID);
    expect(jsonObject(50)([], c())).toBe(INVALID);
  });
});

describe('obj', () => {
  const shape = { id: required(str({ min: 1 })), title: field(str(), () => 'untitled'), n: optional(num()) };

  it('copies only the declared keys — hostile keys can’t ride along', () => {
    const input = JSON.parse('{"id":"a","title":"t","n":1,"__proto__":{"polluted":true},"extra":"x"}');
    const out = obj(shape, true)(input, c()) as Record<string, unknown>;
    expect(out).toEqual({ id: 'a', title: 't', n: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('strict mode: a missing required field drops the element, a missing defaulted field gets its default', () => {
    expect(obj(shape, true)({ title: 't' }, c())).toBe(INVALID);
    expect(obj(shape, true)({ id: 'a' }, c())).toEqual({ id: 'a', title: 'untitled' });
    expect(obj(shape, true)({ id: 'a', title: 5 }, c())).toEqual({ id: 'a', title: 'untitled' });
  });

  it('lenient mode (older version, upgraded later by the store): everything is optional but still type-checked', () => {
    expect(obj(shape, false)({ title: 't' }, c())).toEqual({ title: 't' });
    expect(obj(shape, false)({ id: 5, title: ['x'] }, c())).toEqual({});
  });

  it('non-objects are invalid', () => {
    for (const bad of [null, 'x', 4, [], undefined]) expect(obj(shape, true)(bad, c())).toBe(INVALID);
  });
});
