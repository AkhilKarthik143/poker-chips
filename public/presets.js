/* global window */
(() => {
const builtins = Object.freeze([
  { name: 'Casual', startingStack: 1000, smallBlind: 5, bigBlind: 10, blindMinutes: 0, centsPer1000Chips: 0, rebuyPolicy: { mode: 'host' } },
  { name: 'Turbo', startingStack: 500, smallBlind: 5, bigBlind: 10, blindMinutes: 10, centsPer1000Chips: 0, rebuyPolicy: { mode: 'host' } },
  { name: 'High stakes', startingStack: 5000, smallBlind: 25, bigBlind: 50, blindMinutes: 30, centsPer1000Chips: 0, rebuyPolicy: { mode: 'host' } }
]);
const settingsKeys = ['startingStack', 'smallBlind', 'bigBlind', 'blindMinutes', 'centsPer1000Chips'];
function createPayload(preset) {
  return { settings: Object.fromEntries(settingsKeys.map(key => [key, preset[key]])), rebuyPolicy: preset.rebuyPolicy };
}
window.TablematePresets = Object.freeze({ builtins, settingsKeys, createPayload });
})();
