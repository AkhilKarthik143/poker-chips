/* global window, document, navigator, setInterval, clearInterval */
(() => {
const alertDefaults = { sound: true, vibration: true, keepScreenOn: true };
const alertStorageKey = 'tablemate-alerts-v1';
const vibrationSupported = typeof navigator.vibrate === 'function';
let alertStorage = null;
try { alertStorage = window.localStorage; } catch { /* Private mode may deny storage access. */ }
let alertPreferences = alertStorage ? window.Tablemate.loadPrefs(alertStorage, alertStorageKey, alertDefaults) : { ...alertDefaults };
let audioContext = null;
let unlockPill = null;
let wakeSentinel = null;
let tableActive = false;
let titleTimer = null;
let originalTitle = document.title;

function savePreferences() {
  if (alertStorage) window.Tablemate.savePrefs(alertStorage, alertStorageKey, alertPreferences);
}
function showUnlockPill() {
  if (!alertPreferences.sound || !(window.AudioContext || window.webkitAudioContext) || unlockPill) return;
  unlockPill = document.createElement('button');
  unlockPill.type = 'button'; unlockPill.className = 'sound-unlock';
  unlockPill.textContent = 'Tap to enable sound';
  unlockPill.addEventListener('click', unlock);
  document.body.appendChild(unlockPill);
}
function hideUnlockPill() { unlockPill?.remove(); unlockPill = null; }
async function unlock() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return false;
  try {
    audioContext ||= new Context();
    await audioContext.resume();
    if (audioContext.state !== 'running') { showUnlockPill(); return false; }
    const buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination); source.start();
    hideUnlockPill();
    return true;
  } catch {
    showUnlockPill();
    return false;
  }
}
function stopTitleFlash() {
  if (titleTimer !== null) clearInterval(titleTimer);
  titleTimer = null;
  document.title = originalTitle;
}
function flashTitle() {
  if (!document.hidden || titleTimer !== null) return;
  originalTitle = document.title;
  let showAlert = true;
  document.title = '🔔 Your turn';
  titleTimer = setInterval(() => { showAlert = !showAlert; document.title = showAlert ? '🔔 Your turn' : originalTitle; }, 1000);
}
function playTone(frequency, startAt, duration) {
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, startAt);
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.linearRampToValueAtTime(0.25, startAt + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(envelope); envelope.connect(audioContext.destination);
  oscillator.start(startAt); oscillator.stop(startAt + duration + 0.01);
}
function play(notes, duration, gap = 0.02) {
  if (!alertPreferences.sound) return;
  if (!audioContext || audioContext.state !== 'running') { showUnlockPill(); return; }
  const now = audioContext.currentTime;
  notes.forEach((frequency, index) => playTone(frequency, now + index * (duration + gap), duration));
}
function releaseWakeLock() {
  const current = wakeSentinel; wakeSentinel = null;
  if (current) current.release().catch(() => {});
}
async function syncWakeLock() {
  const requested = tableActive && alertPreferences.keepScreenOn && !document.hidden && navigator.wakeLock;
  if (!requested) { releaseWakeLock(); return; }
  if (wakeSentinel) return;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (!tableActive || !alertPreferences.keepScreenOn || document.hidden) { await sentinel.release(); return; }
    wakeSentinel = sentinel;
    sentinel.addEventListener('release', () => { if (wakeSentinel === sentinel) wakeSentinel = null; }, { once: true });
  } catch { /* Screen wake locks are optional and may be denied by the browser. */ }
}
function yourTurn() {
  vibrate([90, 50, 90]);
  play([660, 880], 0.12);
  flashTitle();
}
function win() { play([523, 659, 784], 0.15); }
// TODO: connect warn() to an explicit turn-timer alert if the product adds one.
function warn() { play([440, 440], 0.1, 0.06); }
function vibrate(pattern) { if (alertPreferences.vibration && vibrationSupported) navigator.vibrate(pattern); }
function tick() { vibrate(8); }
function setPreference(name, value) {
  if (!Object.hasOwn(alertDefaults, name) || typeof value !== 'boolean') return;
  alertPreferences = { ...alertPreferences, [name]: value };
  savePreferences();
  if (name === 'sound' && !value) hideUnlockPill();
  if (name === 'keepScreenOn') syncWakeLock();
}
function setTableActive(value) {
  tableActive = Boolean(value);
  if (!tableActive) { releaseWakeLock(); stopTitleFlash(); }
  else syncWakeLock();
}
function reset() { setTableActive(false); hideUnlockPill(); }

document.addEventListener('pointerdown', unlock, { once: true, capture: true });
document.addEventListener('keydown', unlock, { once: true, capture: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTitleFlash();
  else { stopTitleFlash(); if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {}); syncWakeLock(); }
});
window.addEventListener('focus', stopTitleFlash);

window.Alerts = Object.freeze({ unlock, yourTurn, win, warn, setPreference, preferences: () => ({ ...alertPreferences }),
  vibrationSupported, wakeLockSupported: Boolean(navigator.wakeLock), setTableActive, stopTitleFlash, reset, tick, test: yourTurn });
})();
