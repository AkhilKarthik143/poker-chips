/* global globalThis, document, localStorage, matchMedia */
(() => {
const themeStorageKey = 'tablemate-theme-v1';
const availableThemes = ['felt', 'midnight', 'burgundy', 'graphite', 'daylight', 'system'];
const themeColor = { felt: '#fffdf5', midnight: '#0b1424', burgundy: '#201018', graphite: '#17191d', daylight: '#f4f7fb' };
let themeChoice = 'felt';
try {
  const stored = globalThis.Tablemate.loadPrefs(localStorage, themeStorageKey, { theme: 'felt' }).theme;
  if (availableThemes.includes(stored)) themeChoice = stored;
} catch { themeChoice = 'felt'; }
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
document.documentElement.dataset.themePreference = themeChoice;
function applyInitialTheme() {
  const preference = document.documentElement.dataset.themePreference;
  const resolved = globalThis.Tablemate.resolveTheme(preference, systemTheme.matches);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = themeColor[resolved];
}
applyInitialTheme();
systemTheme.addEventListener('change', () => {
  if (document.documentElement.dataset.themePreference === 'system') applyInitialTheme();
});
})();
