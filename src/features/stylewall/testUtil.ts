/** Test helpers: `must` narrows an indexed value (arrays are `T | undefined` under noUncheckedIndexedAccess) and fails loudly if it is missing. */
export function must<T>(v: T | undefined | null): T {
  if (v === undefined || v === null) throw new Error('expected a value');
  return v;
}

/** A fake 2D context that records nothing and accepts every call: enough for the engine tests, which only care that the scene is driven. */
export function fakeContext(): CanvasRenderingContext2D {
  const handler: ProxyHandler<object> = {
    get: (_t, prop) => (prop === 'canvas' ? undefined : () => undefined),
    set: () => true,
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}
