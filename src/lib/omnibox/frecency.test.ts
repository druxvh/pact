import { describe, expect, it } from 'vitest';
import { emptyUsage, forgetUsage, frecency, PIN_BOOST, recordUsage, togglePinned, usageBoost } from '@/lib/omnibox/frecency';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 17);

describe('frecency', () => {
  it('grows with use and halves every two weeks', () => {
    let u = emptyUsage();
    u = recordUsage(u, 'a', T0);
    const once = frecency(u.entries.a, T0);
    u = recordUsage(u, 'a', T0);
    u = recordUsage(u, 'a', T0);
    const thrice = frecency(u.entries.a, T0);
    expect(thrice).toBeGreaterThan(once);
    expect(frecency(u.entries.a, T0 + 14 * DAY)).toBeCloseTo(thrice / 2, 5);
    expect(frecency(undefined, T0)).toBe(0);
  });

  it('never lets a habit beat a clearly better match', () => {
    let u = emptyUsage();
    for (let i = 0; i < 40; i++) u = recordUsage(u, 'habit', T0);
    // a weak fuzzy match (score 100) gets at most 60% on top; a prefix match (900) is out of reach
    expect(100 + usageBoost(u, 'habit', 100, T0)).toBeLessThan(900);
    expect(usageBoost(u, 'habit', 100, T0)).toBeLessThanOrEqual(60);
    expect(usageBoost(u, 'habit', 1000, T0)).toBeLessThan(100); // can't lift a prefix match (~900) over an exact one (1000)
    expect(usageBoost(u, 'unused', 800, T0)).toBe(0);
  });

  it('pins add a fixed boost on top', () => {
    const u = togglePinned(emptyUsage(), 'p');
    expect(usageBoost(u, 'p', 500, T0)).toBe(PIN_BOOST);
    expect(togglePinned(u, 'p').pinned).toEqual([]);
  });

  it('forgets a key everywhere and caps the table', () => {
    let u = togglePinned(recordUsage(emptyUsage(), 'a', T0), 'a');
    u = forgetUsage(u, 'a');
    expect(u).toEqual({ entries: {}, pinned: [] });
    let big = emptyUsage();
    for (let i = 0; i < 400; i++) big = recordUsage(big, `k${i}`, T0 + i);
    expect(Object.keys(big.entries).length).toBeLessThanOrEqual(160);
    expect(big.entries.k399).toBeDefined(); // the newest survive
    expect(big.entries.k0).toBeUndefined();
  });

  it('keeps at most a dozen pins', () => {
    let u = emptyUsage();
    for (let i = 0; i < 20; i++) u = togglePinned(u, `p${i}`);
    expect(u.pinned).toHaveLength(12);
    expect(u.pinned[0]).toBe('p19');
  });
});
