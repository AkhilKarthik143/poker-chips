/* global globalThis */
(() => {
const objectValue = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function moveItem(order, from, to) {
  if (!Array.isArray(order)) return [];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= order.length || to >= order.length || from === to) return [...order];
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function reconcileOrder(draft, serverOrder) {
  if (!Array.isArray(serverOrder)) return [];
  const live = new Set(serverOrder);
  const seen = new Set();
  const next = [];
  for (const id of Array.isArray(draft) ? draft : []) {
    if (live.has(id) && !seen.has(id)) { seen.add(id); next.push(id); }
  }
  for (const id of serverOrder) if (!seen.has(id)) { seen.add(id); next.push(id); }
  return next;
}

function dedupeAlert(key, seen = []) {
  const history = new Set(Array.isArray(seen) ? seen : []);
  if (history.has(key)) return { fresh: false, seen: [...history] };
  history.add(key);
  return { fresh: true, seen: [...history].slice(-100) };
}

function alertTransition(previous, current, playerId, ready, seenHands = []) {
  const seen = [...new Set(Array.isArray(seenHands) ? seenHands : [])];
  if (!current || !playerId || !ready) return { alert: null, seenHands: seen };
  if (previous && previous.roomCode === current.roomCode && current.revision < previous.revision) return { alert: null, seenHands: seen };
  if (previous && previous.turn !== playerId && current.turn === playerId) return { alert: 'yourTurn', seenHands: seen };
  const won = current.lastResult?.awards?.some(award => award.id === playerId && award.amount > 0);
  if (!previous || previous.street === 'complete' || current.street !== 'complete' || !won) return { alert: null, seenHands: seen };
  const handKey = `${current.roomCode || ''}:${current.handNumber}`;
  const deduped = dedupeAlert(handKey, seen);
  return { alert: deduped.fresh ? 'win' : null, seenHands: deduped.seen };
}

function loadPrefs(storage, key, defaults) {
  const fallback = objectValue(defaults) ? { ...defaults } : {};
  try {
    const saved = JSON.parse(storage.getItem(key));
    return objectValue(saved) ? { ...fallback, ...saved } : fallback;
  } catch { return fallback; }
}

function savePrefs(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function resolveTheme(theme, prefersDark = false) {
  const available = new Set(['felt', 'midnight', 'burgundy', 'graphite', 'daylight', 'system']);
  const selected = available.has(theme) ? theme : 'felt';
  return selected === 'system' ? (prefersDark ? 'midnight' : 'felt') : selected;
}

globalThis.Tablemate = Object.freeze({ moveItem, reconcileOrder, dedupeAlert, alertTransition, loadPrefs, savePrefs, resolveTheme });
})();
