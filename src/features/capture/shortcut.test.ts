import { describe, expect, it } from 'vitest';
import { CAPTURE_COMMAND_KEYS } from './defaults';
import { defaultCaptureKeys, shortcutKeys } from './shortcut';

describe('shortcutKeys', () => {
  it('splits Chrome’s "Alt+Shift+N" into one label per key', () => {
    expect(shortcutKeys('Alt+Shift+N')).toEqual(expect.arrayContaining(['Shift', 'N']));
    expect(shortcutKeys('Ctrl+Shift+Y')).toHaveLength(3);
  });

  it('splits macOS glyph strings such as ⇧⌘Y', () => {
    expect(shortcutKeys('⇧⌘Y')).toEqual(['⇧', '⌘', 'Y']);
  });

  it('ignores stray separators', () => {
    expect(shortcutKeys('')).toEqual([]);
    expect(shortcutKeys('Alt+ +N')).toHaveLength(2);
  });
});

describe('manifest suggestion', () => {
  it('has a key for Windows/Linux and one for macOS, each with a modifier Chrome accepts, and avoids Chrome’s incognito shortcut', () => {
    expect(CAPTURE_COMMAND_KEYS.default).toMatch(/^(Ctrl|Alt)\+/);
    expect(CAPTURE_COMMAND_KEYS.mac).toMatch(/^(Command|MacCtrl|Alt)\+/);
    for (const k of Object.values(CAPTURE_COMMAND_KEYS)) expect(k).not.toMatch(/^(Command|Ctrl)\+Shift\+N$/);
  });

  it('shows the default as separate keys', () => {
    expect(defaultCaptureKeys().length).toBeGreaterThanOrEqual(3);
  });
});
