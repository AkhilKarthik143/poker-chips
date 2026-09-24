/* global io, document, navigator, localStorage, setTimeout, clearTimeout, setInterval, ResizeObserver */
const $ = selector => document.querySelector(selector);
const socket = io({ autoConnect: false });
const STORAGE_KEY = 'tablemate-seat-v1';
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
let seatListView = false;
let seatMessage = '';
let savedOrderKey = '';
let dragSeat = null;
const ellipseObserver = new ResizeObserver(() => positionSeats());
const number = value => Number(value).toLocaleString();
const snapToBlind = (value, blind) => Math.ceil(value / blind) * blind;
const sliderPosition = (amount, min, max) => max <= min ? 0 : Math.round((Math.log(amount / min) / Math.log(max / min)) * 100);
const sliderAmount = (position, min, max, blind) => snapToBlind(min * Math.pow(max / min, position / 100), blind);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
try { identity = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { identity = null; }
function saveIdentity(value) {
  identity = value;
  try { if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); else localStorage.removeItem(STORAGE_KEY); }
  catch { toast('Browser storage is unavailable. Keep this tab open to preserve your seat.'); }
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}
function status(text, connected = false) {
  $('#connection').textContent = text;
  $('#connection').className = `connection ${connected ? 'online' : 'offline'}`;
}
async function request(event, data = {}) {
  if (!socket.connected) throw new Error('Connection lost. Your seat is saved; waiting to reconnect.');
  return new Promise((resolve, reject) => socket.timeout(8000).emit(event, { revision: state?.revision, ...data }, (error, result) => {
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
  if (busy || !ready) document.querySelectorAll('#table button, #table input, #table select').forEach(el => { el.disabled = true; });
}
function receive(value) {
  // Socket.IO keeps packet order; revision also guards delayed acknowledgement state.
  if (state && value.roomCode === state.roomCode && value.revision < state.revision) return;
  state = value; serverOffset = value.serverTime - Date.now();
  if (savedOrderKey !== JSON.stringify(state.seatOrder)) { seatDraft = [...state.seatOrder]; savedOrderKey = JSON.stringify(state.seatOrder); }
  if (!seatDraft || seatDraft.some(id => !state.seatOrder.includes(id)) || seatDraft.length !== state.seatOrder.length) seatDraft = [...state.seatOrder];
  if (state.turn === state.playerId && lastTurn !== state.turn && ready && typeof navigator.vibrate === 'function') navigator.vibrate([90, 50, 90]);
  if (lastTurn !== state.turn) raiseOpen = false;
  lastTurn = state.turn;
  render();
}
function reset(message) {
  state = null; lastTurn = null; raiseOpen = false; saveIdentity(null);
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
    } catch (error) {
      if (error.transient || !socket.connected) {
        toast(error.message); socket.disconnect(); socket.connect(); return;
      }
      reset(error.message); ready = true; status('Connected', true);
    }
  } else ready = true;
  setButtons();
});
socket.on('disconnect', () => { ready = false; status('Reconnecting'); if (state) render(); setButtons(); });
socket.on('connect_error', () => { ready = false; status('Offline · retrying'); setButtons(); });
socket.on('state', receive);
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
  $('#create-fields').hidden = mode !== 'create'; $('#join-fields').hidden = mode !== 'join';
  $('#room-code').required = mode === 'join';
  $('#create-fields').querySelectorAll('input, select').forEach(el => { el.disabled = mode !== 'create'; });
  $('#entry-submit').innerHTML = `${mode === 'create' ? 'Create a table' : 'Take a seat'} <span aria-hidden="true">↗</span>`;
  $('#entry-caption').textContent = mode === 'create' ? 'You’re the host. House rules, your call.' : 'Same table code. Same good company.';
}
$('#create-tab').addEventListener('click', () => entryMode('create'));
$('#join-tab').addEventListener('click', () => entryMode('join'));
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !ready) return;
  busy = true; setButtons();
  try {
    const data = { name: $('#name').value.trim() };
    if (mode === 'create') data.settings = { startingStack: Number($('#starting-stack').value), smallBlind: Number($('#small-blind').value), bigBlind: Number($('#big-blind').value), blindMinutes: Number($('#blind-minutes').value) };
    else { data.code = $('#room-code').value.trim().toUpperCase(); await previewJoin(data); return; }
    const result = await request(mode, data);
    saveIdentity({ code: result.roomCode, playerId: result.playerId, token: result.token });
    receive(result.state); status('At the table', true);
  } catch (error) { toast(error.message); }
  finally { busy = false; if (state) render(); setButtons(); }
});

function showDialog(title, content, onConfirm, confirmLabel = 'Confirm') {
  const dialog = $('#seat-dialog');
  dialog.innerHTML = `<form id="dialog-form"><h2 id="dialog-title">${escape(title)}</h2>${content}<p id="dialog-error" role="alert"></p><div class="dialog-actions"><button type="button" id="dialog-close">Cancel</button><button type="submit" class="primary">${confirmLabel}</button></div></form>`;
  $('#dialog-close').onclick = () => dialog.close();
  $('#dialog-form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try { await onConfirm(); dialog.close(); } catch (error) { $('#dialog-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  if (!dialog.open) dialog.showModal();
}
async function previewJoin(data) {
  const info = await request('table-preview', { code: data.code });
  showDialog(`Join table ${data.code}`, `<p>${info.players}/10 players · Blinds ${number(info.smallBlind)}/${number(info.bigBlind)}</p><label for="join-buy-in">Buy-in · virtual chips</label><input id="join-buy-in" value="${info.startingStack}" readonly><p class="helper">The host sets the buy-in for every new player. Confirm to take the next open seat.</p>`, async () => {
    const result = await request('join', { ...data, expectedBuyIn: info.startingStack });
    saveIdentity({ code: result.roomCode, playerId: result.playerId, token: result.token }); receive(result.state); status('At the table', true);
  }, 'Confirm & join');
}
function inviteDialog() {
  const host = state.hostId === state.playerId;
  showDialog(`Invite to table ${state.roomCode}`, `<p>Share this table code with a friend: <strong>${escape(state.roomCode)}</strong></p><label for="invite-buy-in">Buy-in · virtual chips</label><input id="invite-buy-in" type="number" min="1" max="1000000000" value="${state.settings.startingStack}" ${host ? '' : 'readonly'}><p class="helper">${host ? 'Before the first hand, changing the buy-in updates every seated player. Later, it applies to new players only.' : 'The host sets the buy-in. Friends enter the code using Join a table.'}</p>`, async () => {
    if (host && Number($('#invite-buy-in').value) !== state.settings.startingStack) {
      const result = await request('host-settings', { settings: { startingStack: Number($('#invite-buy-in').value) } }); receive(result.state);
    }
    try { await navigator.clipboard.writeText(state.roomCode); toast('Table code copied.'); } catch { toast(`Table code: ${state.roomCode}`); }
  }, host ? 'Confirm & copy code' : 'Copy code');
}
function openControls(target) {
  const panel = document.getElementById(state.hostId === state.playerId ? 'host-menu' : 'your-seat');
  panel.open = true;
  const control = document.getElementById(target) || panel.querySelector('summary');
  control.focus();

}
function handLog() {
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
  showdown: 'Reveal any remaining community cards, then your hole cards. The host selects winners below.',
  complete: 'Chips settled. Collect the cards and get ready for the next hand.'
};
function option(p) { return `<option value="${escape(p.id)}">${escape(p.name)} · ${number(p.stack)}</option>`; }
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
function seatOval(order, editing) {
  const playing = !['lobby', 'complete'].includes(state.street);
  const roles = editing ? nextAssignments(order, JSON.stringify(order) !== JSON.stringify(state.seatOrder)) : { D: state.players.find(p => p.seat === state.dealerSeat)?.id, SB: state.smallBlindId, BB: state.bigBlindId };
  return `<div class="seat-oval ${editing ? 'reorder-oval' : 'live-oval'}" aria-label="${editing ? 'Arrange seats' : 'Clockwise seat order'}"><div class="table-felt" aria-hidden="true"></div>${Array.from({ length: 10 }, (_, index) => {
    const orderIndex = order.findIndex((_id, i) => Math.floor(i * 10 / order.length) === index);
    const p = state.players.find(player => player.id === order[orderIndex]);
    if (!p) return `<button type="button" class="oval-seat slot-${index} open-seat" data-open-seat ${playing || editing ? 'disabled' : ''}><strong>+ Open seat</strong><small>${index + 1}</small></button>`;
    const status = playing && p.folded ? '× Folded' : playing && p.inHand && p.stack === 0 ? '◆ All-in' : p.sittingOut ? 'Ⅱ Away' : !p.connected ? '○ Offline' : p.id === state.turn ? '▶ To act' : playing ? '● In hand' : '✓ Ready';
    return `<article class="oval-seat slot-${index} ${!editing && p.id === state.turn ? 'acting' : ''} ${p.id === state.playerId ? 'my-seat' : ''} ${playing && p.folded ? 'folded-seat' : ''}" ${editing ? `data-drag-seat="${orderIndex}"` : ''}><div class="oval-name"><small>${orderIndex + 1}</small><strong title="${escape(p.name)}">${escape(p.name)}</strong></div><span class="seat-owner">${p.id === state.playerId ? `You • Seat ${orderIndex + 1}` : `Seat ${orderIndex + 1}`}</span><div class="seat-roles">${Object.entries(roles).filter(([, id]) => id === p.id).map(([role]) => `<span class="role-${role}" title="${role === 'D' ? 'Dealer' : role === 'SB' ? 'Small blind' : 'Big blind'}">${role}</span>`).join('')}</div><strong class="oval-stack">${number(p.stack)}</strong><small>Bet ${number(p.streetBet)}</small><span class="oval-status ${!playing && p.connected && !p.sittingOut ? 'ready-pill' : ''}">${status}</span></article>`;
  }).join('')}</div>`;
}
function positionSeats() {
  document.querySelectorAll('.seat-oval').forEach(oval => {
    const width = oval.clientWidth;
    const occupied = oval.querySelectorAll('.oval-seat:not(.open-seat)').length;
    const cardWidth = Math.min(140, Math.floor((width - 24) / 4.5));
    const height = occupied <= 2 ? 380 : occupied <= 4 ? 440 : 540;
    const rx = (width - cardWidth - 12) / 2;
    const ry = (height - 112) / 2;
    oval.style.height = `${height}px`;
    const mine = oval.querySelector('.my-seat');
    const ownSlot = mine ? Number([...mine.classList].find(c => c.startsWith('slot-')).slice(5)) : 0;
    oval.querySelectorAll('.oval-seat').forEach(seat => {
      const slot = Number([...seat.classList].find(c => c.startsWith('slot-')).slice(5));
      const angle = Math.PI / 2 + 2 * Math.PI * (slot - ownSlot) / 10;
      seat.style.left = `${width / 2 + rx * Math.cos(angle)}px`;
      seat.style.top = `${height / 2 + ry * Math.sin(angle)}px`;
      seat.style.width = `${cardWidth}px`;
      const stack = seat.querySelector('.oval-stack');
      if (stack) stack.style.fontSize = `${Math.min(22, (cardWidth - 14) / (stack.textContent.length * .65))}px`;
    });
    const felt = oval.querySelector('.table-felt');
    felt.style.width = `${2 * rx}px`; felt.style.height = `${2 * ry}px`;
  });
}
function render() {
  if (!state) return;
  const me = state.players.find(p => p.id === state.playerId);
  if (!me) return;
  const host = state.hostId === state.playerId;
  const playing = !['lobby', 'complete'].includes(state.street);
  const actor = state.players.find(p => p.id === state.turn);
  const total = state.players.reduce((sum, p) => sum + p.contributed, 0);
  const detailsOpen = new Set([...document.querySelectorAll('#table details[open]')].map(el => el.id));
  const choices = [...document.querySelectorAll('.winner-form input:checked')].map(el => el.id);
  document.body.classList.add('in-game');
  $('#lobby').hidden = true; $('#site-footer').hidden = true; $('#table').hidden = false;
  $('#table').innerHTML = `
    ${!ready ? '<div class="reconnect-banner" role="status">Reconnecting… Your seat and chips are saved. Actions will return when the table is in sync.</div>' : ''}
    <header class="table-heading"><h1>Table <strong>${escape(state.roomCode)}</strong></h1><span>${state.players.length}/10 players</span><span>Blinds <strong>${number(state.settings.smallBlind)}/${number(state.settings.bigBlind)}</strong></span><button id="copy-code">Copy code</button><button id="table-settings">${host ? 'Settings' : 'Your seat'}</button></header>
    <div class="table-layout"><section class="play-area" aria-label="Poker table">
      <div class="table-stage"><div class="pot-board ${playing ? 'live-pot' : 'waiting-pot'}"><div class="streets" aria-label="Betting street">${['preflop', 'flop', 'turn', 'river', 'showdown'].map(street => `<span class="${state.street === street ? 'current' : ''}" ${state.street === street ? 'aria-current="step"' : ''}>${state.street === street ? '• ' : ''}${street.toUpperCase()}</span>`).join('')}</div>
        ${playing ? `<p class="pot-label">Hand ${state.handNumber} · Total pot</p><div class="pot-number">${number(total)}</div><span class="pot-unit">CHIPS</span>` : `<p class="pot-label">${state.street === 'complete' ? 'Hand complete' : 'Your table is open'}</p><h2>${state.players.length < 2 ? 'Waiting for players' : host ? 'Ready to deal' : 'Waiting for host to start'}</h2><p>${state.players.filter(p => p.stack > 0 && !p.sittingOut).length} players ready</p>`}
        <p class="street-instruction" aria-live="polite">${instructions[state.street]}</p>
        ${state.street === 'showdown' && state.pots.length > 1 ? `<div class="pot-summary">${state.pots.map((p, i) => `<span>${i ? `Side pot ${i}` : 'Main pot'} · ${number(p.amount)}</span>`).join('')}</div>` : ''}</div>
      ${seatOval(state.seatOrder, false)}</div><div class="table-meta"><span>Action moves clockwise</span><span id="blind-clock"></span></div>
      ${state.lastResult && state.street === 'complete' ? `<section class="result"><h2>That’s a hand.</h2>${state.lastResult.awards.map(a => `<p>${escape(state.players.find(p => p.id === a.id)?.name || 'Departed player')} <strong>+${number(a.amount)}</strong> · ${escape(a.label)}</p>`).join('')}</section>` : ''}
      ${state.street === 'showdown' ? `<section class="showdown"><h2>Who takes the pot?</h2><p class="helper">${host ? 'Select every tied winner for each pot. Chips settle after all pots are assigned; odd chips go left of the dealer.' : 'The host is selecting winners from the physical cards.'}</p>${state.pots.map((pot, index) => `<form class="winner-form" data-pot="${pot.id}"><h3>${index ? `Side pot ${index}` : 'Main pot'} · ${number(pot.amount)} chips</h3>${pot.winners ? `<p class="helper">Selected: ${pot.winners.map(id => escape(state.players.find(p => p.id === id).name)).join(' + ')}</p>` : pot.eligible.map(id => `<label for="winner-${pot.id}-${id}"><input id="winner-${pot.id}-${id}" type="checkbox" name="winner" value="${escape(id)}" ${!host ? 'disabled' : ''}>${escape(state.players.find(p => p.id === id).name)}</label>`).join('')}${host && !pot.winners ? '<button class="primary" type="submit">Confirm winner(s)</button>' : ''}</form>`).join('')}</section>` : ''}
    </section><aside class="sidebar">
      <details class="panel" id="players-panel" open><summary>Players <span>${state.players.length}/10</span></summary><ul class="players-list">${state.seatOrder.map(id => { const p = state.players.find(p => p.id === id); return `<li><strong>${escape(p.name)}${p.id === state.playerId ? ' · You' : ''}</strong><span>${p.sittingOut ? 'Ⅱ Away' : p.connected ? '✓ Connected' : '○ Offline'}</span></li>`; }).join('')}</ul></details>
      <details class="panel" id="hand-log"><summary>Hand log <span>Hand ${state.handNumber}</span></summary><ol class="log-list">${handLog()}</ol></details>
      ${host ? hostPanel(playing, actor) : ''}
      <details class="panel" id="your-seat"><summary>Your seat</summary><div class="panel-content"><p class="helper">${playing ? 'Sit out applies from the next hand. Leave and rebuy between hands.' : 'Ask your host for a rebuy or add-on.'}</p><button id="sit-out">${me.sittingOut ? 'Play next hand' : 'Sit out next hand'}</button><button id="leave" class="quiet danger" ${playing ? 'disabled' : ''}>Leave table</button></div></details>
    </aside></div>
    <section class="dock" aria-label="Your betting controls"><div class="dock-inner"><div class="dock-summary"><div class="turn-label ${state.legal.active ? '' : 'waiting'}" role="status">${!ready ? 'RECONNECTING' : state.legal.active ? 'YOUR TURN' : state.street === 'showdown' ? 'SHOWDOWN' : actor ? `${escape(actor.name).toUpperCase()} TO ACT` : host ? 'HOST · TABLE CONTROLS' : 'WAITING FOR HOST'}</div><div class="balance"><span>Your stack</span><strong>${number(me.stack)}</strong></div><div class="balance"><span>To call</span><strong>${number(state.legal.toCall)}</strong></div></div>
      ${!playing ? `<div class="lobby-actions"><button id="invite-players">Invite players</button><button id="change-seat">Change seat</button><button id="set-buy-in">${host ? 'Set buy-in' : 'View buy-in'}</button>${host ? `<button id="start-hand" class="primary" ${state.players.filter(p => p.stack > 0 && !p.sittingOut).length < 2 ? 'disabled' : ''}>${state.handNumber ? 'Start next hand' : 'Start game'} →</button>` : '<span class="helper">Your host starts the hand.</span>'}</div>` : ''}
      ${state.turn ? `<div class="actions"><button data-action="fold" class="quiet" ${!state.legal.active ? 'disabled' : ''}>Fold</button><button data-action="${state.legal.canCheck ? 'check' : 'call'}" class="primary" ${!state.legal.active ? 'disabled' : ''}>${state.legal.canCheck ? 'Check' : `Call ${number(state.legal.toCall)}`}</button><button id="toggle-raise" aria-expanded="${raiseOpen}" ${!state.legal.canRaise ? 'disabled' : ''}>${state.currentBet ? 'Raise' : 'Bet'}</button><button data-action="all-in" class="all-in" ${!state.legal.canAllIn ? 'disabled' : ''}>All-in</button></div>` : ''}
      ${raiseOpen && state.legal.canRaise ? (() => { const min = Math.min(state.legal.minRaiseTo, state.legal.maxRaiseTo); const max = state.legal.maxRaiseTo; return `<form id="raise-form" class="raise-panel"><div><label for="raise-amount">${state.currentBet ? 'Raise' : 'Bet'} to · multiples of ${number(state.settings.smallBlind)}</label><div class="raise-controls"><input id="raise-range" type="range" aria-label="Raise amount slider (logarithmic)" min="0" max="100" value="${sliderPosition(min, min, max)}" step="1" data-min="${min}" data-max="${max}" data-blind="${state.settings.smallBlind}"><input id="raise-amount" aria-label="Raise to amount" type="number" min="${min}" max="${max}" value="${min}" step="${state.settings.smallBlind}" required></div></div><button class="primary raise-submit" type="submit">Confirm</button><div class="quick-bets"><button type="button" data-quick="min">Min</button><button type="button" data-quick="half">½ pot</button><button type="button" data-quick="pot">Pot</button><button type="button" data-quick="three-quarter">¾ pot</button><button type="button" data-quick="all">All-in</button></div></form>`; })() : ''}
    </div></section>`;
  for (const id of detailsOpen) { const el = document.getElementById(id); if (el) el.open = true; }
  for (const id of choices) { const el = document.getElementById(id); if (el) el.checked = true; }
  wireTable(me, total); updateClock(); setButtons();
  ellipseObserver.disconnect();
  document.querySelectorAll('.seat-oval').forEach(el => ellipseObserver.observe(el));
  positionSeats();
}
function hostPanel(playing, actor) {
  const changed = JSON.stringify(seatDraft) !== JSON.stringify(state.seatOrder);
  const reorderDisabled = playing || seatDraft.length < 2 || !changed;
  const preview = nextAssignments(seatDraft, changed);
  const reorderRows = seatDraft.map((id, index) => `<li><span>${index + 1}. ${escape(state.players.find(p => p.id === id).name)}</span><button type="button" aria-label="Move seat ${index + 1} up" data-seat-move="up" data-seat-index="${index}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" aria-label="Move seat ${index + 1} down" data-seat-move="down" data-seat-index="${index}" ${index === seatDraft.length - 1 ? 'disabled' : ''}>↓</button></li>`).join('');
  return `<details class="panel" id="host-menu"><summary>Host controls</summary><div class="panel-content"><button id="undo" ${!state.canUndo ? 'disabled' : ''}>Undo last action</button>${actor && !actor.connected ? '<button id="host-fold" class="danger">Fold disconnected player</button>' : ''}<p class="helper">${playing ? 'Settings and seat order are available between hands.' : 'Changes to the starting stack apply to new seats. Before the first hand, they apply to everyone.'}</p>
    <section class="seat-order"><h3>Seat order</h3>${playing ? '<p class="helper">Available between hands.</p>' : `<p class="helper">Drag a seat onto another to move it clockwise. Saving restarts the button at the first eligible seat.</p><button id="seat-view" aria-pressed="${seatListView}">${seatListView ? 'Table view' : 'List view'}</button>${seatListView ? `<ol>${reorderRows}</ol>` : seatOval(seatDraft, true)}<p class="helper" id="next-seats">Next hand: ${['D', 'SB', 'BB'].map(role => `${role}: ${escape(state.players.find(p => p.id === preview[role])?.name || '—')}`).join(' · ')}</p><button id="save-seat-order" class="primary" ${reorderDisabled ? 'disabled' : ''}>Save order</button>`}<p class="helper" id="seat-message" role="status">${escape(seatMessage)}</p></section>
    <form id="settings-form"><div class="form-grid"><div><label for="host-stack">Starting stack</label><input id="host-stack" type="number" min="1" max="1000000000" value="${state.settings.startingStack}" ${playing ? 'disabled' : ''} required></div><div><label for="host-timer">Timer (minutes)</label><input id="host-timer" type="number" min="0" max="1440" value="${state.settings.blindMinutes}" ${playing ? 'disabled' : ''} required></div><div><label for="host-sb">Small blind</label><input id="host-sb" type="number" min="1" value="${state.settings.smallBlind}" ${playing ? 'disabled' : ''} required></div><div><label for="host-bb">Big blind</label><input id="host-bb" type="number" min="1" value="${state.settings.bigBlind}" ${playing ? 'disabled' : ''} required></div></div><button type="submit" ${playing ? 'disabled' : ''}>Save table settings</button></form>
    <form id="rebuy-form"><label for="rebuy-player">Rebuy / add-on</label><select id="rebuy-player" ${playing ? 'disabled' : ''}>${state.players.map(option).join('')}</select><label for="rebuy-amount">Chips to add</label><input id="rebuy-amount" type="number" min="1" max="1000000000" value="${state.settings.startingStack}" ${playing ? 'disabled' : ''} required><button type="submit" ${playing ? 'disabled' : ''}>Add chips</button></form>
    ${state.players.length > 1 ? `<form id="kick-form"><label for="kick-player">Remove a player</label><select id="kick-player" ${playing ? 'disabled' : ''}>${state.players.filter(p => p.id !== state.playerId).map(option).join('')}</select><button class="danger quiet" type="submit" ${playing ? 'disabled' : ''}>Remove selected player</button></form>` : ''}</div></details>`;
}
function wireTable(me, pot) {
  $('#copy-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.roomCode); toast(`Table code ${state.roomCode} copied.`); }
    catch { toast(`Your table code is ${state.roomCode}.`); }
  });
  $('#table-settings').addEventListener('click', () => openControls('host-stack'));
  $('#invite-players')?.addEventListener('click', inviteDialog);
  $('#set-buy-in')?.addEventListener('click', inviteDialog);
  $('#change-seat')?.addEventListener('click', () => { openControls('seat-view'); if (state.hostId !== state.playerId) toast('Ask the host to change the seat order between hands.'); });
  document.querySelectorAll('[data-open-seat]').forEach(button => button.addEventListener('click', inviteDialog));
  $('#start-hand')?.addEventListener('click', () => run('start-hand'));
  $('#undo')?.addEventListener('click', () => run('undo'));
  $('#host-fold')?.addEventListener('click', () => run('host-fold'));
  document.querySelectorAll('[data-seat-move]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.seatIndex); const swap = button.dataset.seatMove === 'up' ? index - 1 : index + 1;
    [seatDraft[index], seatDraft[swap]] = [seatDraft[swap], seatDraft[index]]; render();
  }));
  $('#seat-view')?.addEventListener('click', () => { seatListView = !seatListView; render(); });
  $('#save-seat-order')?.addEventListener('click', async () => {
    if (busy || !ready) return;
    busy = true; setButtons();
    try { const result = await request('host:reorderSeats', { order: [...seatDraft] }); seatMessage = 'Seat order saved.'; receive(result.state); }
    catch (error) { seatMessage = error.message; }
    finally { busy = false; render(); }
  });
  const oval = document.querySelector('.reorder-oval');
  oval?.addEventListener('pointerdown', event => {
    const seat = event.target.closest('[data-drag-seat]');
    if (!seat || busy || !ready) return;
    dragSeat = { from: Number(seat.dataset.dragSeat), to: Number(seat.dataset.dragSeat), pointer: event.pointerId };
    seat.classList.add('drag-source'); oval.setPointerCapture(event.pointerId); event.preventDefault();
  });
  oval?.addEventListener('pointermove', event => {
    if (!dragSeat) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-drag-seat]');
    oval.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    if (target && oval.contains(target)) { dragSeat.to = Number(target.dataset.dragSeat); target.classList.add('drop-target'); target.setAttribute('data-drop-name', state.players.find(p => p.id === seatDraft[dragSeat.from]).name); }
  });
  oval?.addEventListener('pointerup', () => {
    if (!dragSeat) return;
    const [id] = seatDraft.splice(dragSeat.from, 1); seatDraft.splice(dragSeat.to, 0, id); dragSeat = null; render();
  });
  oval?.addEventListener('pointercancel', () => { dragSeat = null; render(); });
  $('#sit-out').addEventListener('click', () => run('sit-out', { value: !me.sittingOut }));
  $('#leave').addEventListener('click', () => run('leave'));
  document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => run('action', { type: el.dataset.action })));
  $('#toggle-raise')?.addEventListener('click', () => { raiseOpen = !raiseOpen; render(); });
  $('#raise-amount')?.addEventListener('input', e => { const range = $('#raise-range'); const amount = Math.min(Number(range.dataset.max), Math.max(Number(range.dataset.min), snapToBlind(Number(e.target.value), Number(range.dataset.blind)))); e.target.value = amount; range.value = sliderPosition(amount, Number(range.dataset.min), Number(range.dataset.max)); });
  $('#raise-range')?.addEventListener('input', e => { const range = e.target; $('#raise-amount').value = sliderAmount(Number(range.value), Number(range.dataset.min), Number(range.dataset.max), Number(range.dataset.blind)); });
  document.querySelectorAll('[data-quick]').forEach(el => el.addEventListener('click', () => {
    const min = state.legal.minRaiseTo; const max = state.legal.maxRaiseTo;
    const sb = state.settings.smallBlind;
    const snap = value => snapToBlind(value, sb);
    const amounts = { min, half: snap(state.currentBet + (pot + state.legal.fullToCall) / 2), pot: snap(state.currentBet + pot + state.legal.fullToCall), 'three-quarter': snap(state.currentBet + (pot + state.legal.fullToCall) * .75), all: max };
    const amount = Math.min(max, Math.max(min, amounts[el.dataset.quick]));
    $('#raise-amount').value = amount; $('#raise-range').value = sliderPosition(amount, min, max);
  }));
  $('#raise-form')?.addEventListener('submit', event => { event.preventDefault(); run('action', { type: 'raise', amount: Number($('#raise-amount').value) }); });
  $('#settings-form')?.addEventListener('submit', event => {
    event.preventDefault(); run('host-settings', { settings: { startingStack: Number($('#host-stack').value), smallBlind: Number($('#host-sb').value), bigBlind: Number($('#host-bb').value), blindMinutes: Number($('#host-timer').value) } });
  });
  $('#rebuy-form')?.addEventListener('submit', event => { event.preventDefault(); run('rebuy', { playerId: $('#rebuy-player').value, amount: Number($('#rebuy-amount').value) }); });
  $('#kick-form')?.addEventListener('submit', event => { event.preventDefault(); run('kick', { playerId: $('#kick-player').value }); });
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
setInterval(updateClock, 1000);
setButtons(); socket.connect();
