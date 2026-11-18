import { describe, expect, it } from 'vitest';
import { scrollDelta } from './scroll';

const box = { top: 100, bottom: 500, height: 400 };
const at = (top: number, height = 50) => ({ top, bottom: top + height, height });

describe('scrollDelta', () => {
  it('start: brings the element to the top of the container (minus an offset)', () => {
    expect(scrollDelta('start', at(400), box)).toBe(300);
    expect(scrollDelta('start', at(400), box, 16)).toBe(284);
    expect(scrollDelta('start', at(60), box)).toBe(-40);
  });
  it('center: centres it', () => {
    expect(scrollDelta('center', at(400), box)).toBe(125);
  });
  it('nearest: does nothing when it is already visible, otherwise the shortest move', () => {
    expect(scrollDelta('nearest', at(200), box)).toBe(0);
    expect(scrollDelta('nearest', at(480), box)).toBe(30);
    expect(scrollDelta('nearest', at(60), box)).toBe(-40);
  });
});
