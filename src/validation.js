/** Only explicitly safe validation errors may cross the socket boundary. */
export class RequestError extends Error {}
export const requireValue = (condition, message = 'Invalid request.') => { if (!condition) throw new RequestError(message); };
export const validName = value => typeof value === 'string' && value.length <= 80 && value.normalize('NFKC').trim().length >= 1 && value.normalize('NFKC').trim().length <= 20 && !/[\p{Cc}\p{Cf}<>]/u.test(value);
export const normalizedName = value => value.normalize('NFKC').trim();
const integer = (max, min = 0) => value => Number.isSafeInteger(value) && value >= min && value <= max;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const token = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const code = value => typeof value === 'string' && /^[A-HJ-NP-Z]{8}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const settingFields = {startingStack:integer(1e9,1),smallBlind:integer(1e9,1),bigBlind:integer(1e9,1),blindMinutes:integer(1440)};
const settings = value => object(value) && Object.entries(value).every(([key, n]) => Object.hasOwn(settingFields,key) && settingFields[key](n));
const ids = value => Array.isArray(value) && value.length >= 1 && value.length <= 10 && value.every(uuid);
const auth = {token,revision:integer(Number.MAX_SAFE_INTEGER)};
export const entryEvents = new Set(['create','join','table-preview','rejoin']);
const schemas = {
  create: [{name:validName},{settings}],
  join: [{name:validName,code},{expectedBuyIn:integer(1e9,1)}],
  'table-preview': [{code},{}],
  rejoin: [{code,playerId:uuid,token},{}],
  'start-hand': [auth,{}],
  action: [{...auth,type:value=>['fold','check','call','raise','all-in'].includes(value)},{amount:integer(1e12,1)}],
  'showdown-pick': [{...auth,potId:integer(9),winnerIds:ids},{}],
  'host-settings': [{...auth,settings:value=>settings(value)&&Object.keys(value).length>0},{}],
  'host:reorderSeats': [{...auth,order:ids},{}],
  undo: [auth,{}],
  'sit-out': [{...auth,value:value=>typeof value==='boolean'},{}],
  rebuy: [{...auth,playerId:uuid,amount:integer(1e9,1)},{}],
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
