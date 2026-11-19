import { describe, expect, it } from 'vitest';
import { activeSection } from './nav';

const tops = (...t: number[]) => ['profile', 'appearance', 'home', 'about'].slice(0, t.length).map((id, i) => ({ id, top: t[i] as number }));

describe('activeSection', () => {
  it('is the last section whose top has passed the reading line', () => {
    expect(activeSection(tops(10, 400, 900, 1400), 120, false)).toBe('profile');
    expect(activeSection(tops(-300, 100, 600, 1100), 120, false)).toBe('appearance');
    expect(activeSection(tops(-900, -500, 90, 700), 120, false)).toBe('home');
  });

  it('falls back to the first section when none has reached the line yet', () => {
    expect(activeSection(tops(300, 700, 1000, 1500), 120, false)).toBe('profile');
  });

  it('highlights the last section at the very bottom, even when it is too short to reach the line', () => {
    expect(activeSection(tops(-1500, -1000, -400, 480), 120, true)).toBe('about');
    expect(activeSection(tops(-1500, -1000, -400, 480), 120, false)).toBe('home');
  });

  it('has no answer without sections', () => {
    expect(activeSection([], 100, false)).toBe('');
  });
});
