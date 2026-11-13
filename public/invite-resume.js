/* global window */
(() => {
  if (window.TablemateInvites.pending()) window.location.replace(window.TablemateInvites.done());
})();
