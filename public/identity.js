/* global window */
(() => {
const reserved = ['admin', 'administrator', 'support', 'help', 'tablemate', 'host', 'dealer', 'system', 'root',
  'moderator', 'commissioner', 'league', 'staff', 'official', 'null', 'undefined', 'api', 'www'];
const blocked = ['fuck', 'shit', 'cunt', 'nigger', 'faggot'];
function usernameError(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 20 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value) || value.includes('__')) return 'invalid';
  const lower = value.toLowerCase();
  const normalized = lower.replaceAll('_', '').replace(/[013457$@]/g,
    char => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', $: 's', '@': 'a' })[char]);
  return reserved.includes(lower) || blocked.some(term => normalized.includes(term)) ? 'reserved' : null;
}
window.TablemateIdentity = Object.freeze({ usernameError, validateUsername: value => usernameError(value) === null });
})();
