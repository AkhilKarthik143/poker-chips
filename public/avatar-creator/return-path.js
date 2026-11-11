/* global window, location, URL */
(() => {
function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
    /[\\\u0000-\u001f]|%2f|%5c/i.test(value)) return '/me.html';
  try {
    const parsed = new URL(value, location.origin);
    return parsed.origin === location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/me.html';
  } catch { return '/me.html'; }
}
window.TablemateCreatorPath = Object.freeze({ safeReturnPath });
})();
