/* global window, document, navigator, localStorage, setTimeout, clearTimeout, setInterval, ResizeObserver, matchMedia, crypto, requestAnimationFrame, cancelAnimationFrame, CSS, Event */
(() => {
const { moveItem, reconcileOrder } = window.Tablemate;
const $ = selector => document.querySelector(selector);
const socket = window.io({ autoConnect: false });
const STORAGE_KEY = 'tablemate-seat-v1';
const THEME_STORAGE_KEY = 'tablemate-theme-v1';
const THEME_CHOICES = window.Tablemate.themes;
const THEME_COLORS = window.Tablemate.themeColors;
let themePreference = document.documentElement.dataset.themePreference || 'felt';
let state = null;
let identity = null;
let mode = 'create';
let busy = false;
let ready = false;
let raiseOpen = false;
let lastTurn = null;
let toastTimer;
let serverOffset = 0;
let seatDraft = null;
let seatMessage = '';
let dragSeat = null;
let queuedDragState = null;
let alertWinHands = [];
let rebuyRequestMessage = '';
let savedPresets = [];
let canSavePresets = false;
const railMedia = matchMedia('(min-width:1200px)');
railMedia.addEventListener('change', () => render());
let observedTableWidth = 0;
const ellipseObserver = new ResizeObserver(entries => {
  const width = entries[0]?.contentRect.width;
  if (width && width !== observedTableWidth) { observedTableWidth = width; positionSeats(); }
});
const number = value => Number(value).toLocaleString();
const compactStack = value => Number(value) >= 1_000_000 ? `${(Number(value) / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : Number(value) >= 10_000 ? `${(Number(value) / 1_000).toFixed(1).replace(/\.0$/, '')}K` : number(value);
const snapToBlind = (value, blind) => Math.ceil(value / blind) * blind;
const sliderPosition = (amount, min, max) => max <= min ? 0 : Math.round((Math.log(Math.min(max, Math.max(min, amount)) / min) / Math.log(max / min)) * 100);
const sliderAmount = (position, min, max, blind) => {
  if (max <= min) return min;
  const clampedPosition = Math.min(100, Math.max(0, position));
  const amount = snapToBlind(min * Math.pow(max / min, clampedPosition / 100), blind);
  return Math.min(max, Math.max(min, amount));
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const avatarIcon = id => `<svg class="seat-avatar" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="/avatars.svg#${escape(id || 'chip')}"></use></svg>`;
const tableAvatar = (id, cosmetic, name, size = 20) => {
  const spec = state.identities?.[id]?.avatar;
  if (spec?.v === 2 && window.TablemateAvatar?.valid(spec) && window.AvatarV2) return window.AvatarV2.markup(spec, size, name);
  if (spec?.v === 3 && window.TablemateAvatar?.validPhoto(spec)) return window.TablemateAvatar.renderAvatar(spec, size, name).outerHTML;
  return spec && window.TablemateAvatar?.valid(spec) ? window.TablemateAvatar.renderAvatar(spec, Math.min(size, 24), name).outerHTML : avatarIcon(cosmetic.avatar);
};
const tableUsername = id => state.identities?.[id]?.username ? `<span class="identity-username">@${escape(state.identities[id].username)}</span>` : '';
try { identity = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { identity = null; }
function saveIdentity(value) {
  identity = value;
  try { if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); else localStorage.removeItem(STORAGE_KEY); }
  catch { toast('Browser storage is unavailable. Keep this tab open to preserve your seat.'); }
}
function rememberNight(result, name) {
  try {
    const key = 'tablemate-nights-v1';
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    const nights = Array.isArray(saved) ? saved : [];
    const entry = { nightId: result.state.nightId, token: result.token, name, at: Date.now() };
    localStorage.setItem(key, JSON.stringify([entry, ...nights.filter(item => item.nightId !== entry.nightId)].slice(0, 20)));
  } catch { /* Guest play works without storage. */ }
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}
function themePickerMarkup(scope) {
  const labels = { felt: 'Felt', midnight: 'Midnight', burgundy: 'Burgundy', graphite: 'Graphite', daylight: 'Daylight',
    'miami-vice': 'Miami Vice', 'royal-flush': 'Royal Flush', 'retro-arcade': 'Retro Arcade', system: 'System' };
  return `<section class="theme-picker-section" aria-label="Appearance"><h3>Color theme</h3><div class="theme-picker" role="radiogroup" aria-label="Color theme">${THEME_CHOICES.map(choice => `<button type="button" id="theme-${scope}-${choice}" class="theme-choice" role="radio" aria-checked="${themePreference === choice}" tabindex="${themePreference === choice ? '0' : '-1'}" data-theme-choice="${choice}">${themePreviewMarkup(choice)}<span class="theme-card-name">${labels[choice]}</span><span class="theme-check" aria-hidden="true">✓</span></button>`).join('')}</div></section>`;
}
function themePreviewMarkup(choice) {
  const themes = choice === 'system' ? ['felt', 'midnight'] : [choice];
  const preview = themes.map(theme => `<span class="theme-preview-theme" data-theme-preview="${theme}"><span class="theme-preview-table"></span><span class="theme-preview-panel"><span class="theme-preview-line"></span></span><span class="theme-preview-chip"></span></span>`).join('');
  return `<span class="theme-preview${choice === 'system' ? ' theme-preview-system' : ''}" aria-hidden="true">${preview}</span>`;
}
function applyThemePreference(choice) {
  if (!THEME_CHOICES.includes(choice)) return;
  themePreference = choice;
  window.TablematePrefs?.update({ theme: choice });
  const root = document.documentElement;
  const resolved = window.Tablemate.resolveTheme(choice, matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.themePreference = choice;
  root.dataset.theme = resolved;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[resolved];
  if (!window.Tablemate.savePrefs(localStorage, THEME_STORAGE_KEY, { theme: choice })) toast('Theme changed for this tab but could not be saved.');
  document.querySelectorAll('.theme-choice').forEach(button => {
    const selected = button.dataset.themeChoice === choice;
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}
function pushControls() {
  if (!state.push?.enabled) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !standalone) return '<section class="push-controls" aria-label="Turn notifications"><h3>Turn notifications</h3><p class="helper">On iPhone or iPad, add Tablemate to your Home Screen before enabling turn notifications.</p></section>';
  return `<section class="push-controls" aria-label="Turn notifications"><h3>Turn notifications</h3><p class="helper" role="status">${state.push.subscribed ? 'Enabled on this device.' : 'Get a notification when it is your turn and Tablemate is in the background.'}</p><button type="button" id="toggle-push">${state.push.subscribed ? 'Disable turn notifications' : 'Enable turn notifications'}</button></section>`;
}
async function togglePushNotifications() {
  if (!state.push?.enabled) return;
  if (state.push.subscribed) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    await request('push:unsubscribe');
    if (subscription) await subscription.unsubscribe();
    state.push.subscribed = false; render(); toast('Turn notifications disabled on this device.');
    return;
  }
  if (!window.isSecureContext || !navigator.serviceWorker || !('PushManager' in window) || !window.Notification) throw new Error('Turn notifications are not supported in this browser.');
  const permissionRequest = window.Notification.requestPermission();
  const registrationRequest = navigator.serviceWorker.register('/sw.js');
  const [permission, registration] = await Promise.all([permissionRequest, registrationRequest]);
  if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable turn alerts.');
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeApplicationKey(state.push.publicKey)
  });
  await request('push:subscribe', { subscription: subscription.toJSON() });
  state.push.subscribed = true; render(); toast('Turn notifications enabled on this device.');
}
function decodeApplicationKey(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(window.atob(padded), character => character.charCodeAt(0));
}
function clearTurnNotifications() {
  navigator.serviceWorker?.getRegistration('/').then(registration => registration?.getNotifications()).then(notifications => {
    notifications?.filter(item => item.tag.startsWith('tablemate-')).forEach(item => item.close());
  }).catch(() => {});
}
function reportPresence() {
  if (socket.connected && state && identity) {
    socket.emit('presence', { revision: state.revision, token: identity.token, hidden: document.hidden }, () => {});
  }
  if (!document.hidden) clearTurnNotifications();
}
function wireThemePicker(root) {
  const buttons = [...root.querySelectorAll('.theme-choice')];
  buttons.forEach(button => {
    button.addEventListener('click', () => applyThemePreference(button.dataset.themeChoice));
    button.addEventListener('keydown', event => {
      const current = THEME_CHOICES.indexOf(button.dataset.themeChoice);
      const next = { ArrowRight: current + 1, ArrowDown: current + 1, ArrowLeft: current - 1, ArrowUp: current - 1, Home: 0, End: THEME_CHOICES.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const index = (next + THEME_CHOICES.length) % THEME_CHOICES.length;
      applyThemePreference(THEME_CHOICES[index]);
      root.querySelector(`[data-theme-choice="${THEME_CHOICES[index]}"]`)?.focus();
    });
  });
}
function status(text, connected = false) {
  $('#connection').textContent = text;
  $('#connection').className = `connection ${connected ? 'online' : 'offline'}`;
  $('#entry-status').hidden = connected;
  if (!connected) $('#entry-status').textContent = `${text}. You can enter your details now; joining will be available when connected.`;
  if (state) $('#table-announcement').textContent = connected ? `Connected. ${text}.` : `${text}. Actions are paused until the table reconnects.`;
}
async function request(event, data = {}) {
  if (!socket.connected) throw new Error('Connection lost. Your seat is saved; waiting to reconnect.');
  return new Promise((resolve, reject) => socket.timeout(8000).emit(event, { ...(!['create', 'join', 'rejoin', 'table-preview'].includes(event) ? { revision: state?.revision, token: identity?.token } : {}), ...data }, (error, result) => {
    if (error) reject(Object.assign(new Error('No response yet. Reconnecting to check the latest table.'), { transient: true }));
    else if (!result.ok) reject(new Error(result.error));
    else resolve(result);
  }));
}
async function run(event, data = {}) {
  if (busy || !ready) return;
  busy = true; setButtons();
  try {
    const result = await request(event, data);
    if (result.state) receive(result.state);
  } catch (error) {
    toast(error.message);
    if (error.transient) { socket.disconnect(); socket.connect(); }
  }
  finally { busy = false; if (state) render(); else setButtons(); }
}
function setButtons() {
  $('#entry-submit').disabled = busy || !ready;
  const temporarilyDisabled = busy || !ready;
  document.querySelectorAll('#table button, #table input, #table select').forEach(el => {
    if (temporarilyDisabled && !el.disabled) { el.dataset.runtimeDisabled = 'true'; el.disabled = true; }
    else if (!temporarilyDisabled && el.dataset.runtimeDisabled) { el.disabled = false; delete el.dataset.runtimeDisabled; }
  });
  const save = $('#seat-reorder-dialog .seat-save');
  if (save && state) save.disabled = busy || !ready || JSON.stringify(seatDraft) === JSON.stringify(state.seatOrder);
}
function receive(value) {
  // Socket.IO keeps packet order; revision also guards delayed acknowledgement state.
  if (state && value.roomCode === state.roomCode && value.revision < state.revision) return;
  if (dragSeat) { queuedDragState = value; return; }
  const previousState = state;
  const previousRequestIds = new Set((previousState?.rebuyRequests || []).map(item => item.id));
  const receivedRequest = previousState && value.permissions?.manage && (value.rebuyRequests || []).some(item => item.id !== value.playerId && !previousRequestIds.has(item.id));
  const alertResult = window.Tablemate.alertTransition(previousState, value, value.playerId, ready, alertWinHands);
  alertWinHands = alertResult.seenHands;
  const previousOrder = state?.seatOrder || [];
  state = value; serverOffset = value.serverTime - Date.now();
  seatDraft = seatDraft ? reconcileOrder(seatDraft, state.seatOrder) : [...state.seatOrder];
  if (JSON.stringify(previousOrder) !== JSON.stringify(state.seatOrder) && $('#seat-reorder-dialog').open) {
    seatMessage = 'The table membership or order changed while you were arranging seats. Your draft was kept; departed players were removed and new players added at the end.';
  }
  if (alertResult.alert === 'yourTurn') window.Alerts?.yourTurn();
  if (alertResult.alert === 'win') window.Alerts?.win();
  if (receivedRequest) window.Alerts?.warn();
  if (state.turn !== state.playerId) window.Alerts?.stopTitleFlash();
  window.Alerts?.setTableActive(Boolean(ready && state));
  if (lastTurn !== state.turn) raiseOpen = false;
  lastTurn = state.turn;
  render();
  if (!previousState || previousState.turn !== state.turn || previousState.street !== state.street) {
    const actor = state.players.find(player => player.id === state.turn);
    $('#table-announcement').textContent = state.turn === state.playerId ? `Your turn. ${number(state.legal.toCall)} chips to call.` : actor ? `${actor.name} to act.` : state.street === 'complete' ? 'Hand complete.' : 'Waiting for the host.';
  }
  reportPresence();
  if ($('#rebuy-requests-dialog').open) renderRebuyRequests();
}
function reset(message) {
  state = null; lastTurn = null; raiseOpen = false; alertWinHands = []; window.Alerts?.reset(); saveIdentity(null);
  $('#table-announcement').textContent = '';
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  status(socket.connected ? 'Connected' : 'Reconnecting', socket.connected);
  document.body.classList.remove('in-game');
  $('#table').hidden = true; $('#table').replaceChildren(); $('#lobby').hidden = false; $('#site-footer').hidden = false;
  if (message) toast(message);
}
socket.on('connect', async () => {
  status('Connected', true);
  if (identity) {
    ready = false; status('Restoring your seat');
    try {
      const result = await request('rejoin', { code: identity.code, playerId: identity.playerId, token: identity.token });
      ready = true; receive(result.state); status('At the table', true);
      const invite = window.Tablemate.parseInviteCode(window.location.search);
      if (invite.status === 'valid' && invite.code !== identity.code.toUpperCase()) {
        toast(`You’re already seated at table ${identity.code}. Leave it before joining ${invite.code}; that invite is ready in the lobby.`);
      }
    } catch (error) {
      if (error.transient || !socket.connected) {
        toast(error.message); socket.disconnect(); socket.connect(); return;
      }
      reset(error.message); ready = true; status('Connected', true);
    }
  } else ready = true;
  setButtons();
});
socket.on('disconnect', () => { ready = false; window.Alerts?.setTableActive(false); status('Reconnecting'); if (state) render(); setButtons(); });
socket.on('connect_error', () => { ready = false; status('Offline · retrying'); setButtons(); });
socket.on('state', receive);
socket.on('rebuy-result', result => {
  toast(result.type === 'approved' ? `The host approved ${number(result.amount)} rebuy chips.` : 'The host denied your rebuy request.');
});
socket.on('removed', ({ message }) => { reset(message); ready = socket.connected; setButtons(); });
socket.on('session-replaced', () => {
  // Another tab shares localStorage: do not erase its valid seat token.
  ready = false; socket.disconnect();
  if (state) render();
  status('Open in another tab'); toast('Your seat is open in another tab. Continue there, or refresh to move it back.');
});

function entryMode(value) {
  mode = value;
  $('#create-tab').setAttribute('aria-selected', String(mode === 'create'));
  $('#join-tab').setAttribute('aria-selected', String(mode === 'join'));
  $('#create-tab').tabIndex = mode === 'create' ? 0 : -1;
  $('#join-tab').tabIndex = mode === 'join' ? 0 : -1;
  $('#create-fields').hidden = mode !== 'create'; $('#join-fields').hidden = mode !== 'join';
  $('#room-code').required = mode === 'join';
  $('#create-fields').querySelectorAll('input, select').forEach(el => { el.disabled = mode !== 'create'; });
  $('#entry-submit').innerHTML = `${mode === 'create' ? 'Create a table' : 'Take a seat'} <span aria-hidden="true">↗</span>`;
  $('#entry-caption').textContent = mode === 'create' ? 'You’re the host. House rules, your call.' : 'Same table code. Same good company.';
  $('#entry-error').hidden = true;
}
$('#create-tab').addEventListener('click', () => entryMode('create'));
$('#join-tab').addEventListener('click', () => entryMode('join'));
document.querySelector('.tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'create' : event.key === 'End' ? 'join' : mode === 'create' ? 'join' : 'create';
  entryMode(next);
  $(`#${next}-tab`).focus();
});
$('#room-code').addEventListener('input', () => $('#room-code').removeAttribute('aria-invalid'));
$('#entry-form').addEventListener('input', () => { $('#entry-error').hidden = true; });
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !ready) return;
  window.Alerts?.unlock();
  busy = true; setButtons();
  try {
    const data = { name: $('#name').value.trim() };
    if (mode === 'create') {
      data.settings = { startingStack: Number($('#starting-stack').value), smallBlind: Number($('#small-blind').value), bigBlind: Number($('#big-blind').value), blindMinutes: Number($('#blind-minutes').value), centsPer1000Chips: Math.round(Number($('#cash-value').value) * 100) };
      data.rebuyPolicy = policyFromForm();
      const leagueId = new URL(window.location.href).searchParams.get('league');
      if (leagueId) data.leagueId = leagueId;
    }
    else { data.code = $('#room-code').value.trim().toUpperCase(); await previewJoin(data); return; }
    const result = await request(mode, data);
    if (result.existing) { toast(`League table ${result.roomCode} is already open. Join with that code.`); return; }
    rememberNight(result, data.name);
    saveIdentity({ code: result.roomCode, playerId: result.playerId, token: result.token });
    receive(result.state); status('At the table', true);
  } catch (error) { $('#entry-error').textContent = error.message; $('#entry-error').hidden = false; toast(error.message); }
  finally { busy = false; if (state) render(); setButtons(); }
});

const sheetLocks = new WeakMap();
function openSheet(dialog, { labelledBy, focusSelector } = {}) {
  if (!dialog) return;
  if (labelledBy) dialog.setAttribute('aria-labelledby', labelledBy);
  dialog.classList.add('app-sheet');
  if (dialog.open) return dialog;
  const active = document.activeElement;
  const activeId = active?.id || '';
  const scrollY = window.scrollY;
  const body = document.body;
  const previousBodyStyle = { position: body.style.position, top: body.style.top, left: body.style.left,
    right: body.style.right, width: body.style.width, overflow: body.style.overflow };
  sheetLocks.set(dialog, { active, activeId, scrollY, previousBodyStyle });
  body.classList.add('sheet-open');
  body.style.position = 'fixed'; body.style.top = `${-scrollY}px`; body.style.left = '0';
  body.style.right = '0'; body.style.width = '100%'; body.style.overflow = 'hidden';
  const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.getClientRects().length > 0 && !el.closest('[hidden]'));
  const trapFocus = event => {
    if (event.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) { event.preventDefault(); dialog.focus(); return; }
    const first = items[0]; const last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  };
  dialog.addEventListener('keydown', trapFocus);
  dialog.addEventListener('close', () => {
    dialog.removeEventListener('keydown', trapFocus);
    const lock = sheetLocks.get(dialog); sheetLocks.delete(dialog);
    if (!lock) return;
    body.classList.remove('sheet-open');
    Object.assign(body.style, lock.previousBodyStyle);
    window.scrollTo(0, lock.scrollY);
    const restore = lock.activeId ? document.getElementById(lock.activeId) : lock.active;
    if (restore?.isConnected) restore.focus({ preventScroll: true });
  }, { once: true });
  dialog.showModal();
  const initial = focusSelector ? dialog.querySelector(focusSelector) : null;
  (initial || focusable()[0] || dialog).focus({ preventScroll: true });
  return dialog;
}
function showDialog(title, content, onConfirm, confirmLabel = 'Confirm') {
  const dialog = $('#seat-dialog');
  dialog.innerHTML = `<form id="dialog-form"><h2 id="dialog-title">${escape(title)}</h2>${content}<p id="dialog-error" role="alert"></p><div class="dialog-actions"><button type="button" id="dialog-close">Cancel</button><button type="submit" class="primary">${confirmLabel}</button></div></form>`;
  $('#dialog-close').onclick = () => dialog.close();
  $('#dialog-form').onsubmit = async event => {
    event.preventDefault(); window.Alerts?.unlock(); const button = event.submitter; button.disabled = true;
    try { await onConfirm(); dialog.close(); } catch (error) { $('#dialog-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  openSheet(dialog, { labelledBy: 'dialog-title' });
}
async function previewJoin(data) {
  const info = await request('table-preview', { code: data.code });
  showDialog(`Join table ${data.code}`, `<p>${info.players}/10 players · Blinds ${number(info.smallBlind)}/${number(info.bigBlind)}</p><label for="join-buy-in">Buy-in · virtual chips</label><input id="join-buy-in" value="${info.startingStack}" readonly><p class="helper">The host sets the buy-in for every new player. Confirm to take the next open seat.</p>`, async () => {
    const result = await request('join', { ...data, expectedBuyIn: info.startingStack });
    rememberNight(result, data.name);
    saveIdentity({ code: result.roomCode, playerId: result.playerId, token: result.token }); receive(result.state); status('At the table', true);
  }, 'Confirm & join');
}
function inviteDialog() {
  const host = state.permissions?.manage;
  const inviteUrl = window.Tablemate.roomInviteUrl(window.location.origin, state.roomCode);
  if (!inviteUrl) return toast('Could not create an invite link for this room.');
  showDialog(`Invite to table ${state.roomCode}`, `<section class="room-invite" aria-label="Invite friends">
    <p class="room-invite-kicker">Invite friends</p>
    <p class="room-invite-intro">Scan the QR code or share the room code to join this table.</p>
    <div class="room-invite-content">
      <figure class="invite-qr-card">
        <img id="invite-qr" width="280" height="280" alt="QR code that opens the invite for room ${escape(state.roomCode)}">
        <figcaption>Scan to open this room invite</figcaption>
        <p id="invite-qr-error" class="helper" hidden>QR could not be generated. Copy the invite link instead.</p>
      </figure>
      <div class="invite-share-fields">
        <div class="invite-code-panel">
          <label for="invite-room-code">Room code</label>
          <div class="invite-copy-row invite-code-row">
            <input id="invite-room-code" value="${escape(state.roomCode)}" readonly>
            <button type="button" id="copy-invite-code" class="primary" aria-live="polite">Copy room code</button>
          </div>
        </div>
        <div class="invite-link-panel">
          <label for="invite-link-value">Invite link</label>
          <input id="invite-link-value" value="${escape(inviteUrl)}" readonly>
          <div class="invite-share-actions">
            <button type="button" id="copy-invite-link" class="quiet" aria-live="polite">Copy invite link</button>
            ${typeof navigator.share === 'function' ? '<button type="button" id="share-invite" class="quiet">Share invite</button>' : ''}
          </div>
        </div>
      </div>
    </div>
  </section>
  ${state.signedIn ? `<a class="invite-friends-link" href="/friends.html?code=${escape(state.roomCode)}">Find a friend to share this link with</a>` : ''}
  <label for="invite-buy-in">Buy-in · virtual chips</label>
  <input id="invite-buy-in" type="number" min="1" max="1000000000" value="${state.settings.startingStack}" ${host ? '' : 'readonly'}>
  <p class="helper">${host ? 'Before the first hand, changing the buy-in updates every seated player. Later, it applies to new players only.' : 'The host sets the buy-in. Friends enter the code using Join a table.'}</p>`, async () => {
    if (host && Number($('#invite-buy-in').value) !== state.settings.startingStack) {
      const result = await request('host-settings', { settings: { startingStack: Number($('#invite-buy-in').value) } }); receive(result.state);
    }
  }, host ? 'Save buy-in' : 'Done');
  const qr = $('#invite-qr');
  try {
    const code = window.qrcode(0, 'H');
    code.addData(inviteUrl);
    code.make();
    qr.src = code.createDataURL(8, 4);
  } catch {
    qr.hidden = true;
    $('#invite-qr-error').hidden = false;
  }
  $('#copy-invite-link').addEventListener('click', event => copyInviteText(inviteUrl, $('#invite-link-value'), 'Invite link copied.', event.currentTarget, 'Link copied ✓'));
  $('#copy-invite-code').addEventListener('click', event => copyInviteText(state.roomCode, $('#invite-room-code'), 'Room code copied.', event.currentTarget, 'Code copied ✓'));
  $('#share-invite')?.addEventListener('click', async event => {
    try {
      await navigator.share({ title: 'Join my Tablemate poker table', text: `Join room ${state.roomCode} on Tablemate`, url: inviteUrl });
      toast('Invite shared.');
    } catch (error) {
      if (error.name !== 'AbortError') await copyInviteText(inviteUrl, $('#invite-link-value'), 'Invite link copied.', event.currentTarget, 'Link copied ✓');
    }
  });
}
async function copyInviteText(value, fallbackField, successMessage, trigger, copiedLabel) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      showCopyFeedback(trigger, copiedLabel);
      toast(successMessage);
      return;
    }
  } catch { /* Use the selected visible value as a fallback on older or restricted browsers. */ }
  fallbackField.focus(); fallbackField.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* Clipboard fallback is unavailable. */ }
  if (copied) { trigger.focus({ preventScroll: true }); showCopyFeedback(trigger, copiedLabel); toast(successMessage); }
  else toast('Copy is unavailable here. The selected text is ready to copy manually.');
}
function showCopyFeedback(trigger, copiedLabel) {
  if (!trigger || !copiedLabel) return;
  clearTimeout(trigger.copyFeedbackTimer);
  trigger.dataset.copyDefaultLabel ||= trigger.textContent;
  trigger.textContent = copiedLabel;
  trigger.copyFeedbackTimer = setTimeout(() => {
    if (trigger.isConnected) trigger.textContent = trigger.dataset.copyDefaultLabel;
  }, 1800);
}
function applyInviteCodeFromQuery() {
  const invite = window.Tablemate.parseInviteCode(window.location.search);
  if (invite.status === 'missing') return;
  entryMode('join');
  const input = $('#room-code');
  if (invite.status === 'valid') input.value = invite.code;
  else {
    input.value = '';
    input.setAttribute('aria-invalid', 'true');
    const message = 'This invite link has an invalid room code. Enter a valid 8-letter code to join.';
    $('#entry-error').textContent = message; $('#entry-error').hidden = false;
    toast(message);
  }
}
function donationDialog() {
  const me = state.players.find(p => p.id === state.playerId);
  const recipients = state.players.filter(p => p.id !== me.id);
  if (!['lobby', 'complete'].includes(state.street)) return toast('Donate chips between hands.');
  if (!recipients.length || me.stack < 1) return toast('You need chips and another player to donate.');
  showDialog('Donate virtual chips', `<p>Transfer chips from your stack to another player. Your stack: <strong>${number(me.stack)}</strong>.</p><label for="donation-player">Recipient</label><select id="donation-player">${recipients.map(option).join('')}</select><label for="donation-amount">Chips to donate</label><input id="donation-amount" type="number" min="1" max="${me.stack}" step="1" value="${Math.min(state.settings.smallBlind, me.stack)}" required><p class="helper">Available between hands. This transfer cannot be undone.</p>`, async () => {
    const result = await request('donate', { recipientId: $('#donation-player').value, amount: Number($('#donation-amount').value) });
    receive(result.state); toast('Chips donated.');
  }, 'Confirm donation');
}
function openControls(targetId) {
  const panel = document.getElementById(targetId || (state.permissions?.manage ? 'host-menu' : 'your-seat'));
  const sidebar = document.querySelector('#table .sidebar');
  $('#table-rail').open = true;
  panel.open = true;
  const heading = panel.querySelector('summary');
  const reveal = target => {
    const bounds = sidebar.getBoundingClientRect(); const targetBounds = target.getBoundingClientRect();
    if (targetBounds.top < bounds.top) sidebar.scrollTop -= bounds.top - targetBounds.top;
    else if (targetBounds.bottom > bounds.bottom) sidebar.scrollTop += targetBounds.bottom - bounds.bottom;
  };
  reveal(panel); reveal(heading);
  heading.focus({ preventScroll: true });
}
function openSeatReorder() {
  const dialog = $('#seat-reorder-dialog');
  seatDraft = [...state.seatOrder];
  seatMessage = '';
  renderSeatReorder(true);
  openSheet(dialog, { labelledBy: 'seat-reorder-title' });
}
function handLog() {
  if (!state.log.length) return '<li>No actions yet. Start a hand to see the log.</li>';
  let previous = null;
  return state.log.slice().reverse().map(item => {
    const group = item.hand !== previous ? `<li class="log-group">${item.hand ? `Hand ${item.hand}` : 'Lobby'}</li>` : ''; previous = item.hand;
    const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Earlier';
    return `${group}<li><small>${escape(time)} · ${escape(item.street.toUpperCase())}</small>${escape(item.text)}</li>`;
  }).join('');
}

const instructions = {
  lobby: 'Share the table code. When everyone is seated, deal your physical cards and start the hand.',
  preflop: 'Deal two physical hole cards to each player. Keep them to yourself.',
  flop: 'Reveal three community cards on the real table.',
  turn: 'Reveal the fourth community card on the real table.',
  river: 'Reveal the fifth and final community card.',
  showdown: 'Reveal any remaining community cards, then your hole cards. The host or co-host selects winners below.',
  complete: 'Chips settled. Collect the cards and get ready for the next hand.'
};
function option(p) { return `<option value="${escape(p.id)}">${escape(p.name)} · ${number(p.stack)}</option>`; }
function alertControls() {
  return personalControls('seat');
}
function personalControls(scope) {
  const prefs = window.TablematePrefs?.get();
  if (!prefs) return '';
  const check = (path, label, value) => `<label class="preference-toggle"><input type="checkbox" data-pref="${path}" ${value ? 'checked' : ''}><span>${label}</span></label>`;
  const select = (path, label, value, choices) => `<label class="personal-field">${label}<select data-pref="${path}">${choices.map(([id, text]) => `<option value="${id}" ${value === id ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  return `<details class="personal-settings" id="personal-${scope}"><summary>Personal settings</summary><div class="personal-settings-body"><p class="helper">Your preferences stay on this device in guest mode and sync when you sign in.</p><h4>Sound</h4>${check('sound.on', 'Turn and win sounds', prefs.sound.on)}${select('sound.pack', 'Sound pack', prefs.sound.pack, [['classic','Classic'],['soft','Soft'],['arcade','Arcade']])}<h4>Vibration</h4>${check('vibration.on', 'Vibrate for events', prefs.vibration.on)}${select('vibration.yourTurn','Your turn',prefs.vibration.yourTurn,[['off','Off'],['short','Short'],['double','Double tap'],['long','Long']])}${select('vibration.win','Win',prefs.vibration.win,[['off','Off'],['short','Short'],['double','Double tap'],['long','Long']])}<button type="button" data-pref-test>Test sound and vibration</button><h4>Display</h4>${select('motion','Motion',prefs.motion,[['auto','System'],['reduce','Reduced'],['full','Full']])}${select('contrast','Contrast',prefs.contrast,[['normal','Normal'],['high','High']])}${select('density','Layout',prefs.density,[['compact','Compact'],['comfortable','Comfortable'],['large','Large text']])}${check('leftHanded','Left-handed controls',prefs.leftHanded)}${check('wakeLock','Keep screen on at the table',prefs.wakeLock)}<h4>Seat defaults</h4>${select('defaultAvatar','Avatar',prefs.defaultAvatar,window.TablematePrefs.enums.avatar.map(id=>[id,id[0].toUpperCase()+id.slice(1)]))}${select('defaultSeatColor','Color',prefs.defaultSeatColor,window.TablematePrefs.enums.seatColor.map((id,i)=>[id,`Color ${i+1}`]))}<label class="personal-field">Nickname or pronunciation<input data-pref="note" maxlength="24" value="${escape(prefs.note)}" autocomplete="off"></label></div></details>`;
}
function openCosmetics() {
  const dialog = $('#cosmetics-dialog');
  const current = state.cosmetics?.[state.playerId] || { avatar: 'chip', color: 'c1', note: '' };
  const avatarNames = window.TablematePrefs.enums.avatar;
  const colorNames = window.TablematePrefs.enums.seatColor;
  dialog.innerHTML = `<div class="cosmetics-picker"><h2 id="cosmetics-title">Your seat style</h2><p class="helper">Your avatar, color and note are visible to everyone at this table.</p><h4>Avatar</h4><div class="avatar-grid" role="radiogroup" aria-label="Seat avatar">${avatarNames.map(id => `<button type="button" role="radio" aria-label="${id}" aria-checked="${current.avatar === id}" data-avatar-choice="${id}">${avatarIcon(id)}</button>`).join('')}</div><h4>Seat color</h4><div class="color-grid" role="radiogroup" aria-label="Seat color">${colorNames.map((id, index) => `<button type="button" class="seat-color-${id}" role="radio" aria-label="Color ${index + 1}" aria-checked="${current.color === id}" data-color-choice="${id}"></button>`).join('')}</div><form id="cosmetics-note-form"><label for="cosmetics-note">Nickname or pronunciation · 24 characters max</label><input id="cosmetics-note" maxlength="24" value="${escape(current.note)}" autocomplete="off"><button type="submit">Save note</button></form><p id="cosmetics-error" role="alert"></p><button type="button" id="cosmetics-close">Done</button></div>`;
  const update = async patch => {
    try {
      const result = await request('seat:cosmetics', patch);
      receive(result.state);
      dialog.querySelectorAll('[data-avatar-choice]').forEach(button => button.setAttribute('aria-checked', String(button.dataset.avatarChoice === result.state.cosmetics[result.state.playerId].avatar)));
      dialog.querySelectorAll('[data-color-choice]').forEach(button => button.setAttribute('aria-checked', String(button.dataset.colorChoice === result.state.cosmetics[result.state.playerId].color)));
      $('#cosmetics-error').textContent = '';
    } catch (error) { $('#cosmetics-error').textContent = error.message; }
  };
  dialog.onclick = event => {
    const avatar = event.target.closest('[data-avatar-choice]');
    const color = event.target.closest('[data-color-choice]');
    if (avatar) update({ avatar: avatar.dataset.avatarChoice });
    if (color) update({ color: color.dataset.colorChoice });
  };
  dialog.onkeydown = event => {
    const selected = event.target.closest('[role="radio"]');
    if (!selected || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const siblings = [...selected.parentElement.querySelectorAll('[role="radio"]')];
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
    siblings[(siblings.indexOf(selected) + direction + siblings.length) % siblings.length].focus();
  };
  dialog.querySelector('#cosmetics-note-form').onsubmit = event => { event.preventDefault(); update({ note: $('#cosmetics-note').value.trim() }); };
  dialog.querySelector('#cosmetics-close').onclick = () => dialog.close();
  openSheet(dialog, { labelledBy: 'cosmetics-title' });
}
function policyFromForm() {
  return $('#rebuy-policy-mode').value === 'auto'
    ? { mode: 'auto', cap: Number($('#rebuy-policy-cap').value), maxPerPlayer: Number($('#rebuy-policy-limit').value) }
    : { mode: 'host' };
}
function presetFromForm(name) {
  return { name, startingStack: Number($('#starting-stack').value), smallBlind: Number($('#small-blind').value),
    bigBlind: Number($('#big-blind').value), blindMinutes: Number($('#blind-minutes').value),
    centsPer1000Chips: Math.round(Number($('#cash-value').value) * 100), rebuyPolicy: policyFromForm() };
}
function renderPresetChips() {
  const all = [...window.TablematePresets.builtins.map((preset, index) => ({ ...preset, id: `builtin-${index}` })), ...savedPresets];
  $('#preset-chips').innerHTML = all.map(preset => `<button type="button" data-preset-id="${escape(preset.id)}" aria-pressed="false">${escape(preset.name)}</button>`).join('');
  $('#preset-account-actions').hidden = !canSavePresets;
}
function applyPreset(preset) {
  for (const [id, value] of [['starting-stack', preset.startingStack], ['small-blind', preset.smallBlind], ['big-blind', preset.bigBlind],
    ['blind-minutes', preset.blindMinutes], ['cash-value', (preset.centsPer1000Chips / 100).toFixed(2)]]) $(`#${id}`).value = value;
  $('#rebuy-policy-mode').value = preset.rebuyPolicy.mode;
  $('#rebuy-policy-cap').value = preset.rebuyPolicy.cap ?? preset.startingStack;
  $('#rebuy-policy-limit').value = preset.rebuyPolicy.maxPerPlayer ?? 3;
  $('#rebuy-policy-auto').hidden = preset.rebuyPolicy.mode !== 'auto';
  document.querySelectorAll('[data-preset-id]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.presetId === preset.id)));
}
async function presetApi(method, path, body) {
  const response = await fetch(`/api/me/presets${path}`, { method, headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not save the preset.');
  return response.json();
}
async function loadPresets() {
  try { savedPresets = (await presetApi('GET', '')).presets; renderPresetChips(); }
  catch (error) { toast(error.message); }
}
function openPresets(kind) {
  const dialog = $('#presets-dialog');
  const rows = savedPresets.map((preset, index) => `<li data-preset-row="${escape(preset.id)}"><strong>${escape(preset.name)}</strong><button type="button" data-preset-action="up" ${index ? '' : 'disabled'}>↑</button><button type="button" data-preset-action="down" ${index < savedPresets.length - 1 ? '' : 'disabled'}>↓</button><button type="button" data-preset-action="rename">Rename</button><button type="button" data-preset-action="delete" class="danger">Delete</button></li>`).join('');
  dialog.innerHTML = `<div class="preset-manager"><h2 id="presets-title">${kind === 'save' ? 'Save a table preset' : 'Manage presets'}</h2>${kind === 'save' ? '<form id="preset-save-form"><label for="preset-name">Preset name</label><input id="preset-name" maxlength="20" required><button type="submit">Save preset</button></form>' : `<ol>${rows || '<li>No saved presets yet.</li>'}</ol>`}<p id="presets-error" role="alert"></p><button type="button" id="presets-close">Done</button></div>`;
  dialog.querySelector('#presets-close').onclick = () => dialog.close();
  dialog.querySelector('#preset-save-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await presetApi('POST', '', presetFromForm($('#preset-name').value.trim())); await loadPresets(); dialog.close(); toast('Preset saved.'); }
    catch (error) { $('#presets-error').textContent = error.message; }
  });
  dialog.onclick = async event => {
    const button = event.target.closest('[data-preset-action]');
    if (!button) return;
    const id = button.closest('[data-preset-row]').dataset.presetRow;
    const index = savedPresets.findIndex(preset => preset.id === id);
    const preset = savedPresets[index];
    try {
      if (button.dataset.presetAction === 'delete') await presetApi('DELETE', `/${id}`);
      else if (button.dataset.presetAction === 'rename') {
        const name = window.prompt('New preset name', preset.name);
        if (name === null) return;
        await presetApi('PATCH', `/${id}`, { preset: { ...preset, name: name.trim(), id: undefined, position: undefined, createdAt: undefined } });
      } else {
        const other = savedPresets[index + (button.dataset.presetAction === 'up' ? -1 : 1)];
        if (!other) return;
        await presetApi('PATCH', `/${id}`, { position: other.position });
        await presetApi('PATCH', `/${other.id}`, { position: preset.position });
      }
      await loadPresets(); dialog.close(); openPresets('manage');
    } catch (error) { $('#presets-error').textContent = error.message; }
  };
  openSheet(dialog, { labelledBy: 'presets-title' });
}
function rebuyRequestControls() {
  const pending = (state.rebuyRequests || []).find(item => item.id === state.playerId);
  if (pending) return `<section class="rebuy-request-controls"><h3>Rebuy request</h3><p role="status">Pending · ${number(pending.amount)} chips</p><button type="button" id="cancel-rebuy-request">Cancel request</button></section>`;
  return `<form id="rebuy-request-form" class="rebuy-request-controls"><h3>Request rebuy</h3><label for="rebuy-request-amount">Amount · virtual chips</label><div class="amount-stepper"><button type="button" data-rebuy-step="-1" aria-label="Decrease rebuy amount">−</button><input id="rebuy-request-amount" type="number" inputmode="numeric" min="1" max="1000000000" step="1" value="${state.settings.startingStack}" required><button type="button" data-rebuy-step="1" aria-label="Increase rebuy amount">+</button></div><p class="helper">${state.rebuyPolicy?.mode === 'auto' ? `Requests up to ${number(state.rebuyPolicy.cap)} chips auto-approve between hands, up to ${state.rebuyPolicy.maxPerPlayer} times per player. The host reviews other requests.` : 'The host approves requests between hands.'}</p><button type="submit">Send rebuy request</button></form>`;
}
function tonightText(summary) {
  const totals = summary.rebuyTotals || summary.rows.reduce((result, row) => ({
    initialBuyIn: result.initialBuyIn + (row.initialBuyIn || 0),
    rebuyCount: result.rebuyCount + (row.rebuyCount || 0),
    totalRebuyChips: result.totalRebuyChips + (row.totalRebuyChips || 0),
    totalPurchased: result.totalPurchased + (row.totalBuyIn ?? row.buyIn ?? 0)
  }), { initialBuyIn: 0, rebuyCount: 0, totalRebuyChips: 0, totalPurchased: 0 });
  const players = summary.rows.map(row => {
    const handsDealt = row.handsDealt ?? row.handsPlayed;
    return `${row.name}: initial buy-in ${number(row.initialBuyIn || 0)}, ${row.rebuyCount || 0} rebuys (${number(row.totalRebuyChips || 0)} chips), total in ${number(row.totalBuyIn ?? row.buyIn)} chips${row.totalBuyInMoney || row.buyInMoney ? ` (${row.totalBuyInMoney || row.buyInMoney})` : ''}, stack/cash-out ${number(row.cashOut)} chips${row.cashOutMoney ? ` (${row.cashOutMoney})` : ''}, net ${row.net > 0 ? '+' : ''}${number(row.net)} chips${row.netMoney ? ` (${row.netMoney})` : ''}; won ${row.handsWon} of ${row.handsPlayed} played hands; dealt ${handsDealt} total.`;
  });
  const transfers = summary.transfers.map(item => `${item.fromName} pays ${item.toName} ${number(item.chips)} chips${item.money ? ` · ${item.money}` : ''}.`);
  return [`Tonight · Table ${state.roomCode}`, ...players,
    `Completed rebuys: ${totals.rebuyCount} · Rebuy chips: ${number(totals.totalRebuyChips)} · Total chips purchased: ${number(totals.totalPurchased)}${totals.totalPurchasedMoney ? ` (${totals.totalPurchasedMoney})` : ''}`,
    'Who pays whom:', ...(transfers.length ? transfers : ['No transfers needed.']), 'Informal tally for friends. This app doesn’t handle money.'].join('\n');
}
function rebuyTrackerMarkup(summary) {
  const totals = summary.rebuyTotals || { initialBuyIn: 0, rebuyCount: 0, totalRebuyChips: 0, totalPurchased: 0 };
  const stats = [
    ['Initial buy-ins', number(totals.initialBuyIn), 'chips', totals.initialBuyInMoney],
    ['Completed rebuys', number(totals.rebuyCount), 'rebuys', ''],
    ['Rebuy chips', number(totals.totalRebuyChips), 'chips', totals.totalRebuyChipsMoney],
    ['Total chips purchased', number(totals.totalPurchased), 'chips', totals.totalPurchasedMoney]
  ].map(([label, value, unit, moneyValue]) => `<article class="rebuy-stat"><span>${label}</span><strong>${value} <small>${unit}</small></strong>${moneyValue ? `<small>${escape(moneyValue)}</small>` : ''}</article>`).join('');
  const rows = summary.rows.map((row, index) => {
    const historyId = `rebuy-history-${index}`;
    const transactions = (row.rebuyHistory || []).map((transaction, transactionIndex) => {
      const hand = transaction.handNumber > 0 ? `After hand ${transaction.handNumber}` : 'Before hand 1';
      const source = transaction.source === 'request' ? 'Request approved' : 'Added by host';
      const timestamp = Number.isSafeInteger(transaction.timestamp) ? new Date(transaction.timestamp).toLocaleString() : '';
      const sessionName = transaction.name && transaction.name !== row.name ? `${escape(transaction.name)} · ` : '';
      return `<li><span><strong>Rebuy #${transactionIndex + 1}</strong> · +${number(transaction.amount)} chips</span><small>${sessionName}${hand} · ${source}${timestamp ? ` · ${escape(timestamp)}` : ''}</small></li>`;
    }).join('');
    const netSign = row.net > 0 ? '+' : row.net < 0 ? '−' : '';
    const expandedHistory = `<tr class="rebuy-history-row" hidden><td colspan="7"><section id="${historyId}" class="rebuy-history" aria-label="${escape(row.name)} rebuy history"><h4>${escape(row.name)} — Rebuy history</h4><ul><li><span>Initial buy-in total</span><strong>${number(row.initialBuyIn)} chips${row.initialBuyInMoney ? ` · ${escape(row.initialBuyInMoney)}` : ''}</strong></li>${transactions || '<li><span>No completed rebuys</span></li>'}<li><span>Total invested</span><strong>${number(row.totalBuyIn ?? row.buyIn)} chips${row.totalBuyInMoney || row.buyInMoney ? ` · ${escape(row.totalBuyInMoney || row.buyInMoney)}` : ''}</strong></li></ul></section></td></tr>`;
    return `<tr class="rebuy-data-row"><th scope="row"><button type="button" class="rebuy-player-toggle" aria-expanded="false" aria-controls="${historyId}" data-rebuy-history="${index}">${escape(row.name)}<span aria-hidden="true">⌄</span></button></th><td><span class="rebuy-cell-label">Initial</span><strong>${number(row.initialBuyIn)} chips</strong>${row.initialBuyInMoney ? `<small>${escape(row.initialBuyInMoney)}</small>` : ''}</td><td><span class="rebuy-cell-label">Rebuys</span><strong>${number(row.rebuyCount)}</strong></td><td><span class="rebuy-cell-label">Rebuy chips</span><strong>${number(row.totalRebuyChips)} chips</strong>${row.totalRebuyChipsMoney ? `<small>${escape(row.totalRebuyChipsMoney)}</small>` : ''}</td><td><span class="rebuy-cell-label">Total in</span><strong>${number(row.totalBuyIn ?? row.buyIn)} chips</strong>${row.totalBuyInMoney || row.buyInMoney ? `<small>${escape(row.totalBuyInMoney || row.buyInMoney)}</small>` : ''}</td><td><span class="rebuy-cell-label">Stack / cash-out</span><strong>${number(row.cashOut)} chips</strong>${row.cashOutMoney ? `<small>${escape(row.cashOutMoney)}</small>` : ''}</td><td class="settlement-net ${row.net > 0 ? 'positive' : row.net < 0 ? 'negative' : 'even'}"><span class="rebuy-cell-label">Net</span><strong>${netSign}${number(Math.abs(row.net))} chips</strong>${row.netMoney ? `<small>${escape(row.netMoney)}</small>` : ''}</td></tr>${expandedHistory}`;
  }).join('');
  return `<section class="rebuy-tracker" aria-labelledby="rebuy-tracker-title"><header class="rebuy-tracker-heading"><h3 id="rebuy-tracker-title">Rebuy tracker</h3><span>Completed rebuys only</span></header><div class="rebuy-stats" aria-label="Table rebuy totals">${stats}</div><div class="rebuy-table-scroll"><table class="rebuy-table"><thead><tr><th scope="col">Player</th><th scope="col">Initial</th><th scope="col">Rebuys</th><th scope="col">Rebuy chips</th><th scope="col">Total in</th><th scope="col">Stack / cash-out</th><th scope="col">Net</th></tr></thead><tbody>${rows || '<tr><td class="empty-ledger" colspan="7">No player totals yet.</td></tr>'}</tbody></table></div></section>`;
}
function openTonight() {
  const dialog = $('#tonight-dialog');
  const summary = state.settlement || { rows: [], transfers: [], centsPer1000Chips: 0 };
  const rows = summary.rows.map(row => {
    const sign = row.net > 0 ? '+' : row.net < 0 ? '−' : '';
    const icon = row.net > 0 ? '↑' : row.net < 0 ? '↓' : '→';
    return `<article class="settlement-row" role="row"><strong role="cell">${escape(row.name)}</strong><span role="cell"><small>Buy-in total</small>${number(row.buyIn)} chips${row.buyInMoney ? `<small>${escape(row.buyInMoney)}</small>` : ''}</span><span role="cell"><small>Stack / cash-out</small>${number(row.cashOut)} chips${row.cashOutMoney ? `<small>${escape(row.cashOutMoney)}</small>` : ''}</span><span role="cell" class="settlement-net ${row.net > 0 ? 'positive' : row.net < 0 ? 'negative' : 'even'}"><small>Net</small><b aria-label="${row.net > 0 ? 'Up' : row.net < 0 ? 'Down' : 'Even'}">${icon} ${sign}${number(Math.abs(row.net))} chips</b>${row.netMoney ? `<small>${escape(row.netMoney)}</small>` : ''}</span><span role="cell"><small>Won / played / dealt</small>${row.handsWon} / ${row.handsPlayed} / ${row.handsDealt ?? row.handsPlayed}</span></article>`;
  }).join('');
  const transfers = summary.transfers.map(item => `<li>${escape(item.fromName)} pays ${escape(item.toName)} <strong>${number(item.chips)} chips</strong>${item.money ? ` · ${escape(item.money)}` : ''}</li>`).join('');
  dialog.innerHTML = `<section class="tonight-sheet"><header class="tonight-header"><div><p class="eyebrow">TABLE LEDGER</p><h2 id="tonight-title">Tonight</h2></div><button type="button" class="seat-sheet-close" data-close-tonight aria-label="Close Tonight sheet">×</button></header><p class="helper tonight-note">${escape(state.settlementNote || 'Current table totals.')}</p><p class="helper">Played = stayed past preflop. Dealt includes hands folded preflop.</p>${summary.centsPer1000Chips ? `<p class="cash-rate">Cash value per 1,000 chips: $${(summary.centsPer1000Chips / 100).toFixed(2)}</p>` : ''}${rebuyTrackerMarkup(summary)}<div class="settlement-table" role="table" aria-label="Tonight chip ledger"><div class="settlement-head" role="row"><span role="columnheader">Name</span><span role="columnheader">Buy-in total</span><span role="columnheader">Stack / cash-out</span><span role="columnheader">Net</span><span role="columnheader">Won / played / dealt</span></div>${rows || '<p class="empty-ledger">No player totals yet.</p>'}</div><section class="settlement-transfers"><h3>Who pays whom</h3><ul>${transfers || '<li>No transfers needed.</li>'}</ul></section><p class="informal-note">Informal tally for friends. This app doesn’t handle money.</p><textarea id="tonight-summary-copy" class="copy-fallback" readonly hidden aria-label="Tonight summary to copy"></textarea><footer class="tonight-footer"><button type="button" id="copy-tonight">Copy summary</button><button type="button" class="primary" data-close-tonight>Close</button></footer></section>`;
  dialog.querySelectorAll('[data-close-tonight]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.querySelectorAll('[data-rebuy-history]').forEach(button => button.addEventListener('click', () => {
    const history = dialog.querySelector(`#${button.getAttribute('aria-controls')}`);
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    history.closest('tr').hidden = !expanded;
  }));
  dialog.querySelector('#copy-tonight').addEventListener('click', async () => {
    const text = tonightText(summary);
    try { await navigator.clipboard.writeText(text); toast('Tonight summary copied.'); }
    catch {
      const field = dialog.querySelector('#tonight-summary-copy'); field.hidden = false; field.value = text; field.focus(); field.select();
      try { if (document.execCommand('copy')) toast('Tonight summary copied.'); else toast('Select and copy the summary text below.'); }
      catch { toast('Select and copy the summary text below.'); }
    }
  });
  openSheet(dialog, { labelledBy: 'tonight-title' });
}
function renderRebuyRequests(force = false) {
  const dialog = $('#rebuy-requests-dialog');
  if (!dialog.open && !force) return;
  const snapshot = dialog.open ? captureRegion(dialog) : null;
  const requests = state.permissions?.manage ? (state.rebuyRequests || []) : [];
  const rows = requests.map(item => `<article class="rebuy-request-row"><div><h3>${escape(item.name)}</h3><p>Requested ${number(item.amount)} chips</p></div><label for="request-amount-${escape(item.id)}">Approve amount</label><input id="request-amount-${escape(item.id)}" data-request-amount="${escape(item.id)}" type="number" inputmode="numeric" min="1" max="1000000000" step="1" value="${item.amount}"><div class="rebuy-request-actions"><button type="button" data-rebuy-approve="${escape(item.id)}">Approve</button><button type="button" class="quiet danger" data-rebuy-deny="${escape(item.id)}">Deny</button></div></article>`).join('');
  dialog.innerHTML = `<section class="rebuy-requests-sheet"><header class="tonight-header"><div><p class="eyebrow">TABLE CONTROLS</p><h2 id="rebuy-requests-title">Rebuy requests (${requests.length})</h2></div><button type="button" class="seat-sheet-close" data-close-rebuy aria-label="Close rebuy requests">×</button></header><p id="rebuy-request-message" role="alert" class="seat-message">${escape(rebuyRequestMessage)}</p>${rows || '<p class="empty-ledger">No pending requests.</p>'}</section>`;
  if (snapshot) restoreRegion(dialog, snapshot);
  dialog.querySelector('[data-close-rebuy]').addEventListener('click', () => dialog.close());
  dialog.querySelectorAll('[data-rebuy-approve]').forEach(button => button.addEventListener('click', () => respondToRebuy(button.dataset.rebuyApprove, true)));
  dialog.querySelectorAll('[data-rebuy-deny]').forEach(button => button.addEventListener('click', () => respondToRebuy(button.dataset.rebuyDeny, false)));
}
function openRebuyRequests() {
  rebuyRequestMessage = '';
  renderRebuyRequests(true);
  openSheet($('#rebuy-requests-dialog'), { labelledBy: 'rebuy-requests-title' });
}
async function respondToRebuy(playerId, approve) {
  if (busy) return;
  const dialog = $('#rebuy-requests-dialog');
  const input = dialog.querySelector(`[data-request-amount="${CSS.escape(playerId)}"]`);
  const payload = { playerId };
  if (approve && input) payload.amount = Number(input.value);
  busy = true; setButtons(); rebuyRequestMessage = '';
  try {
    const result = await request(approve ? 'rebuy:approve' : 'rebuy:deny', payload);
    if (result.state) receive(result.state);
    rebuyRequestMessage = approve ? 'Rebuy approved.' : 'Request denied.';
  } catch (error) { rebuyRequestMessage = error.message; }
  finally { busy = false; setButtons(); renderRebuyRequests(); }
}
function leaveConfirmation() {
  const me = state.players.find(player => player.id === state.playerId);
  const key = me?.name.normalize('NFKC').trim().toLowerCase();
  const row = state.settlement?.rows.find(player => player.name.normalize('NFKC').trim().toLowerCase() === key);
  const net = row ? `${row.net > 0 ? '+' : ''}${number(row.net)} chips${row.netMoney ? ` · ${row.netMoney}` : ''}` : 'No settled totals yet.';
  showDialog('Leave table', `<p>Your net so far: <strong>${escape(net)}</strong>.</p><p class="helper">Leaving removes your seat. You can copy the Tonight summary first.</p>`, async () => { await request('leave'); if (state) reset('You left the table.'); }, 'Leave table');
}
function endLeagueNight() {
  showDialog('End league night', '<p>Save tonight’s results and close this league table for everyone?</p><p class="helper">The completed night will appear in league history and standings.</p>', async () => {
    await request('host:endNight');
    if (state) reset('League night ended. Results saved.');
  }, 'End night');
}
function nextAssignments(order, changed) {
  const eligible = order.filter(id => { const p = state.players.find(p => p.id === id); return p.stack > 0 && !p.sittingOut; });
  if (eligible.length < 2) return {};
  const after = changed ? -1 : state.dealerSeat;
  const ordered = [...eligible].sort((a, b) => {
    const seat = id => changed ? order.indexOf(id) : state.players.find(p => p.id === id).seat;
    return ((seat(a) - after + 9) % 10) - ((seat(b) - after + 9) % 10);
  });
  return { D: ordered[0], SB: ordered[eligible.length === 2 ? 0 : 1], BB: ordered[eligible.length === 2 ? 1 : 2] };
}
const roleNames = { D: 'Dealer', SB: 'Small blind', BB: 'Big blind' };
function renderSeatReorder(force = false) {
  const dialog = $('#seat-reorder-dialog');
  if ((!dialog.open && !force) || dragSeat) return;
  const previousScroll = dialog.querySelector('.seat-sort-list')?.scrollTop || 0;
  const focusedPlayer = document.activeElement?.closest?.('[data-seat-row]')?.dataset.playerId;
  const host = state.permissions?.manage;
  const editable = host && ['lobby', 'complete'].includes(state.street);
  const changed = JSON.stringify(seatDraft) !== JSON.stringify(state.seatOrder);
  const roles = editable ? nextAssignments(seatDraft, changed) : { D: state.players.find(p => p.seat === state.dealerSeat)?.id, SB: state.smallBlindId, BB: state.bigBlindId };
  const rows = seatDraft.map((id, index) => {
    const player = state.players.find(p => p.id === id);
    if (!player) return '';
    const badges = Object.entries(roles).filter(([, playerId]) => playerId === id).map(([role]) => `<span class="role-chip role-${role}" aria-label="${roleNames[role]}">${role}</span>`).join('');
    const label = `Seat ${index + 1}, ${escape(player.name)}, stack ${number(player.stack)}${Object.entries(roles).filter(([, playerId]) => playerId === id).map(([role]) => `, ${roleNames[role]}`).join('')}`;
    return `<li data-seat-row data-player-id="${escape(id)}" tabindex="0" aria-label="${label}" ${editable ? 'aria-roledescription="sortable seat" aria-grabbed="false"' : ''}><button type="button" class="seat-grip" aria-label="Drag ${escape(player.name)}">⠿</button><span class="seat-index">${index + 1}</span><strong class="seat-player">${escape(player.name)}</strong><span class="seat-stack" title="${number(player.stack)} chips" aria-label="${number(player.stack)} chips">${compactStack(player.stack)}</span><span class="seat-role-chips">${badges}</span>${editable ? `<span class="seat-actions"><button type="button" data-seat-move="up" aria-label="Move ${escape(player.name)} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-seat-move="down" aria-label="Move ${escape(player.name)} down" ${index === seatDraft.length - 1 ? 'disabled' : ''}>↓</button></span>` : ''}</li>`;
  }).join('');
  dialog.innerHTML = `<section class="seat-sheet ${editable ? '' : 'read-only'}"><header class="seat-sheet-header"><div><p class="eyebrow">TABLE SEATING</p><h2 id="seat-reorder-title">${editable ? 'Arrange players' : 'Seat order'}</h2></div><button type="button" class="seat-sheet-close" aria-label="Close seat order">×</button></header><p class="seat-sheet-note">${editable ? 'Drag by the handle, hold a row, or use the arrow keys. Seat 1 stays at the top.' : 'This order is read-only. Ask the host or co-host to change seats between hands.'}</p><p class="seat-preview" id="seat-preview">Next hand: ${['D', 'SB', 'BB'].map(role => `${role} ${escape(state.players.find(p => p.id === roles[role])?.name || '—')}`).join(' · ')}</p>${state.players.length ? `<ol class="seat-sort-list" aria-label="${editable ? 'Reorder players' : 'Player seat order'}">${rows}</ol>` : '<p>No players seated.</p>'}<p class="seat-message" role="status">${escape(seatMessage)}</p><div class="seat-live sr-only" aria-live="polite" aria-atomic="true"></div>${editable ? `<footer class="seat-sheet-footer"><button type="button" class="seat-shuffle">Shuffle seats</button><button type="button" class="seat-cancel">Cancel</button><button type="button" class="primary seat-save" ${!changed || busy || !ready ? 'disabled' : ''}>Save order</button></footer>` : ''}</section>`;
  const list = dialog.querySelector('.seat-sort-list'); if (list) list.scrollTop = previousScroll;
  if (focusedPlayer) dialog.querySelector(`[data-player-id="${CSS.escape(focusedPlayer)}"]`)?.focus({ preventScroll: true });
  dialog.querySelector('.seat-sheet-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.seat-cancel')?.addEventListener('click', () => { seatDraft = [...state.seatOrder]; seatMessage = ''; dialog.close(); });
  dialog.querySelector('.seat-shuffle')?.addEventListener('click', () => {
    for (let i = seatDraft.length - 1; i > 0; i--) {
      const bytes = new Uint32Array(1); crypto.getRandomValues(bytes);
      const j = bytes[0] % (i + 1);
      [seatDraft[i], seatDraft[j]] = [seatDraft[j], seatDraft[i]];
    }
    seatMessage = ''; renderSeatReorder(); dialog.querySelector('.seat-live').textContent = 'Seats shuffled. Review the order before saving.';
  });
  dialog.querySelectorAll('[data-seat-move]').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('[data-seat-row]'); const index = seatDraft.indexOf(row.dataset.playerId);
    const next = moveItem(seatDraft, index, index + (button.dataset.seatMove === 'up' ? -1 : 1));
    if (next[index] !== seatDraft[index]) { seatDraft = next; seatMessage = ''; renderSeatReorder(); const moved = dialog.querySelector(`[data-player-id="${CSS.escape(row.dataset.playerId)}"]`); moved?.focus({ preventScroll: true }); dialog.querySelector('.seat-live').textContent = `Moved ${moved.querySelector('.seat-player').textContent} to seat ${seatDraft.indexOf(moved.dataset.playerId) + 1} of ${seatDraft.length}`; }
  }));
  dialog.querySelectorAll('[data-seat-row]').forEach(row => {
    row.addEventListener('keydown', event => {
      if (event.target !== row) return;
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); row.classList.toggle('keyboard-grabbed'); const grabbed = row.classList.contains('keyboard-grabbed'); row.setAttribute('aria-grabbed', String(grabbed)); dialog.querySelector('.seat-live').textContent = grabbed ? `Picked up ${row.querySelector('.seat-player').textContent}. Use up and down arrows to move.` : `Dropped ${row.querySelector('.seat-player').textContent} at seat ${seatDraft.indexOf(row.dataset.playerId) + 1} of ${seatDraft.length}.`; }
      if (event.key === 'Escape' && row.classList.contains('keyboard-grabbed')) { event.preventDefault(); row.classList.remove('keyboard-grabbed'); row.setAttribute('aria-grabbed', 'false'); seatMessage = 'Move cancelled.'; renderSeatReorder(); }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && row.classList.contains('keyboard-grabbed')) {
        event.preventDefault(); const index = seatDraft.indexOf(row.dataset.playerId); const next = moveItem(seatDraft, index, index + (event.key === 'ArrowUp' ? -1 : 1));
        if (next[index] !== seatDraft[index]) { seatDraft = next; seatMessage = ''; renderSeatReorder(); const moved = dialog.querySelector(`[data-player-id="${CSS.escape(row.dataset.playerId)}"]`); moved?.focus({ preventScroll: true }); moved?.setAttribute('aria-grabbed', 'true'); dialog.querySelector('.seat-live').textContent = `Moved ${moved.querySelector('.seat-player').textContent} to seat ${seatDraft.indexOf(moved.dataset.playerId) + 1} of ${seatDraft.length}`; }
      }
    });
  });
  dialog.querySelector('.seat-save')?.addEventListener('click', saveSeatOrder);
  if (editable) wireSeatDrag(dialog);
}
function updateSeatPreviewDuringDrag(list, placeholder) {
  seatDraft = [...list.children].map(row => row === placeholder ? dragSeat.id : row.dataset.playerId).filter(Boolean);
  const roles = nextAssignments(seatDraft, JSON.stringify(seatDraft) !== JSON.stringify(state.seatOrder));
  list.querySelectorAll('[data-seat-row]').forEach(row => {
    const index = seatDraft.indexOf(row.dataset.playerId);
    row.querySelector('.seat-index').textContent = index + 1;
    row.querySelector('.seat-role-chips').innerHTML = Object.entries(roles).filter(([, id]) => id === row.dataset.playerId).map(([role]) => `<span class="role-chip role-${role}" aria-label="${roleNames[role]}">${role}</span>`).join('');
    row.querySelector('[data-seat-move="up"]').disabled = index === 0;
    row.querySelector('[data-seat-move="down"]').disabled = index === seatDraft.length - 1;
  });
  $('#seat-preview').textContent = `Next hand: ${['D', 'SB', 'BB'].map(role => `${role} ${state.players.find(p => p.id === roles[role])?.name || '—'}`).join(' · ')}`;
}
async function saveSeatOrder() {
  if (busy || !ready || JSON.stringify(seatDraft) === JSON.stringify(state.seatOrder)) return;
  busy = true; setButtons();
  try {
    const result = await request('host:reorderSeats', { order: [...seatDraft] });
    seatMessage = 'Seat order saved.'; receive(result.state); $('#seat-reorder-dialog').close();
  } catch (error) { seatMessage = error.message; renderSeatReorder(); }
  finally { busy = false; setButtons(); }
}
function wireSeatDrag(dialog) {
  const list = dialog.querySelector('.seat-sort-list');
  if (!list) return;
  const animatePositions = before => {
    list.querySelectorAll('[data-seat-row]').forEach(row => {
      const old = before.get(row.dataset.playerId); const now = row.getBoundingClientRect();
      if (old) { const dy = old.top - now.top; if (dy) { row.style.transform = `translateY(${dy}px)`; row.style.transition = 'none'; requestAnimationFrame(() => { row.style.transition = 'transform 170ms ease'; row.style.transform = ''; }); } }
    });
  };
  const placePlaceholder = (x, y) => {
    if (!dragSeat) return;
    const target = document.elementFromPoint(x, y)?.closest('[data-seat-row]');
    if (!target || !list.contains(target)) return;
    const before = new Map([...list.querySelectorAll('[data-seat-row]')].map(el => [el.dataset.playerId, el.getBoundingClientRect()]));
    const targetRect = target.getBoundingClientRect();
    if (y < targetRect.top + targetRect.height / 2) target.before(dragSeat.placeholder); else target.after(dragSeat.placeholder);
    animatePositions(before);
    updateSeatPreviewDuringDrag(list, dragSeat.placeholder);
  };
  const autoScroll = () => {
    if (!dragSeat) return;
    const box = list.getBoundingClientRect(); const edge = 54;
    if (dragSeat.lastY < box.top + edge) list.scrollTop -= 10;
    else if (dragSeat.lastY > box.bottom - edge) list.scrollTop += 10;
    if (dragSeat.lastY < box.top + edge || dragSeat.lastY > box.bottom - edge) placePlaceholder(dragSeat.lastX, dragSeat.lastY);
    dragSeat.autoScrollFrame = requestAnimationFrame(autoScroll);
  };
  const begin = (row, event, immediate) => {
    if (dragSeat || !list.contains(row)) return;
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true); ghost.classList.add('seat-ghost'); ghost.setAttribute('aria-hidden', 'true'); ghost.style.width = `${rect.width}px`; ghost.style.left = `${rect.left}px`; ghost.style.top = `${rect.top}px`;
    const placeholder = document.createElement('li'); placeholder.className = 'seat-placeholder'; placeholder.setAttribute('aria-hidden', 'true'); placeholder.style.height = `${rect.height}px`;
    row.before(placeholder); row.remove(); dialog.appendChild(ghost);
    dragSeat = { id: row.dataset.playerId, pointer: event.pointerId, row, ghost, placeholder, list, dialog, startOrder: [...seatDraft], origin: event.clientY, lastX: event.clientX, lastY: event.clientY, active: immediate };
    if (immediate) { row.classList.add('drag-original'); window.Alerts?.tick(); event.preventDefault(); }
    list.setPointerCapture?.(event.pointerId);
    dragSeat.autoScrollFrame = requestAnimationFrame(autoScroll);
  };
  list.addEventListener('pointerdown', event => {
    const row = event.target.closest('[data-seat-row]'); if (!row) return;
    if (event.target.closest('button:not(.seat-grip)')) return;
    const grip = event.target.closest('.seat-grip'); const touch = event.pointerType === 'touch';
    if (grip || !touch) { begin(row, event, true); return; }
    const id = row.dataset.playerId; const startX = event.clientX; const startY = event.clientY;
    const clear = move => { if (Math.abs(move.clientY - startY) > 8 || Math.abs(move.clientX - startX) > 8) { clearTimeout(timer); list.removeEventListener('pointermove', clear); } };
    const timer = setTimeout(() => { list.removeEventListener('pointermove', clear); const current = list.querySelector(`[data-player-id="${CSS.escape(id)}"]`); if (current) begin(current, event, true); }, 250);
    const stop = () => { clearTimeout(timer); list.removeEventListener('pointermove', clear); };
    list.addEventListener('pointermove', clear, { passive: true });
    list.addEventListener('pointerup', stop, { once: true });
    list.addEventListener('pointercancel', stop, { once: true });
  });
  list.addEventListener('pointermove', event => {
    if (!dragSeat || dragSeat.pointer !== event.pointerId) return;
    if (!dragSeat.active) { if (Math.abs(event.clientY - dragSeat.origin) < 5) return; dragSeat.active = true; }
    event.preventDefault(); dragSeat.lastX = event.clientX; dragSeat.lastY = event.clientY; dragSeat.ghost.style.top = `${event.clientY - dragSeat.ghost.offsetHeight / 2}px`;
    placePlaceholder(event.clientX, event.clientY);
  }, { passive: false });
  const finish = (event, cancelled = false) => {
    if (!dragSeat || (event && dragSeat.pointer !== event.pointerId)) return;
    const session = dragSeat; dragSeat = null; cancelAnimationFrame(session.autoScrollFrame); session.ghost.remove();
    const outside = event && !list.contains(document.elementFromPoint(event.clientX, event.clientY));
    if (cancelled || outside) { session.placeholder.before(session.row); session.placeholder.remove(); seatDraft = session.startOrder; }
    else { session.placeholder.replaceWith(session.row); seatDraft = [...list.querySelectorAll('[data-seat-row]')].map(row => row.dataset.playerId); }
    session.row.classList.remove('drag-original');
    seatMessage = cancelled || outside ? 'Move cancelled.' : '';
    if (queuedDragState) { const latest = queuedDragState; queuedDragState = null; receive(latest); }
    renderSeatReorder();
  };
  list.addEventListener('pointerup', event => finish(event));
  list.addEventListener('pointercancel', event => finish(event, true));
  dialog.oncancel = event => { if (dragSeat) { event.preventDefault(); finish(null, true); } };
}
function seatOval(order) {
  const playing = !['lobby', 'complete'].includes(state.street);
  const roles = { D: state.players.find(p => p.seat === state.dealerSeat)?.id, SB: state.smallBlindId, BB: state.bigBlindId };
  const ownSlot = Math.max(0, order.indexOf(state.playerId));
  const actingSlot = order.indexOf(state.turn);
  const mapLabel = `Clockwise seat order from your position: ${order.map((_, offset) => {
    const index = (ownSlot + offset) % order.length;
    const id = order[index];
    const player = state.players.find(item => item.id === id);
    return `Seat ${index + 1}, ${state.identities?.[id]?.username ? `@${state.identities[id].username}` : player.name}${id === state.playerId ? ', you' : ''}${id === state.turn ? ', to act' : ''}`;
  }).join('; ')}`;
  const seatMap = `<div class="seat-order-guide"><div class="seat-order-heading"><strong>Seat order · clockwise</strong><span>You: ${ownSlot + 1}${actingSlot >= 0 ? ` · To act: ${actingSlot + 1}` : ''}</span></div><svg viewBox="0 0 320 144" role="img" aria-label="${escape(mapLabel)}"><ellipse class="seat-map-felt" cx="160" cy="72" rx="128" ry="43"/><text class="seat-map-center" x="160" y="76">Seats match the cards below</text>${order.map((id, index) => {
    const angle = Math.PI / 2 + 2 * Math.PI * (index - ownSlot) / order.length;
    const x = Math.round(160 + 128 * Math.cos(angle));
    const y = Math.round(72 + 43 * Math.sin(angle));
    return `<g class="seat-map-node ${id === state.playerId ? 'is-you' : ''} ${id === state.turn ? 'is-acting' : ''}" data-seat-map-index="${index + 1}" aria-hidden="true">${id === state.turn ? `<circle class="seat-map-turn" cx="${x}" cy="${y}" r="19"/>` : ''}<circle cx="${x}" cy="${y}" r="15"/><text x="${x}" y="${y + 5}">${index + 1}</text></g>`;
  }).join('')}</svg></div>`;
  return `<div class="seat-oval live-oval" aria-label="Clockwise seat order">${seatMap}<div class="table-felt" aria-hidden="true"></div>${order.map((id, index) => {
    const p = state.players.find(player => player.id === id);
    const status = playing && p.folded ? '× Folded' : playing && p.inHand && p.stack === 0 ? '⚡ All-in' : !p.connected ? '⏸ Offline' : p.sittingOut ? '⏸ Away' : p.id === state.turn ? '▶ To act' : playing ? '● In hand' : '✓ Ready';
    const statusKind = playing && p.folded ? 'folded' : playing && p.inHand && p.stack === 0 ? 'allin' : !p.connected || p.sittingOut ? 'away' : p.id === state.turn ? 'active' : 'ready';
    const cosmetic = state.cosmetics?.[id] || { avatar: 'chip', color: 'c1' };
    const social = state.socialSeats?.includes(id);
    const displayName = state.identities?.[id]?.username ? `@${state.identities[id].username}` : p.name;
    const seatLabel = `Seat ${index + 1}, ${displayName}${p.id === state.playerId ? ', you' : ''}, ${number(p.stack)} chips, bet ${number(p.streetBet)}, ${status.replace(/^[^A-Za-z]+/, '')}, ${p.connected ? 'connected' : 'offline'}`;
    return `<article class="oval-seat slot-${index} seat-color-${escape(cosmetic.color)} ${social ? 'social-seat' : ''} ${p.id === state.turn ? 'acting' : ''} ${p.id === state.playerId ? 'my-seat' : ''} ${playing && p.folded ? 'folded-seat' : ''}" ${social ? `data-friend-seat="${escape(id)}" role="button" tabindex="0" aria-label="${escape(seatLabel)}. View account and friendship"` : `role="group" aria-label="${escape(seatLabel)}"`}><div class="oval-name"><span class="seat-avatar-frame">${tableAvatar(id, cosmetic, displayName, 40)}</span><strong title="${escape(displayName)}">${escape(displayName)}</strong></div><span class="seat-owner">Seat ${index + 1}${p.id === state.playerId ? ' · You' : ''}</span><div class="seat-roles">${Object.entries(roles).filter(([, id]) => id === p.id).map(([role]) => `<span class="role-${role}" title="${role === 'D' ? 'Dealer' : role === 'SB' ? 'Small blind' : 'Big blind'}">${role}</span>`).join('')}</div><strong class="oval-stack ${number(p.stack).length > 9 ? 'stack-long' : ''}" title="${number(p.stack)} chips" aria-label="${number(p.stack)} chips">${number(p.stack)}</strong><small class="oval-bet">${number(p.streetBet)} chips bet</small><span class="oval-status status-${statusKind} ${!playing && p.connected && !p.sittingOut ? 'ready-pill' : ''}">${status}</span></article>`;
  }).join('')}</div>`;
}
async function openFriendSeat(seatId) {
  if (!state?.signedIn || !state.socialSeats?.includes(seatId)) return;
  const dialog = $('#friend-seat-dialog'); const content = $('#friend-seat-content');
  content.textContent = 'Loading player account…';
  if (!dialog.open) dialog.show();
  try {
    const path = `/api/friends/table/${encodeURIComponent(state.roomCode)}/${encodeURIComponent(seatId)}`;
    const response = await fetch(path);
    const peer = await response.json();
    if (!response.ok) throw new Error(peer.error || 'Account unavailable.');
    content.replaceChildren();
    if (peer.avatar && window.TablemateAvatar?.valid(peer.avatar)) content.append(window.TablemateAvatar.renderAvatar(peer.avatar, 64, peer.displayName));
    const name = document.createElement('strong'); name.textContent = peer.displayName; content.append(name);
    if (peer.username) { const handle = document.createElement('span'); handle.textContent = `@${peer.username}`; content.append(handle); }
    const relation = document.createElement('p');
    relation.textContent = ({ friends: 'Already friends', 'request-sent': 'Friend request sent',
      'request-received': 'This player sent you a request', blocked: 'You blocked this player',
      'not-friends': 'Not friends yet' })[peer.status] || 'Unavailable';
    content.append(relation);
    if (peer.status === 'not-friends') {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Send friend request';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const sent = await fetch(`${path}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const result = await sent.json(); if (!sent.ok) throw new Error(result.error || 'Request failed.');
          relation.textContent = result.status === 'friends' ? 'You are now friends.' : 'Friend request sent.';
          button.remove(); refreshFriendsCount();
        } catch (error) { relation.textContent = error.message; button.disabled = false; }
      }); content.append(button);
    } else if (peer.status === 'request-received' || peer.status === 'blocked') {
      const link = document.createElement('a'); link.href = '/friends.html'; link.textContent = 'Manage in Friends'; content.append(link);
    }
  } catch (error) { content.textContent = error.message; }
}
function positionSeats() {
  const dock = document.querySelector('.dock');
  document.body.classList.toggle('table-dock-in-flow', Boolean(dock && dock.offsetHeight > window.innerHeight * .35));
  document.querySelectorAll('.seat-oval').forEach(oval => {
    const stage = oval.closest('.table-stage');
    const seats = [...oval.querySelectorAll('.oval-seat')];
    const compactWaiting = stage.classList.contains('waiting-stage') && seats.length <= 2;
    stage.classList.toggle('compact-seating', compactWaiting);
    if (matchMedia('(max-width: 699px)').matches || compactWaiting) {
      stage.classList.add('board-above');
      oval.removeAttribute('style');
      oval.querySelectorAll('.oval-seat, .table-felt').forEach(element => element.removeAttribute('style'));
      return;
    }
    stage.classList.remove('board-above');
    const width = oval.clientWidth;
    if (!width || !seats.length) return;
    const count = seats.length;
    const cardWidth = Math.min(176, Math.max(136, Math.floor((width - 24) / (count >= 8 ? 5.1 : count >= 5 ? 4.4 : 3.6))));
    seats.forEach(seat => { seat.style.width = `${cardWidth}px`; });
    const heights = seats.map(seat => seat.getBoundingClientRect().height);
    const tallest = Math.max(...heights);
    const rx = (width - cardWidth - 24) / 2;
    const ownSlot = seats.findIndex(seat => seat.classList.contains('my-seat'));
    const points = radius => seats.map((_, index) => {
      const angle = Math.PI / 2 + 2 * Math.PI * (index - Math.max(0, ownSlot)) / count;
      return { x: width / 2 + rx * Math.cos(angle), y: radius * Math.sin(angle) };
    });
    const collide = (a, b, gap = 12) => a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
    const bounds = (point, index, centerY) => ({ left: point.x - cardWidth / 2, right: point.x + cardWidth / 2,
      top: centerY + point.y - heights[index] / 2, bottom: centerY + point.y + heights[index] / 2 });
    const board = stage.querySelector('.pot-board');
    let ry = Math.max(150, tallest + 24);
    if (count === 2 && stage.classList.contains('live-stage'))
      ry = Math.max(ry, (board.offsetHeight + tallest) / 2 + 26);
    for (; ry < 1000; ry += 8) {
      const trial = points(ry).map((point, index) => bounds(point, index, 0));
      if (trial.every((rect, index) => trial.slice(index + 1).every(other => !collide(rect, other)))) break;
    }
    const height = Math.ceil(2 * ry + tallest + 32);
    oval.style.height = `${height}px`;
    const finalPoints = points(ry);
    const positioned = finalPoints.map((point, index) => bounds(point, index, height / 2));
    seats.forEach((seat, index) => {
      const point = finalPoints[index];
      seat.style.left = `${Math.round(point.x)}px`;
      seat.style.top = `${Math.round(height / 2 + point.y)}px`;
    });
    const felt = oval.querySelector('.table-felt');
    felt.style.width = `${Math.round(2 * rx + cardWidth / 4)}px`;
    felt.style.height = `${Math.round(2 * ry + tallest / 3)}px`;
    if (stage.classList.contains('waiting-stage') || width < 700) { stage.classList.add('board-above'); return; }
    const boardRect = { left: (width - board.offsetWidth) / 2, right: (width + board.offsetWidth) / 2,
      top: (height - board.offsetHeight) / 2, bottom: (height + board.offsetHeight) / 2 };
    const dockTop = document.querySelector('.dock')?.getBoundingClientRect().top ?? window.innerHeight;
    const boardBelowDock = board.getBoundingClientRect().bottom > dockTop - 16;
    stage.classList.toggle('board-above', boardBelowDock || positioned.some(rect => collide(rect, boardRect, 18)));
  });
}
function nodePath(root, element) {
  const path = [];
  for (let node = element; node && node !== root; node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) return null;
    path.unshift([...parent.children].indexOf(node));
  }
  return path;
}
function atPath(root, path) {
  return Array.isArray(path) ? path.reduce((parent, index) => parent?.children[index], root) : null;
}
function describeNode(root, element) {
  return { id: element.id || '', path: nodePath(root, element) };
}
function findNode(root, description) {
  if (description?.id) {
    const found = document.getElementById(description.id);
    if (found && root.contains(found)) return found;
  }
  return atPath(root, description?.path);
}
function captureRegion(root) {
  const fields = [...root.querySelectorAll('input, select, textarea')].map(el => {
    let start = null; let end = null;
    try { start = el.selectionStart; end = el.selectionEnd; } catch { /* Number inputs do not expose text selection. */ }
    return { node: describeNode(root, el), value: el.value, checked: 'checked' in el ? el.checked : undefined, start, end };
  });
  const details = [...root.querySelectorAll('details')].map(el => ({ node: describeNode(root, el), open: el.open }));
  const scroll = [root, ...root.querySelectorAll('*')].filter(el => el.scrollTop || el.scrollLeft).map(el => ({
    node: describeNode(root, el), tag: el.tagName, top: el.scrollTop, left: el.scrollLeft
  }));
  const active = root.contains(document.activeElement) ? describeNode(root, document.activeElement) : null;
  return { fields, details, scroll, active, windowScrollY: window.scrollY };
}
function restoreRegion(root, snapshot) {
  for (const item of snapshot.details) { const el = findNode(root, item.node); if (el?.tagName === 'DETAILS') el.open = item.open; }
  for (const item of snapshot.fields) {
    const el = findNode(root, item.node);
    if (!el) continue;
    el.value = item.value;
    if (item.checked !== undefined) el.checked = item.checked;
    try { if (item.start !== null) el.setSelectionRange(item.start, item.end); } catch { /* Number inputs do not support selection ranges. */ }
  }
  for (const item of snapshot.scroll) {
    const el = findNode(root, item.node);
    if (el?.tagName === item.tag) { el.scrollTop = item.top; el.scrollLeft = item.left; }
  }
  window.scrollTo(0, snapshot.windowScrollY);
  const focus = snapshot.active && findNode(root, snapshot.active);
  if (focus && !focus.disabled) focus.focus({ preventScroll: true });
}
function render() {
  if (!state) return;
  const me = state.players.find(p => p.id === state.playerId);
  if (!me) return;
  const host = state.permissions?.manage;
  const requestCount = host ? (state.rebuyRequests || []).length : 0;
  const playing = !['lobby', 'complete'].includes(state.street);
  const actor = state.players.find(p => p.id === state.turn);
  const total = state.players.reduce((sum, p) => sum + p.contributed, 0);
  const tableRoot = $('#table');
  const enteringTable = tableRoot.hidden;
  const uiState = captureRegion(tableRoot);
  document.body.classList.add('in-game');
  $('#lobby').hidden = true; $('#site-footer').hidden = true; $('#table').hidden = false;
  $('#table').innerHTML = `
    ${!ready ? '<div class="reconnect-banner" role="status">Reconnecting… Your seat and chips are saved. Actions will return when the table is in sync.</div>' : ''}
    <header class="table-heading"><h1><button id="copy-code" title="Copy table code" aria-label="Copy table code ${escape(state.roomCode)}"><span class="header-table-label">Table </span><strong>${escape(state.roomCode)}</strong></button></h1><span>${state.players.length}/10<span class="player-count-label"> players</span></span><span>Blinds <strong>${number(state.settings.smallBlind)}/${number(state.settings.bigBlind)}</strong></span><button id="header-invite">Invite</button><button id="table-settings" aria-label="Table settings${requestCount ? `, ${requestCount} rebuy requests` : ''}" title="Table settings">⚙${requestCount ? `<span class="rebuy-count" aria-hidden="true">${requestCount}</span>` : ''}</button></header>
    <nav class="table-quick-nav" aria-label="Table shortcuts"><span class="table-connection" role="status">${ready ? '✓ Connected' : '⏸ Reconnecting'}</span><span class="table-turn">${state.legal.active ? 'Your turn' : actor ? `${escape(actor.name)} to act` : state.street === 'complete' ? 'Hand complete' : 'Waiting for host'}</span><button type="button" id="quick-hand-log">Hand log</button><button type="button" id="quick-tonight">Tonight</button>${host && state.permissions.owner && state.canUndo ? '<button type="button" id="quick-undo">Undo</button>' : ''}${host && requestCount ? `<button type="button" id="quick-rebuy">Rebuys (${requestCount})</button>` : ''}</nav>
    <div class="table-layout"><section class="play-area" aria-label="Poker table">
      <div class="table-stage ${playing ? 'live-stage' : 'waiting-stage'} ${playing && state.players.length === 2 ? 'heads-up-stage' : ''}"><div class="pot-board ${playing ? 'live-pot' : 'waiting-pot'}"><div class="streets" aria-label="Betting street">${['preflop', 'flop', 'turn', 'river', 'showdown'].map(street => `<span class="${state.street === street ? 'current' : ''}" ${state.street === street ? 'aria-current="step"' : ''}>${state.street === street ? '• ' : ''}${street.toUpperCase()}</span>`).join('')}</div>
        ${playing ? `<p class="pot-label">Hand ${state.handNumber} · Total pot</p><div class="pot-number">${number(total)}</div><span class="pot-unit">CHIPS</span>` : `<p class="pot-label">${state.street === 'complete' ? 'Hand complete' : 'Your table is open'}</p><h2>${state.players.length < 2 ? 'Waiting for players' : host ? 'Ready to deal' : 'Waiting for host to start'}</h2><p>${(() => { const count = state.players.filter(p => p.stack > 0 && !p.sittingOut).length; return `${count} ${count === 1 ? 'player' : 'players'} ready`; })()}</p>`}
        <p class="street-instruction" aria-live="polite">${instructions[state.street]}</p>
        ${state.street === 'showdown' && state.pots.length > 1 ? `<div class="pot-summary">${state.pots.map((p, i) => `<span>${i ? `Side pot ${i}` : 'Main pot'} · ${number(p.amount)}</span>`).join('')}</div>` : ''}</div>
      ${seatOval(state.seatOrder)}</div><div class="table-meta"><span>Action moves clockwise</span><span id="blind-clock"></span></div>
      ${state.lastResult && state.street === 'complete' ? `<section class="result"><h2>That’s a hand.</h2>${state.lastResult.awards.map(a => `<p>${escape(state.players.find(p => p.id === a.id)?.name || 'Departed player')} <strong>+${number(a.amount)}</strong> · ${escape(a.label)}</p>`).join('')}${[...new Set(state.lastResult.awards.map(a => a.id))].map(id => { const winner = state.players.find(p => p.id === id); return winner ? `<p class="winner-record">${escape(winner.name)} has won ${winner.handsWon} of ${winner.handsPlayed} played hands; dealt ${winner.handsDealt} total tonight.</p>` : ''; }).join('')}</section>` : ''}
      ${state.street === 'showdown' ? `<section class="showdown"><h2>Who takes the pot?</h2><p class="helper">${host ? 'Select every tied winner for each pot. Chips settle after all pots are assigned; odd chips go left of the dealer.' : 'The host or co-host is selecting winners from the physical cards.'}</p>${state.pots.map((pot, index) => `<form class="winner-form" data-pot="${pot.id}"><h3>${index ? `Side pot ${index}` : 'Main pot'} · ${number(pot.amount)} chips</h3>${pot.winners ? `<p class="helper">Selected: ${pot.winners.map(id => escape(state.players.find(p => p.id === id).name)).join(' + ')}</p>` : pot.eligible.map(id => `<label for="winner-${pot.id}-${id}"><input id="winner-${pot.id}-${id}" type="checkbox" name="winner" value="${escape(id)}" ${!host ? 'disabled' : ''}>${escape(state.players.find(p => p.id === id).name)}</label>`).join('')}${host && !pot.winners ? '<button class="primary" type="submit">Confirm winner(s)</button>' : ''}</form>`).join('')}</section>` : ''}
    </section><details class="rail-drawer" id="table-rail" ${railMedia.matches ? 'open' : ''}><summary>Players, hand log & controls</summary><aside class="sidebar">
      <details class="panel" id="players-panel" open><summary>Players <span>${state.players.length}/10</span></summary><ul class="players-list">${state.seatOrder.map(id => { const p = state.players.find(p => p.id === id); const cosmetic = state.cosmetics?.[id] || { avatar:'chip',color:'c1',note:'' }; return `<li class="seat-color-${escape(cosmetic.color)}"><strong>${tableAvatar(id, cosmetic, p.name, 24)} ${escape(p.name)}${tableUsername(id)}${p.id === state.playerId ? ' · You' : ''}</strong><span>${p.sittingOut ? '⏸ Away' : p.connected ? '✓ Connected' : '⏸ Offline'}</span>${cosmetic.note ? `<span class="seat-note">${escape(cosmetic.note)}</span>` : ''}<span>Won ${p.handsWon} · Played ${p.handsPlayed} · Dealt ${p.handsDealt}</span></li>`; }).join('')}</ul><div class="panel-content"><button id="donate-chips" ${playing || me.stack < 1 || state.players.length < 2 ? 'disabled' : ''}>Donate chips</button><button id="open-tonight-players">Tonight</button><p class="helper">${playing ? 'Available between hands.' : 'Give chips from your stack to another player.'}</p></div></details>
      <details class="panel" id="hand-log" ${railMedia.matches ? 'open' : ''}><summary>Hand log <span>Hand ${state.handNumber}</span></summary><ol class="log-list">${handLog()}</ol></details>
      ${host ? hostPanel(playing, actor, state.permissions.owner) : ''}
      <details class="panel" id="your-seat"><summary>Your seat</summary><div class="panel-content"><p class="helper">${playing ? 'Sit out applies from the next hand. Leave and rebuy between hands.' : 'Ask your host for a rebuy or add-on.'}</p><button id="sit-out">${me.sittingOut ? 'Play next hand' : 'Sit out next hand'}</button><button id="leave" class="quiet danger" ${playing ? 'disabled' : ''}>Leave table</button><button type="button" id="open-cosmetics">Avatar & seat color</button>${rebuyRequestControls()}${themePickerMarkup('seat')}${pushControls()}${alertControls()}</div></details>
    </aside></details></div>
    <section class="dock" aria-label="Your betting controls"><div class="dock-inner"><div class="dock-summary"><div class="turn-label ${state.legal.active ? '' : 'waiting'}${ready && !state.legal.active && actor ? ' other-turn' : ''}" role="status">${!ready ? 'RECONNECTING' : state.legal.active ? 'YOUR TURN' : state.street === 'showdown' ? 'SHOWDOWN' : actor ? `${escape(actor.name).toUpperCase()} TO ACT` : host ? 'HOST · TABLE CONTROLS' : 'WAITING FOR HOST'}</div><div class="balance"><span>Your stack</span><strong>${number(me.stack)}</strong></div><div class="balance"><span>To call</span><strong>${number(state.legal.toCall)}</strong></div></div>
      ${!playing ? `<div class="lobby-actions"><button id="invite-players">Invite players</button><button id="change-seat">Change seat</button><button id="set-buy-in">${host ? 'Set buy-in' : 'View buy-in'}</button><button id="open-tonight-dock">Tonight</button>${host ? `<button id="open-rebuy-requests-dock" ${requestCount ? '' : 'disabled'}>Rebuy requests (${requestCount})</button><button id="start-hand" class="primary" ${state.players.filter(p => p.stack > 0 && !p.sittingOut).length < 2 ? 'disabled' : ''}>${state.handNumber ? 'Start next hand' : 'Start game'} →</button>` : '<span class="helper">Your host starts the hand.</span>'}</div>` : ''}
      ${me.stack === 0 ? `<div class="rebuy-dock-row"><button type="button" id="open-rebuy-request-dock">${(state.rebuyRequests || []).some(item => item.id === me.id) ? 'Rebuy request pending' : 'Request rebuy'}</button></div>` : ''}
      ${state.turn ? `<div class="actions"><button data-action="fold" class="quiet" aria-label="${state.legal.canCheck && state.legal.toCall === 0 ? 'Fold unavailable because you can check for 0 chips' : 'Fold'}" title="${state.legal.canCheck && state.legal.toCall === 0 ? 'You can check for 0 chips.' : 'Fold this hand.'}" ${!state.legal.active || (state.legal.canCheck && state.legal.toCall === 0) ? 'disabled' : ''}>Fold</button><button data-action="${state.legal.canCheck ? 'check' : 'call'}" class="neutral" ${!state.legal.active ? 'disabled' : ''}>${state.legal.canCheck ? 'Check' : `Call ${number(state.legal.toCall)}`}</button><button id="toggle-raise" class="primary" aria-expanded="${raiseOpen}" aria-controls="raise-form" ${!state.legal.canRaise ? 'disabled' : ''}>${state.currentBet ? 'Raise' : 'Bet'}</button><button id="all-in-guard" class="all-in" ${!state.legal.canAllIn ? 'disabled' : ''}>All-in · review</button></div>` : ''}
      ${raiseOpen && state.legal.canRaise ? (() => {
        const min = Math.min(state.legal.minRaiseTo, state.legal.maxRaiseTo);
        const max = state.legal.maxRaiseTo;
        const sliderInput = `<input id="raise-range" type="range" aria-label="Raise amount slider (logarithmic)" min="0" max="100" value="${sliderPosition(min, min, max)}" step="1" data-min="${min}" data-max="${max}" data-blind="${state.settings.smallBlind}">`;
        const sliderControl = matchMedia('(max-width: 699px)').matches
          ? `<div class="range-adjust range-adjust-mobile"><label for="raise-range">Adjust with slider</label>${sliderInput}</div>`
          : `<details class="range-adjust"><summary>Adjust with slider</summary>${sliderInput}</details>`;
        return `<form id="raise-form" class="raise-panel" aria-label="Raise amount"><div class="raise-sheet-header"><strong>${state.currentBet ? 'Raise' : 'Bet'} to · multiples of ${number(state.settings.smallBlind)}</strong><button type="button" id="close-raise" aria-label="Close raise amount">Close</button></div><div><label for="raise-amount">Amount in chips</label><div class="amount-stepper"><button type="button" data-raise-step="-1" aria-label="Decrease by one small blind">−</button><input id="raise-amount" aria-label="Raise to amount" type="number" inputmode="numeric" min="${min}" max="${max}" value="${min}" step="${state.settings.smallBlind}" required><button type="button" data-raise-step="1" aria-label="Increase by one small blind">+</button></div>${sliderControl}</div><div class="quick-bets"><button type="button" data-quick="min">Min</button><button type="button" data-quick="half">½ pot</button><button type="button" data-quick="three-quarter">¾ pot</button><button type="button" data-quick="pot">Pot</button></div><button class="primary raise-submit" type="submit">Confirm ${state.currentBet ? 'raise' : 'bet'}</button></form>`;
      })() : ''}
    </div></section>`;
  restoreRegion(tableRoot, uiState);
  if (enteringTable) window.scrollTo(0, 0);
  window.AvatarV2?.hydrate(tableRoot);
  document.querySelectorAll('#table .theme-picker-section').forEach(wireThemePicker);
  wireTable(me, total); updateClock(); setButtons(); renderSeatReorder();
  ellipseObserver.disconnect();
  observedTableWidth = 0;
  document.querySelectorAll('.play-area').forEach(el => ellipseObserver.observe(el));
  positionSeats();
  updateKeyboardInset();
}
function hostPanel(playing, actor, owner) {
  const requestCount = (state.rebuyRequests || []).length;
  return `<details class="panel" id="host-menu"><summary tabindex="0">${owner ? 'Host controls' : 'Co-host controls'}</summary><div class="panel-content">${owner ? `<button id="undo" ${!state.canUndo ? 'disabled' : ''}>Undo last action</button>` : ''}<button type="button" id="open-rebuy-requests-host" ${requestCount ? '' : 'disabled'}>Rebuy requests (${requestCount})</button>${actor && !actor.connected ? '<button id="host-fold" class="danger">Fold disconnected player</button>' : ''}${state.leagueTable && state.handNumber > 0 ? `<button type="button" id="end-league-night" class="quiet" ${playing ? 'disabled' : ''}>End league night</button>` : ''}<p class="helper">${playing ? 'Settings are available between hands.' : 'Changes to the starting stack apply to new seats. Before the first hand, they apply to everyone.'}</p>
    <form id="settings-form"><div class="form-grid"><div><label for="host-stack">Starting stack</label><input id="host-stack" type="number" min="1" max="1000000000" value="${state.settings.startingStack}" ${playing ? 'disabled' : ''} required></div><div><label for="host-timer">Timer (minutes)</label><input id="host-timer" type="number" min="0" max="1440" value="${state.settings.blindMinutes}" ${playing ? 'disabled' : ''} required></div><div><label for="host-sb">Small blind</label><input id="host-sb" type="number" min="1" value="${state.settings.smallBlind}" ${playing ? 'disabled' : ''} required></div><div><label for="host-bb">Big blind</label><input id="host-bb" type="number" min="1" value="${state.settings.bigBlind}" ${playing ? 'disabled' : ''} required></div><div><label for="host-cash-value">Cash value per 1,000 chips ($)</label><input id="host-cash-value" type="number" inputmode="decimal" min="0" max="100000" step="0.01" value="${(state.settings.centsPer1000Chips / 100).toFixed(2)}" ${playing ? 'disabled' : ''}></div></div><button type="submit" ${playing ? 'disabled' : ''}>Save table settings</button></form>
    <form id="host-policy-form"><h3>Rebuy approval</h3><label for="host-policy-mode">Mode</label><select id="host-policy-mode"><option value="host" ${state.rebuyPolicy?.mode === 'host' ? 'selected' : ''}>Host approves</option><option value="auto" ${state.rebuyPolicy?.mode === 'auto' ? 'selected' : ''}>Auto-approve up to a cap</option></select><div id="host-policy-auto" ${state.rebuyPolicy?.mode === 'auto' ? '' : 'hidden'}><label for="host-policy-cap">Cap · chips</label><input id="host-policy-cap" type="number" min="1" max="1000000000" value="${state.rebuyPolicy?.cap ?? state.settings.startingStack}"><label for="host-policy-limit">Auto rebuys per player</label><input id="host-policy-limit" type="number" min="0" max="20" value="${state.rebuyPolicy?.maxPerPlayer ?? 3}"></div><button type="submit">Save rebuy policy</button></form>
    ${owner ? `<form id="rebuy-form"><label for="rebuy-player">Rebuy / add-on</label><select id="rebuy-player" ${playing ? 'disabled' : ''}>${state.players.map(option).join('')}</select><label for="rebuy-amount">Chips to add</label><input id="rebuy-amount" type="number" min="1" max="1000000000" value="${state.settings.startingStack}" ${playing ? 'disabled' : ''} required><button type="submit" ${playing ? 'disabled' : ''}>Add chips</button></form>` : ''}
    ${owner && state.players.length > 1 ? `<form id="kick-form"><label for="kick-player">Remove a player</label><select id="kick-player" ${playing ? 'disabled' : ''}>${state.players.filter(p => p.id !== state.playerId).map(option).join('')}</select><button class="danger quiet" type="submit" ${playing ? 'disabled' : ''}>Remove selected player</button></form>` : ''}</div></details>`;
}
function wireTable(me, pot) {
  $('#copy-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.roomCode); toast(`Table code ${state.roomCode} copied.`); }
    catch { toast(`Your table code is ${state.roomCode}.`); }
  });
  $('#table-settings').addEventListener('click', () => openControls());
  $('#quick-hand-log').addEventListener('click', () => openControls('hand-log'));
  $('#quick-tonight').addEventListener('click', openTonight);
  $('#quick-rebuy')?.addEventListener('click', openRebuyRequests);
  const confirmUndo = () => showDialog('Undo last action?', '<p>This restores the table to its previous state for everyone. Check the hand log afterward.</p>', async () => {
    const result = await request('undo'); if (result.state) receive(result.state);
  }, 'Undo last action');
  $('#quick-undo')?.addEventListener('click', confirmUndo);
  $('#donate-chips').addEventListener('click', donationDialog);
  $('#header-invite').addEventListener('click', inviteDialog);
  document.querySelectorAll('[data-friend-seat]').forEach(seat => {
    seat.addEventListener('click', () => openFriendSeat(seat.dataset.friendSeat));
    seat.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFriendSeat(seat.dataset.friendSeat); }
    });
  });
  $('#invite-players')?.addEventListener('click', inviteDialog);
  $('#set-buy-in')?.addEventListener('click', inviteDialog);
  $('#change-seat')?.addEventListener('click', openSeatReorder);
  $('#open-rebuy-requests-dock')?.addEventListener('click', openRebuyRequests);
  $('#open-rebuy-requests-host')?.addEventListener('click', openRebuyRequests);
  $('#open-rebuy-request-dock')?.addEventListener('click', () => openControls('your-seat'));
  document.querySelectorAll('[data-open-seat]').forEach(button => button.addEventListener('click', inviteDialog));
  $('#start-hand')?.addEventListener('click', () => run('start-hand'));
  $('#undo')?.addEventListener('click', confirmUndo);
  $('#host-fold')?.addEventListener('click', () => run('host-fold'));
  $('#end-league-night')?.addEventListener('click', endLeagueNight);
  $('#sit-out').addEventListener('click', () => run('sit-out', { value: !me.sittingOut }));
  $('#leave').addEventListener('click', leaveConfirmation);
  $('#open-cosmetics').addEventListener('click', openCosmetics);
  $('#rebuy-request-form')?.addEventListener('submit', event => {
    event.preventDefault(); run('rebuy:request', { amount: Number($('#rebuy-request-amount').value) });
  });
  $('#cancel-rebuy-request')?.addEventListener('click', () => run('rebuy:cancel'));
  $('#open-tonight-players')?.addEventListener('click', openTonight);
  $('#open-tonight-dock')?.addEventListener('click', openTonight);
  $('#toggle-push')?.addEventListener('click', () => togglePushNotifications().catch(error => toast(error.message)));
  document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => run('action', { type: el.dataset.action })));
  $('#all-in-guard')?.addEventListener('click', () => {
    if (!ready || !state.legal.canAllIn) return;
    showDialog('Go all-in?', `<p>Commit your full stack of <strong>${number(me.stack)} chips</strong> to this hand?</p><p class="helper">Your cards stay on the real table. This action cannot be taken back by you.</p>`, async () => {
      const result = await request('action', { type: 'all-in' }); if (result.state) receive(result.state);
    }, 'Confirm all-in');
  });
  $('#toggle-raise')?.addEventListener('click', () => { raiseOpen = !raiseOpen; render(); });
  $('#close-raise')?.addEventListener('click', () => { raiseOpen = false; render(); $('#toggle-raise')?.focus({ preventScroll: true }); });
  $('#raise-amount')?.addEventListener('input', e => {
    const range = $('#raise-range');
    const amount = Number(e.target.value);
    // Keep the user's draft intact, including an empty field while replacing it.
    // Native form constraints and the server validate the completed amount.
    if (e.target.value !== '' && Number.isFinite(amount) && amount > 0) {
      range.value = sliderPosition(Math.min(Number(range.dataset.max), Math.max(Number(range.dataset.min), amount)), Number(range.dataset.min), Number(range.dataset.max));
    }
  });
  $('#raise-range')?.addEventListener('input', e => { const range = e.target; $('#raise-amount').value = sliderAmount(Number(range.value), Number(range.dataset.min), Number(range.dataset.max), Number(range.dataset.blind)); });
  document.querySelectorAll('[data-raise-step]').forEach(button => button.addEventListener('click', () => {
    const amount = $('#raise-amount'); const step = Number(amount.step); const min = Number(amount.min); const max = Number(amount.max);
    amount.value = Math.max(min, Math.min(max, Number(amount.value) + Number(button.dataset.raiseStep) * step));
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  document.querySelectorAll('[data-rebuy-step]').forEach(button => button.addEventListener('click', () => {
    const amount = $('#rebuy-request-amount'); const step = state.settings.smallBlind;
    amount.value = Math.max(1, Math.min(1_000_000_000, Number(amount.value) + Number(button.dataset.rebuyStep) * step));
  }));
  document.querySelectorAll('[data-quick]').forEach(el => el.addEventListener('click', () => {
    const min = state.legal.minRaiseTo; const max = state.legal.maxRaiseTo;
    const sb = state.settings.smallBlind;
    const snap = value => snapToBlind(value, sb);
    const amounts = { min, half: snap(state.currentBet + (pot + state.legal.fullToCall) / 2), pot: snap(state.currentBet + pot + state.legal.fullToCall), 'three-quarter': snap(state.currentBet + (pot + state.legal.fullToCall) * .75) };
    const amount = Math.min(max, Math.max(min, amounts[el.dataset.quick]));
    $('#raise-amount').value = amount; $('#raise-range').value = sliderPosition(amount, min, max);
  }));
  $('#raise-form')?.addEventListener('submit', event => { event.preventDefault(); run('action', { type: 'raise', amount: Number($('#raise-amount').value) }); });
  $('#settings-form')?.addEventListener('submit', event => {
    event.preventDefault(); run('host-settings', { settings: { startingStack: Number($('#host-stack').value), smallBlind: Number($('#host-sb').value), bigBlind: Number($('#host-bb').value), blindMinutes: Number($('#host-timer').value), centsPer1000Chips: Math.round(Number($('#host-cash-value').value) * 100) } });
  });
  $('#host-policy-mode')?.addEventListener('change', () => { $('#host-policy-auto').hidden = $('#host-policy-mode').value !== 'auto'; });
  $('#host-policy-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const mode = $('#host-policy-mode').value;
    run('host:rebuyPolicy', mode === 'auto' ? { mode, cap: Number($('#host-policy-cap').value), maxPerPlayer: Number($('#host-policy-limit').value) } : { mode });
  });
  $('#rebuy-form')?.addEventListener('submit', event => { event.preventDefault(); run('rebuy', { playerId: $('#rebuy-player').value, amount: Number($('#rebuy-amount').value) }); });
  $('#kick-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const playerId = $('#kick-player').value;
    const player = state.players.find(item => item.id === playerId);
    if (!player) return;
    showDialog(`Remove ${player.name}?`, `<p>Remove <strong>${escape(player.name)}</strong> from this table? They will lose their seat.</p>`, async () => {
      const result = await request('kick', { playerId }); if (result.state) receive(result.state);
    }, 'Remove player');
  });
  document.querySelectorAll('.winner-form').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault(); const winnerIds = [...form.querySelectorAll('input:checked')].map(el => el.value);
    if (!winnerIds.length) return toast('Select at least one winner for this pot.');
    run('showdown-pick', { potId: Number(form.dataset.pot), winnerIds });
  }));
}
function updateClock() {
  const target = $('#blind-clock'); if (!target || !state) return;
  if (!state.settings.blindMinutes) target.textContent = 'Steady blinds';
  else if (!state.blindDeadline) target.textContent = `Blinds double every ${state.settings.blindMinutes}m`;
  else {
    const seconds = Math.max(0, Math.ceil((state.blindDeadline - Date.now() - serverOffset) / 1000));
    target.textContent = seconds ? `Next blinds in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Blinds increase next hand';
  }
}
function updateKeyboardInset() {
  const viewport = window.visualViewport;
  const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
  document.documentElement.style.setProperty('--visual-viewport-height', `${viewport?.height || window.innerHeight}px`);
  document.documentElement.dataset.keyboardOpen = inset > 80 ? 'true' : 'false';
  const dock = $('#table .dock');
  if (dock) document.documentElement.style.setProperty('--dock-height', `${dock.getBoundingClientRect().height}px`);
}
window.visualViewport?.addEventListener('resize', updateKeyboardInset);
window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
document.addEventListener('visibilitychange', reportPresence);
window.addEventListener('focus', reportPresence);
updateKeyboardInset();
setInterval(updateClock, 1000);
$('#friend-seat-close').addEventListener('click', () => $('#friend-seat-dialog').close());
async function refreshFriendsCount() {
  try {
    const response = await fetch('/api/friends/summary'); if (!response.ok) return;
    const { unread } = await response.json(); const count = $('#friends-count');
    count.hidden = !unread; count.textContent = unread > 9 ? '9+' : String(unread);
    $('#friends-link').setAttribute('aria-label', unread ? `Friends, ${unread} new updates` : 'Friends');
  } catch { /* The table keeps working if friend updates are unavailable. */ }
}
fetch('/api/config').then(response => response.json()).then(async config => {
  if (!config.accounts) return;
  const response = await fetch('/api/me');
  const link = $('#account-link');
  link.hidden = false;
  $('#home-account').hidden = false;
  if (!response.ok) return;
  const account = await response.json();
  $('#friends-link').hidden = false; refreshFriendsCount();
  if (!$('#name').value.trim()) $('#name').value = account.displayName;
  link.textContent = 'My account';
  link.href = '/me.html';
  $('#home-account').querySelector('span').textContent = `Welcome back, ${account.displayName}. Your nights and settings are saved.`;
  $('#home-account-link').textContent = 'My account';
  $('#home-account-link').href = '/me.html';
  $('#account-logout').hidden = false;
  canSavePresets = true;
  loadPresets();
}).catch(() => {});
setInterval(() => { if (!$('#friends-link').hidden && document.visibilityState === 'visible') refreshFriendsCount(); }, 30_000);
$('#account-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.assign('/');
});
renderPresetChips();
$('#preset-chips').addEventListener('click', event => {
  const button = event.target.closest('[data-preset-id]');
  if (!button) return;
  const preset = button.dataset.presetId.startsWith('builtin-')
    ? window.TablematePresets.builtins[Number(button.dataset.presetId.slice(8))]
    : savedPresets.find(item => item.id === button.dataset.presetId);
  if (preset) applyPreset({ ...preset, id: button.dataset.presetId });
});
$('#create-fields').addEventListener('input', event => {
  if (event.target.closest('#preset-chips')) return;
  document.querySelectorAll('[data-preset-id]').forEach(button => button.setAttribute('aria-pressed', 'false'));
});
$('#rebuy-policy-mode').addEventListener('change', () => { $('#rebuy-policy-auto').hidden = $('#rebuy-policy-mode').value !== 'auto'; });
$('#save-preset').addEventListener('click', () => openPresets('save'));
$('#manage-presets').addEventListener('click', () => openPresets('manage'));
$('#lobby-theme-picker').innerHTML = themePickerMarkup('lobby');
wireThemePicker($('#lobby-theme-picker'));
$('#lobby-personal').innerHTML = personalControls('lobby');
document.addEventListener('tablemate-prefs-loaded', () => {
  themePreference = document.documentElement.dataset.themePreference || 'felt';
  $('#lobby-theme-picker').innerHTML = themePickerMarkup('lobby');
  wireThemePicker($('#lobby-theme-picker'));
  $('#lobby-personal').innerHTML = personalControls('lobby');
  if (state) render();
});
applyInviteCodeFromQuery();
setButtons(); socket.connect();
})();
