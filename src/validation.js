/** Only explicitly safe validation errors may cross the socket boundary. */
import { PREF_ENUMS } from './prefs-schema.js';
import { validRebuyPolicy } from './rebuy-policy.js';
export class RequestError extends Error {}
export const requireValue = (condition, message = 'Invalid request.') => { if (!condition) throw new RequestError(message); };
export const validName = value => typeof value === 'string' && value.length <= 80 && value.normalize('NFKC').trim().length >= 1 && value.normalize('NFKC').trim().length <= 20 && !/[\p{Cc}\p{Cf}<>]/u.test(value);
export const normalizedName = value => value.normalize('NFKC').trim();
const integer = (max, min = 0) => value => Number.isSafeInteger(value) && value >= min && value <= max;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const token = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const note = value => typeof value === 'string' && value.length <= 24 && !/[\p{Cc}\p{Cf}<>]/u.test(value);
const code = value => typeof value === 'string' && /^[A-HJ-NP-Z]{8}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pushSubscription = value => {
  if (!object(value) || Object.keys(value).some(key => !['endpoint','expirationTime','keys'].includes(key))) return false;
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) return false;
  try {
    const endpoint = new URL(value.endpoint);
    const hostAllowed = endpoint.hostname === 'fcm.googleapis.com' || endpoint.hostname === 'web.push.apple.com'
      || endpoint.hostname === 'push.services.mozilla.com' || endpoint.hostname.endsWith('.push.services.mozilla.com')
      || endpoint.hostname.endsWith('.notify.windows.com');
    if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || !hostAllowed) return false;
  }
  catch { return false; }
  if (value.expirationTime !== undefined && value.expirationTime !== null && !Number.isSafeInteger(value.expirationTime)) return false;
  return object(value.keys) && Object.keys(value.keys).length === 2 && Object.hasOwn(value.keys, 'p256dh') && Object.hasOwn(value.keys, 'auth')
    && [value.keys.p256dh, value.keys.auth].every(key => typeof key === 'string' && /^[A-Za-z0-9+/_=-]{16,256}$/.test(key));
};
const settingFields = {startingStack:integer(1e9,1),smallBlind:integer(1e9,1),bigBlind:integer(1e9,1),blindMinutes:integer(1440),centsPer1000Chips:integer(10_000_000)};
const settings = value => object(value) && Object.entries(value).every(([key, n]) => Object.hasOwn(settingFields,key) && settingFields[key](n));
const ids = value => Array.isArray(value) && value.length >= 1 && value.length <= 10 && value.every(uuid);
const auth = {token,revision:integer(Number.MAX_SAFE_INTEGER)};
export const entryEvents = new Set(['create','join','table-preview','rejoin']);
const schemas = {
  create: [{name:validName},{settings,leagueId:uuid,rebuyPolicy:validRebuyPolicy}],
  join: [{name:validName,code},{expectedBuyIn:integer(1e9,1)}],
  'table-preview': [{code},{}],
  rejoin: [{code,playerId:uuid,token},{}],
  'start-hand': [auth,{}],
  action: [{...auth,type:value=>['fold','check','call','raise','all-in'].includes(value)},{amount:integer(1e12,1)}],
  'showdown-pick': [{...auth,potId:integer(9),winnerIds:ids},{}],
  'host-settings': [{...auth,settings:value=>settings(value)&&Object.keys(value).length>0},{}],
  'host:reorderSeats': [{...auth,order:ids},{}],
  'seat:cosmetics': [{token},{revision:integer(Number.MAX_SAFE_INTEGER),avatar:value=>PREF_ENUMS.avatar.includes(value),color:value=>PREF_ENUMS.seatColor.includes(value),note}],
  'host:rebuyPolicy': [{token,mode:value=>['host','auto'].includes(value)},{revision:integer(Number.MAX_SAFE_INTEGER),cap:integer(1e9,1),maxPerPlayer:integer(20)}],
  'host:endNight': [{token},{revision:integer(Number.MAX_SAFE_INTEGER)}],
  undo: [auth,{}],
  'sit-out': [{...auth,value:value=>typeof value==='boolean'},{}],
  donate: [{...auth,recipientId:uuid,amount:integer(1e12,1)},{}],
  rebuy: [{...auth,playerId:uuid,amount:integer(1e9,1)},{}],
  'rebuy:request': [{token},{revision:integer(Number.MAX_SAFE_INTEGER),amount:integer(1e9,1)}],
  'rebuy:cancel': [{token},{revision:integer(Number.MAX_SAFE_INTEGER)}],
  'rebuy:deny': [{token,playerId:uuid},{revision:integer(Number.MAX_SAFE_INTEGER)}],
  'rebuy:approve': [{...auth,playerId:uuid},{amount:integer(1e9,1)}],
  'push:subscribe': [{token,subscription:pushSubscription},{revision:integer(Number.MAX_SAFE_INTEGER)}],
  'push:unsubscribe': [{token},{revision:integer(Number.MAX_SAFE_INTEGER)}],
  presence: [{token,hidden:value=>typeof value==='boolean'},{revision:integer(Number.MAX_SAFE_INTEGER)}],
  'host-fold': [auth,{}],
  leave: [auth,{}],
  kick: [{...auth,playerId:uuid},{}]
};
export function validatePayload(event, payload) {
  requireValue(Object.hasOwn(schemas,event) && object(payload));
  const [required, optional] = schemas[event]; const fields={...required,...optional};
  requireValue(Object.keys(required).every(key=>Object.hasOwn(payload,key)));
  requireValue(Object.entries(payload).every(([key,value])=>Object.hasOwn(fields,key)&&fields[key](value)));
  if(event==='action') requireValue(payload.type==='raise' ? Object.hasOwn(payload,'amount') : !Object.hasOwn(payload,'amount'));
}
