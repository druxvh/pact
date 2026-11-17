import { describe, expect, it } from 'vitest';
import { hotkeyCaps, matchesHotkey } from '@/lib/omnibox/keys';

const ev = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('matchesHotkey', () => {
  it('uses ⌘ on a Mac and Ctrl elsewhere as "mod"', () => {
    expect(matchesHotkey('mod+enter', ev('Enter', { metaKey: true }), true)).toBe(true);
    expect(matchesHotkey('mod+enter', ev('Enter', { ctrlKey: true }), true)).toBe(false);
    expect(matchesHotkey('mod+enter', ev('Enter', { ctrlKey: true }), false)).toBe(true);
    expect(matchesHotkey('mod+enter', ev('Enter', { metaKey: true }), false)).toBe(false);
  });

  it('is exact about the other modifiers and the key', () => {
    expect(matchesHotkey('mod+c', ev('c', { metaKey: true }), true)).toBe(true);
    expect(matchesHotkey('mod+c', ev('C', { metaKey: true }), true)).toBe(true);
    expect(matchesHotkey('mod+c', ev('c', { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(matchesHotkey('mod+shift+c', ev('c', { metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(matchesHotkey('mod+c', ev('c'), true)).toBe(false);
    expect(matchesHotkey('enter', ev('Enter', { metaKey: true }), true)).toBe(false);
    expect(matchesHotkey('mod+backspace', ev('Backspace', { metaKey: true }), true)).toBe(true);
  });
});

describe('hotkeyCaps', () => {
  it('renders key caps', () => {
    expect(hotkeyCaps('mod+enter', '⌘')).toEqual(['⌘', '↵']);
    expect(hotkeyCaps('mod+shift+c', 'Ctrl')).toEqual(['Ctrl', '⇧', 'C']);
    expect(hotkeyCaps('mod+backspace', '⌘')).toEqual(['⌘', '⌫']);
  });
});
