// Runs synchronously before first paint (MV3 forbids inline scripts, so this is an external classic script).
// Applies the saved theme to <html> to avoid a dark→light flash. Keep in sync with src/store/useThemeStore.ts.
(function () {
  var el = document.documentElement;
  try {
    var raw = localStorage.getItem('pact-theme');
    var mode = 'dark';
    if (raw) {
      var state = (JSON.parse(raw) || {}).state || {};
      mode = state.mode || state.theme || 'dark';
    }
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    el.classList.toggle('dark', dark);
    el.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    el.classList.add('dark');
  }
  // Appearance (style / accent / font / corner roundness / colour wallpaper), cached by src/lib/appearance/apply.ts. Applied here, before first
  // paint, so there is no flash of the default look. Keep the key in sync with BOOT_KEY.
  try {
    var boot = JSON.parse(localStorage.getItem('pact-appearance-boot') || 'null');
    if (boot) {
      var style = document.createElement('style');
      style.id = 'pact-appearance';
      style.textContent = (boot.fonts || '') + (boot.css || '');
      document.head.appendChild(style);
      if (boot.mode) el.dataset.wallpaper = boot.mode;
      // The theme style switches on its CSS layer (html[data-style='…'] in src/styles).
      // (A style that was renamed — Stoic → Ultramarine, Terminal → Dusk — keeps its place; the app then re-applies the successor's own bundle.)
      var renamed = { stoic: 'ultramarine', terminal: 'dusk' };
      if (boot.style) el.dataset.style = Object.prototype.hasOwnProperty.call(renamed, boot.style) ? renamed[boot.style] : boot.style;
      // The tab icon follows the accent too (src/lib/appearance/favicon.ts).
      if (boot.icon) {
        var link = document.querySelector('link[rel~="icon"]');
        if (link) {
          link.type = 'image/svg+xml';
          link.href = boot.icon;
        }
      }
    }
  } catch (e) {}
})();
