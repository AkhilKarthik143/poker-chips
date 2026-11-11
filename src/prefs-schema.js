export const PREF_ENUMS = Object.freeze({
  theme: ['felt', 'midnight', 'burgundy', 'graphite', 'daylight', 'miami-vice', 'royal-flush', 'retro-arcade', 'system'],
  soundPack: ['classic', 'soft', 'arcade'], vibrationPattern: ['off', 'short', 'double', 'long'],
  motion: ['auto', 'reduce', 'full'], contrast: ['normal', 'high'], density: ['compact', 'comfortable', 'large'],
  avatar: ['chip', 'spade', 'heart', 'diamond', 'club', 'crown', 'star', 'moon', 'sun', 'bolt', 'anchor', 'gem',
    'flame', 'wave', 'dice', 'target', 'laurel', 'shield', 'comet', 'mountain', 'arcade', 'palm', 'key', 'horseshoe'],
  seatColor: Array.from({ length: 12 }, (_, i) => `c${i + 1}`)
});
export const MAX_PREFS_BYTES = 2048;
export const DEFAULT_PREFS = Object.freeze({ theme: 'felt', sound: { on: false, pack: 'classic' },
  vibration: { on: false, yourTurn: 'double', win: 'off' }, wakeLock: true,
  motion: 'auto', contrast: 'normal', density: 'comfortable', leftHanded: false,
  defaultAvatar: 'chip', defaultSeatColor: 'c1', note: '' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
export function validatePrefs(input) {
  if (!object(input) || !keys(input, Object.keys(DEFAULT_PREFS)) || Buffer.byteLength(JSON.stringify(input)) > MAX_PREFS_BYTES) return false;
  const value = { ...DEFAULT_PREFS, ...input };
  const sound = { ...DEFAULT_PREFS.sound, ...value.sound };
  const vibration = { ...DEFAULT_PREFS.vibration, ...value.vibration };
  return object(value.sound) && keys(value.sound, ['on', 'pack']) && typeof sound.on === 'boolean' && PREF_ENUMS.soundPack.includes(sound.pack)
    && object(value.vibration) && keys(value.vibration, ['on', 'yourTurn', 'win']) && typeof vibration.on === 'boolean'
    && PREF_ENUMS.vibrationPattern.includes(vibration.yourTurn) && PREF_ENUMS.vibrationPattern.includes(vibration.win)
    && PREF_ENUMS.theme.includes(value.theme) && typeof value.wakeLock === 'boolean'
    && PREF_ENUMS.motion.includes(value.motion) && PREF_ENUMS.contrast.includes(value.contrast)
    && PREF_ENUMS.density.includes(value.density) && typeof value.leftHanded === 'boolean'
    && PREF_ENUMS.avatar.includes(value.defaultAvatar) && PREF_ENUMS.seatColor.includes(value.defaultSeatColor)
    && typeof value.note === 'string' && value.note.length <= 24 && !/[<>\p{Cc}\p{Cf}]/u.test(value.note);
}
export function normalizePrefs(input = {}) {
  if (!validatePrefs(input)) throw new Error('Invalid personal settings.');
  return { ...DEFAULT_PREFS, ...input,
    sound: { ...DEFAULT_PREFS.sound, ...input.sound },
    vibration: { ...DEFAULT_PREFS.vibration, ...input.vibration } };
}
