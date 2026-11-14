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
})();
