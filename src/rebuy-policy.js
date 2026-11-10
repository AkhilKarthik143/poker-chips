export const DEFAULT_REBUY_POLICY = Object.freeze({ mode: 'host' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validRebuyPolicy(policy) {
  if (!object(policy) || Object.keys(policy).some(key => !['mode', 'cap', 'maxPerPlayer'].includes(key))) return false;
  if (policy.mode === 'host') return Object.keys(policy).length === 1;
  return policy.mode === 'auto' && Number.isSafeInteger(policy.cap) && policy.cap >= 1 && policy.cap <= 1e9
    && (policy.maxPerPlayer === undefined || Number.isSafeInteger(policy.maxPerPlayer) && policy.maxPerPlayer >= 0 && policy.maxPerPlayer <= 20);
}
export function normalizeRebuyPolicy(policy = DEFAULT_REBUY_POLICY) {
  if (!validRebuyPolicy(policy)) throw new Error('Invalid rebuy policy.');
  return policy.mode === 'auto' ? { mode: 'auto', cap: policy.cap, maxPerPlayer: policy.maxPerPlayer ?? 3 } : { mode: 'host' };
}
