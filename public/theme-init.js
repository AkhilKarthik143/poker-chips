/* global globalThis, document, localStorage, matchMedia */
(() => {
const themeStorageKey = 'tablemate-theme-v1';
const availableThemes = globalThis.Tablemate.themes;
const themeColor = globalThis.Tablemate.themeColors;
let themeChoice = 'felt';
try {
  const modern = JSON.parse(localStorage.getItem('tablemate-prefs-v1') || 'null');
  const stored = availableThemes.includes(modern?.theme) ? modern.theme : globalThis.Tablemate.loadPrefs(localStorage, themeStorageKey, { theme: 'felt' }).theme;
  if (availableThemes.includes(stored)) themeChoice = stored;
} catch { themeChoice = 'felt'; }
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
document.documentElement.dataset.themePreference = themeChoice;
try {
  const saved = JSON.parse(localStorage.getItem('tablemate-prefs-v1') || 'null');
  document.documentElement.dataset.motion = ['auto', 'reduce', 'full'].includes(saved?.motion) ? saved.motion : 'auto';
  document.documentElement.dataset.contrast = ['normal', 'high'].includes(saved?.contrast) ? saved.contrast : 'normal';
  document.documentElement.dataset.density = ['compact', 'comfortable', 'large'].includes(saved?.density) ? saved.density : 'comfortable';
  document.documentElement.dataset.hand = saved?.leftHanded === true ? 'left' : 'right';
} catch { /* The defaults in CSS remain available. */ }
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
