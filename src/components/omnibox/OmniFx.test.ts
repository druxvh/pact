import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OMNI_EFFECT_IDS, type OmniEffectId } from '@/lib/appearance/omniEffect';
import { OmniFx, OmniFxLine } from './OmniFx';

const box = createElement('form', { id: 'the-box' }, 'search');
/** OmniFx wrapped so tests can give it its child as createElement's third argument. */
const Fx = OmniFx as unknown as (props: { effect: OmniEffectId; scale?: number }) => ReactElement;
const render = (effect: OmniEffectId) => renderToStaticMarkup(createElement(Fx, { effect }, box));

describe('OmniFx (server markup — the canvas is drawn on mount)', () => {
  it('with no effect it is just a wrapper around the box: no canvas', () => {
    const html = render('none');
    expect(html).toContain('data-fx="none"');
    expect(html).toContain('id="the-box"');
    expect(html).not.toContain('<canvas');
  });

  it('every real effect adds exactly one decorative canvas after the box (so it sits over its border, never in the way)', () => {
    for (const id of OMNI_EFFECT_IDS.filter((i) => i !== 'none')) {
      const html = render(id);
      expect(html.match(/<canvas/g)?.length, id).toBe(1);
      expect(html, id).toContain('aria-hidden="true"');
      expect(html.indexOf('<canvas'), id).toBeGreaterThan(html.indexOf('id="the-box"'));
      expect(html, id).not.toMatch(/<(button|input|a|select|textarea)[ >]/);
    }
  });

  it('keeps the box exactly once and passes the effect name to the stylesheet hook', () => {
    for (const id of OMNI_EFFECT_IDS) {
      const html = render(id);
      expect(html.split('id="the-box"').length - 1, id).toBe(1);
      expect(html, id).toContain(`data-fx="${id}"`);
    }
  });
});

describe('OmniFxLine (the ⌘K palette)', () => {
  const line = (effect: OmniEffectId) => renderToStaticMarkup(createElement(OmniFxLine, { effect }));

  it('draws nothing without an effect', () => {
    expect(line('none')).toBe('');
  });

  it('is one decorative strip with a canvas for every other effect', () => {
    for (const id of OMNI_EFFECT_IDS.filter((i) => i !== 'none')) {
      const html = line(id);
      expect(html, id).toContain('omni-fx-line');
      expect(html, id).toContain('aria-hidden="true"');
      expect(html.match(/<canvas/g)?.length, id).toBe(1);
    }
  });
});
