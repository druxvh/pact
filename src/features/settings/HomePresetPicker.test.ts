import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PRESETS, presetLayout } from '@/features/home/layout';
import { LayoutPreview, LayoutRow, widgetColumns } from './HomePresetPicker';

describe('widgetColumns', () => {
  it('matches how Home lays widgets out', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(widgetColumns)).toEqual([1, 1, 2, 3, 2, 3, 3]);
  });
});

describe('LayoutPreview', () => {
  const html = (id: (typeof PRESETS)[number]['id']) => renderToStaticMarkup(createElement(LayoutPreview, { layout: presetLayout(id) }));
  const count = (s: string, needle: string) => s.split(needle).length - 1;

  it('is decoration only', () => {
    expect(html('classic')).toContain('aria-hidden="true"');
  });

  it('draws what the layout has — and nothing it hasn’t', () => {
    expect(count(html('classic'), 'size-2 rounded-sm')).toBe(5); // shortcuts
    expect(count(html('minimal'), 'size-2 rounded-sm')).toBe(0);
    expect(html('minimal')).toContain('h-1.5 w-7'); // compact clock
    expect(html('zen')).toContain('rounded-full border-2'); // analog clock
    expect(count(html('dashboard'), 'border-brand/40')).toBe(presetLayout('dashboard').widgets.length);
    expect(count(html('classic'), 'border-brand/40')).toBe(0);
  });
});

describe('LayoutRow', () => {
  it('shows every layout as a picture button, with the current one pressed', () => {
    const markup = renderToStaticMarkup(createElement(LayoutRow));
    for (const p of PRESETS) expect(markup, p.label).toContain(`>${p.label}`);
    expect(markup.split('<button').length - 1).toBe(PRESETS.length);
    expect(markup.split('aria-pressed="true"').length - 1).toBe(1);
    expect(markup).toContain('aria-pressed="true"');
  });
});
