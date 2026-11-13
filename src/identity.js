import { RESERVED_NAMES, BLOCKED_NAMES } from './reserved-names.js';
import { PREF_ENUMS } from './prefs-schema.js';
import { AVATAR_PARTS } from './avatar-parts.js';

export const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
export const AVATAR_ENUMS = Object.freeze({ shape: ['circle', 'rounded', 'hex'], icon: PREF_ENUMS.avatar,
  bg: PREF_ENUMS.seatColor, accent: PREF_ENUMS.seatColor,
  pattern: ['none', 'stripes', 'dots', 'chevrons', 'rings'], frame: ['none', 'plain', 'double'] });
export const DEFAULT_PRIVACY = Object.freeze({ profileVisibility: 'leagues', showUsernameAtTables: false, showAvatarAtTables: true });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizedOffensive = value => value.toLowerCase().replaceAll('_', '').replace(/[013457$@]/g,
  char => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', $: 's', '@': 'a' })[char]);
export function usernameError(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 20 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value) || value.includes('__')) return 'invalid';
  const lower = value.toLowerCase();
  if (RESERVED_NAMES.includes(lower) || BLOCKED_NAMES.some(term => normalizedOffensive(lower).includes(term))) return 'reserved';
  return null;
}
export const validateUsername = value => usernameError(value) === null;
const V2_KEYS = ['v', 'skin', 'hair', 'hairColor', 'eyes', 'mouth', 'facialHair', 'facialHairColor',
  'hat', 'glasses', 'outfit', 'outfitColor', 'bg', 'frame'];
export function validAvatarV2(value) {
  if (!object(value) || value.v !== 2 ||
    !Object.keys(value).every(key => V2_KEYS.includes(key) || ['brows', 'face', 'nose'].includes(key)) ||
    !V2_KEYS.every(key => Object.hasOwn(value, key))) return false;
  try { if (JSON.stringify(value).length > 600) return false; } catch { return false; }
  return Object.hasOwn(AVATAR_PARTS.skinTones, value.skin) &&
    AVATAR_PARTS.parts.hairFront.includes(value.hair) && AVATAR_PARTS.parts.hairBack.includes(value.hair) &&
    AVATAR_PARTS.parts.eyes.includes(value.eyes) && AVATAR_PARTS.parts.mouth.includes(value.mouth) &&
    (!Object.hasOwn(value, 'brows') || AVATAR_PARTS.parts.brows.includes(value.brows)) &&
    (!Object.hasOwn(value, 'face') || AVATAR_PARTS.parts.body.includes(value.face)) &&
    (!Object.hasOwn(value, 'nose') || AVATAR_PARTS.parts.nose.includes(value.nose)) &&
    AVATAR_PARTS.parts.facialHair.includes(value.facialHair) && AVATAR_PARTS.parts.hat.includes(value.hat) &&
    AVATAR_PARTS.parts.glasses.includes(value.glasses) && AVATAR_PARTS.parts.outfit.includes(value.outfit) &&
    AVATAR_PARTS.parts.frame.includes(value.frame) &&
    ['hairColor', 'facialHairColor', 'outfitColor', 'bg'].every(key => Object.hasOwn(AVATAR_PARTS.palette, value[key]));
}
export function validAvatar(value) {
  if (!object(value)) return false;
  if (Object.hasOwn(value, 'v')) return validAvatarV2(value);
  return Object.keys(value).length === 6 && Object.entries(AVATAR_ENUMS).every(([key, values]) =>
    Object.hasOwn(value, key) && values.includes(value[key]));
}
export const validPhotoAvatar = value => object(value) && value.v === 3 &&
  Object.keys(value).length === 2 && /^[0-9a-f]{32}$/.test(value.key);
export function validPrivacy(value) {
  return object(value) && Object.keys(value).length === 3 && ['private', 'leagues'].includes(value.profileVisibility)
    && typeof value.showUsernameAtTables === 'boolean' && typeof value.showAvatarAtTables === 'boolean';
}
export function defaultAvatar(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return { shape: 'circle', icon: AVATAR_ENUMS.icon[hash % AVATAR_ENUMS.icon.length],
    bg: AVATAR_ENUMS.bg[(hash >>> 8) % 12], accent: AVATAR_ENUMS.accent[(hash >>> 16) % 12],
    pattern: 'none', frame: 'plain' };
}
export function defaultAvatarV2(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const choice = values => { hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5; return values[(hash >>> 0) % values.length]; };
  const palette = Object.keys(AVATAR_PARTS.palette);
  const hairColor = choice(palette);
  return { v: 2, skin: choice(Object.keys(AVATAR_PARTS.skinTones)), hair: choice(AVATAR_PARTS.parts.hairFront),
    hairColor, eyes: choice(AVATAR_PARTS.parts.eyes), mouth: choice(AVATAR_PARTS.parts.mouth),
    facialHair: choice(AVATAR_PARTS.parts.facialHair), facialHairColor: hairColor,
    hat: choice(AVATAR_PARTS.parts.hat), glasses: choice(AVATAR_PARTS.parts.glasses),
    outfit: choice(AVATAR_PARTS.parts.outfit), outfitColor: choice(palette), bg: choice(palette),
    frame: choice(AVATAR_PARTS.parts.frame) };
}
export const avatarForAccount = account => {
  try { const value = JSON.parse(account.avatar_json || 'null'); return validAvatar(value) || validPhotoAvatar(value) ? value : defaultAvatarV2(account.id); }
  catch { return defaultAvatarV2(account.id); }
};
export const privacyForAccount = account => {
  try { const value = JSON.parse(account.profile_json || 'null'); return validPrivacy(value) ? value : { ...DEFAULT_PRIVACY }; }
  catch { return { ...DEFAULT_PRIVACY }; }
};
