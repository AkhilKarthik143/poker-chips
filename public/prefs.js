/* global window, document, localStorage, fetch, setTimeout, clearTimeout, matchMedia, TextEncoder */
(() => {
const enums = Object.freeze({ theme: ['felt', 'midnight', 'burgundy', 'graphite', 'daylight', 'miami-vice', 'royal-flush', 'retro-arcade', 'system'],
  soundPack: ['classic', 'soft', 'arcade'], vibrationPattern: ['off', 'short', 'double', 'long'],
  motion: ['auto', 'reduce', 'full'], contrast: ['normal', 'high'], density: ['compact', 'comfortable', 'large'],
  avatar: ['chip', 'spade', 'heart', 'diamond', 'club', 'crown', 'star', 'moon', 'sun', 'bolt', 'anchor', 'gem',
    'flame', 'wave', 'dice', 'target', 'laurel', 'shield', 'comet', 'mountain', 'arcade', 'palm', 'key', 'horseshoe'],
  seatColor: Array.from({ length: 12 }, (_, i) => `c${i + 1}`) });
const defaults = { theme: 'felt', sound: { on: false, pack: 'classic' }, vibration: { on: false, yourTurn: 'double', win: 'off' },
  wakeLock: true, motion: 'auto', contrast: 'normal', density: 'comfortable', leftHanded: false,
  defaultAvatar: 'chip', defaultSeatColor: 'c1', note: '' };
const key = 'tablemate-prefs-v1'; const maxBytes = 2048;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function valid(value) {
  if (!object(value) || Object.keys(value).some(field => !Object.hasOwn(defaults, field))) return false;
  try { if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) return false; }
  catch { return false; }
  const input = { ...defaults, ...value };
  if (!object(input.sound) || !object(input.vibration)) return false;
  const sound = { ...defaults.sound, ...input.sound };
  const vibration = { ...defaults.vibration, ...input.vibration };
  return enums.theme.includes(input.theme) && Object.keys(input.sound).every(field => ['on', 'pack'].includes(field))
    && typeof sound.on === 'boolean' && enums.soundPack.includes(sound.pack)
    && Object.keys(input.vibration).every(field => ['on', 'yourTurn', 'win'].includes(field))
    && typeof vibration.on === 'boolean' && enums.vibrationPattern.includes(vibration.yourTurn)
    && enums.vibrationPattern.includes(vibration.win) && typeof input.wakeLock === 'boolean'
    && enums.motion.includes(input.motion) && enums.contrast.includes(input.contrast) && enums.density.includes(input.density)
    && typeof input.leftHanded === 'boolean' && enums.avatar.includes(input.defaultAvatar)
    && enums.seatColor.includes(input.defaultSeatColor) && typeof input.note === 'string' && input.note.length <= 24
    && !/[<>\p{Cc}\p{Cf}]/u.test(input.note);
}
function normalized(value) { return { ...defaults, ...value, sound: { ...defaults.sound, ...value.sound }, vibration: { ...defaults.vibration, ...value.vibration } }; }
function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (valid(saved)) return normalized(saved);
    const oldTheme = JSON.parse(localStorage.getItem('tablemate-theme-v1') || 'null');
    const oldAlerts = JSON.parse(localStorage.getItem('tablemate-alerts-v1') || 'null');
    const migrated = normalized({ theme: enums.theme.includes(oldTheme?.theme) ? oldTheme.theme : 'felt',
      sound: { on: typeof oldAlerts?.sound === 'boolean' ? oldAlerts.sound : false, pack: 'classic' },
      vibration: { on: typeof oldAlerts?.vibration === 'boolean' ? oldAlerts.vibration : false, yourTurn: 'double', win: 'off' },
      wakeLock: typeof oldAlerts?.keepScreenOn === 'boolean' ? oldAlerts.keepScreenOn : true });
    localStorage.setItem(key, JSON.stringify(migrated)); return migrated;
  } catch { return normalized({}); }
}
let preferences = read(); let signedIn = false; let timer;
function apply() {
  const root = document.documentElement;
  root.dataset.themePreference = preferences.theme;
  root.dataset.theme = window.Tablemate.resolveTheme(preferences.theme, matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.motion = preferences.motion; root.dataset.contrast = preferences.contrast;
  root.dataset.density = preferences.density; root.dataset.hand = preferences.leftHanded ? 'left' : 'right';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = window.Tablemate.themeColors[root.dataset.theme];
  window.Alerts?.configure?.({ soundPack: preferences.sound.pack, yourTurnPattern: preferences.vibration.yourTurn, winPattern: preferences.vibration.win });
  window.Alerts?.setPreference('sound', preferences.sound.on);
  window.Alerts?.setPreference('vibration', preferences.vibration.on);
  window.Alerts?.setPreference('keepScreenOn', preferences.wakeLock);
}
function save() { try { localStorage.setItem(key, JSON.stringify(preferences)); return true; } catch { return false; } }
async function push() {
  if (!signedIn) return;
  try { await fetch('/api/me/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences) }); }
  catch { /* Local preferences remain available; retry on the next change. */ }
}
function update(patch) {
  const merged = { ...preferences, ...patch, sound: { ...preferences.sound, ...patch.sound }, vibration: { ...preferences.vibration, ...patch.vibration } };
  if (!valid(merged)) return false;
  preferences = normalized(merged); save(); apply();
  clearTimeout(timer); timer = setTimeout(push, 500);
  return true;
}
async function sync() {
  try {
    const config = await (await fetch('/api/config')).json();
    if (!config.accounts) return;
    const response = await fetch('/api/me/settings');
    if (!response.ok) return;
    const data = await response.json(); signedIn = true;
    if (data.settings && valid(data.settings)) { preferences = normalized(data.settings); save(); apply(); document.dispatchEvent(new Event('tablemate-prefs-loaded')); }
    else await push();
  } catch { /* Offline and guest sessions use the local cache. */ }
}
document.addEventListener('change', event => {
  const input = event.target.closest('[data-pref]');
  if (!input) return;
  const path = input.dataset.pref; const value = input.type === 'checkbox' ? input.checked : input.value;
  if (path.startsWith('sound.')) update({ sound: { [path.slice(6)]: value } });
  else if (path.startsWith('vibration.')) update({ vibration: { [path.slice(10)]: value } });
  else update({ [path]: value });
  if (path === 'sound.on' && value === true) window.Alerts?.unlock?.();
});
document.addEventListener('click', event => { if (event.target.closest('[data-pref-test]')) window.Alerts?.test(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (preferences.theme === 'system') apply(); });
window.TablematePrefs = Object.freeze({ enums, defaults, maxBytes, valid, read, get: () => structuredClone(preferences), update, apply, sync });
apply(); sync();
})();
