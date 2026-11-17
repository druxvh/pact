/**
 * Suggested keyboard shortcut for the toolbar "quick capture" popup (the manifest's `_execute_action` command).
 *
 * Plain literals with no imports, so `wxt.config.ts` can read them too (the config can't use the `@/` alias). Chrome only
 * applies a suggestion when the keys are free, and people can rebind it at chrome://extensions/shortcuts.
 *  - Alt+Shift+N        Windows / Linux / ChromeOS  (N for note; not a Chrome built-in)
 *  - Command+Shift+Y    macOS                       (⌘⇧N is Chrome's "new incognito window")
 */
export const CAPTURE_COMMAND_KEYS = { default: 'Alt+Shift+N', mac: 'Command+Shift+Y' } as const;

/** Where people rebind extension shortcuts (Chromium browsers accept the chrome:// spelling). */
export const SHORTCUT_SETTINGS_URL = 'chrome://extensions/shortcuts';
