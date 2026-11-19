import { describe, expect, it } from 'vitest';
import { coerceOmniEffect, DEFAULT_OMNI_EFFECT, isOmniEffectId, OMNI_EFFECT_IDS, OMNI_EFFECTS, omniEffectById } from './omniEffect';

describe('omni effects registry', () => {
  it('defaults to no effect, so existing installs keep the plain search box', () => {
    expect(DEFAULT_OMNI_EFFECT).toBe('none');
    expect(OMNI_EFFECT_IDS[0]).toBe('none');
  });

  it('keeps the four effects that were asked for by name, plus Neon and the four added after', () => {
    expect([...OMNI_EFFECT_IDS]).toEqual(['none', 'beam', 'fire', 'electric', 'haze', 'neon', 'aurora', 'stardust', 'matrix', 'lava']);
  });

  it('has exactly one labelled, described entry per id, in the same order', () => {
    expect(OMNI_EFFECTS.map((e) => e.id)).toEqual([...OMNI_EFFECT_IDS]);
    for (const e of OMNI_EFFECTS) {
      expect(e.label.length, e.id).toBeGreaterThan(0);
      expect(e.description.length, e.id).toBeGreaterThan(8);
    }
  });

  it('Beam and Neon follow the accent; the rest keep their own colours', () => {
    expect(OMNI_EFFECTS.filter((e) => e.followsAccent).map((e) => e.id)).toEqual(['beam', 'neon']);
  });
});

describe('coerceOmniEffect', () => {
  it('accepts every known id and falls back to none for anything else', () => {
    for (const id of OMNI_EFFECT_IDS) expect(coerceOmniEffect(id)).toBe(id);
    for (const bad of [undefined, null, 'rainbow', 'plasma', 'BEAM', 3, {}, ['fire'], '']) expect(coerceOmniEffect(bad)).toBe('none');
    expect(isOmniEffectId('fire')).toBe(true);
    expect(isOmniEffectId('plasma')).toBe(false);
  });

  it('omniEffectById never returns nothing', () => {
    expect(omniEffectById('electric').label).toBe('Electric');
  });
});
