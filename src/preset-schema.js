import * as game from './game.js';
import { validName, normalizedName } from './validation.js';
import { validRebuyPolicy, normalizeRebuyPolicy } from './rebuy-policy.js';

export const MAX_PRESETS = 10;
export const BUILTIN_PRESETS = Object.freeze([
  { name: 'Casual', startingStack: 1000, smallBlind: 5, bigBlind: 10, blindMinutes: 0, centsPer1000Chips: 0, rebuyPolicy: { mode: 'host' } },
  { name: 'Turbo', startingStack: 500, smallBlind: 5, bigBlind: 10, blindMinutes: 10, centsPer1000Chips: 0, rebuyPolicy: { mode: 'host' } },
  { name: 'High stakes', startingStack: 5000, smallBlind: 25, bigBlind: 50, blindMinutes: 30, centsPer1000Chips: 0, rebuyPolicy: { mode: 'host' } }
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
export function validPreset(preset) {
  if (!object(preset) || Object.keys(preset).length !== 7 || !keys(preset,
    ['name', 'startingStack', 'smallBlind', 'bigBlind', 'blindMinutes', 'centsPer1000Chips', 'rebuyPolicy'])
    || !validName(preset.name) || !validRebuyPolicy(preset.rebuyPolicy)) return false;
  try {
    const settings = Object.fromEntries(['startingStack', 'smallBlind', 'bigBlind', 'blindMinutes', 'centsPer1000Chips'].map(key => [key, preset[key]]));
    game.createTable(settings);
    return true;
  } catch { return false; }
}
export function normalizePreset(preset) {
  if (!validPreset(preset)) throw new Error('Invalid table preset.');
  return { ...preset, name: normalizedName(preset.name), rebuyPolicy: normalizeRebuyPolicy(preset.rebuyPolicy) };
}
