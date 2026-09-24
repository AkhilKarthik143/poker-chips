/* global io, document, navigator, localStorage, setTimeout, clearTimeout, setInterval */
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
    else data.code = $('#room-code').value.trim().toUpperCase();
    const result = await request(mode, data);
    saveIdentity({ code: result.roomCode, playerId: result.playerId, token: result.token });
    receive(result.state); status('At the table', true);
  } catch (error) { toast(error.message); }
  finally { busy = false; if (state) render(); setButtons(); }
});

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
  return `<div class="seat-oval ${editing ? 'reorder-oval' : 'live-oval'}" aria-label="${editing ? 'Arrange seats' : 'Clockwise seat order'}"><div class="table-felt"><span>↻</span><small>CLOCKWISE</small>${editing ? '<small>NEXT HAND</small>' : ''}</div>${Array.from({ length: 10 }, (_, index) => {
    const p = state.players.find(player => player.id === order[index]);
    if (!p) return `<article class="oval-seat slot-${index} open-seat"><small>${index + 1}</small><span>Open seat</span></article>`;
    const status = playing && p.folded ? 'Folded' : playing && p.inHand && p.stack === 0 ? 'All-in' : p.sittingOut ? 'Sitting out' : !p.connected ? 'Disconnected' : p.id === state.turn ? 'To act' : 'Ready';
    return `<article class="oval-seat slot-${index} ${!editing && p.id === state.turn ? 'acting' : ''}" ${editing ? `data-drag-seat="${index}"` : ''}><div class="oval-name"><small>${index + 1}</small><strong>${escape(p.name)}</strong></div><div class="seat-roles">${Object.entries(roles).filter(([, id]) => id === p.id).map(([role]) => `<span class="role-${role}" title="${role === 'D' ? 'Dealer' : role === 'SB' ? 'Small blind' : 'Big blind'}">${role}</span>`).join('')}</div><strong class="oval-stack">${number(p.stack)}</strong><small>Bet ${number(p.streetBet)}</small><span class="oval-status">${status}</span></article>`;
  }).join('')}</div>`;
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
  $('#lobby').hidden = true; $('#site-footer').hidden = true; $('#table').hidden = false;
  $('#table').innerHTML = `
    ${!ready ? '<div class="reconnect-banner" role="status">Reconnecting… Your seat and chips are saved. Actions will return when the table is in sync.</div>' : ''}
    <div class="table-heading"><div><p class="eyebrow">PHYSICAL CARDS. VIRTUAL CHIPS.</p><h1>${state.street === 'lobby' ? 'Good company, good game.' : `Hand ${String(state.handNumber).padStart(2, '0')}`}</h1></div>
      <button class="room-button quiet" id="copy-code" aria-label="Copy table code ${escape(state.roomCode)}"><span>TABLE CODE<br>Tap to copy</span><strong>${escape(state.roomCode)}</strong></button></div>
    <div class="table-layout"><section class="play-area" aria-label="Poker table">
      <div class="pot-board"><div class="streets" aria-label="Betting street">${['preflop', 'flop', 'turn', 'river', 'showdown'].map(street => `<span class="${state.street === street ? 'current' : ''}" ${state.street === street ? 'aria-current="step"' : ''}>${street.toUpperCase()}</span>`).join('')}</div>
        <p class="pot-label">${state.street === 'complete' ? 'Last hand’s pot' : 'In the middle'}</p><div class="pot-number">${number(state.street === 'complete' ? state.lastResult.total : total)}</div>
        <p class="street-instruction" aria-live="polite">${instructions[state.street]}</p>
        ${state.street === 'showdown' && state.pots.length > 1 ? `<div class="pot-summary">${state.pots.map((p, i) => `<span>${i ? `Side pot ${i}` : 'Main pot'} · ${number(p.amount)}</span>`).join('')}</div>` : ''}</div>
      <div class="table-meta"><span>${state.players.length}/10 seated · Blinds ${number(state.settings.smallBlind)}/${number(state.settings.bigBlind)}</span><span id="blind-clock"></span></div>
      ${seatOval(state.seatOrder, false)}
      ${state.lastResult && state.street === 'complete' ? `<section class="result"><h2>That’s a hand.</h2>${state.lastResult.awards.map(a => `<p>${escape(state.players.find(p => p.id === a.id)?.name || 'Departed player')} <strong>+${number(a.amount)}</strong> · ${escape(a.label)}</p>`).join('')}</section>` : ''}
      ${!playing ? `<div class="start-panel"><p>${host ? 'Deal the physical hole cards, then start betting. The button and blinds move automatically.' : 'Get your cards ready. Your host will start the next hand.'}</p>${host ? `<button id="start-hand" class="primary" ${state.players.filter(p => p.stack > 0 && !p.sittingOut).length < 2 ? 'disabled' : ''}>${state.handNumber ? 'Start next hand' : 'Start first hand'} <span aria-hidden="true">→</span></button>` : ''}</div>` : ''}
      ${state.street === 'showdown' ? `<section class="showdown"><h2>Who takes the pot?</h2><p class="helper">${host ? 'Select every tied winner for each pot. Chips settle after all pots are assigned; odd chips go left of the dealer.' : 'The host is selecting winners from the physical cards.'}</p>${state.pots.map((pot, index) => `<form class="winner-form" data-pot="${pot.id}"><h3>${index ? `Side pot ${index}` : 'Main pot'} · ${number(pot.amount)} chips</h3>${pot.winners ? `<p class="helper">Selected: ${pot.winners.map(id => escape(state.players.find(p => p.id === id).name)).join(' + ')}</p>` : pot.eligible.map(id => `<label for="winner-${pot.id}-${id}"><input id="winner-${pot.id}-${id}" type="checkbox" name="winner" value="${escape(id)}" ${!host ? 'disabled' : ''}>${escape(state.players.find(p => p.id === id).name)}</label>`).join('')}${host && !pot.winners ? '<button class="primary" type="submit">Confirm winner(s)</button>' : ''}</form>`).join('')}</section>` : ''}
    </section><aside class="sidebar">
      <section class="panel"><h2 class="panel-title">From the table <span class="eyebrow"> / HAND LOG</span></h2><ol class="log-list">${state.log.slice().reverse().map(item => `<li><small>${item.hand ? `HAND ${String(item.hand).padStart(2, '0')}` : 'LOBBY'} · ${escape(item.street).toUpperCase()} · POT ${number(item.pot)}</small>${escape(item.text)}</li>`).join('')}</ol></section>
      ${host ? hostPanel(playing, actor) : ''}
      <details class="panel" id="your-seat"><summary>Your seat</summary><div class="panel-content"><p class="helper">${playing ? 'Sit out applies from the next hand. Leave and rebuy between hands.' : 'Ask your host for a rebuy or add-on.'}</p><button id="sit-out">${me.sittingOut ? 'Play next hand' : 'Sit out next hand'}</button><button id="leave" class="quiet danger" ${playing ? 'disabled' : ''}>Leave table</button></div></details>
    </aside></div>
    <section class="dock" aria-label="Your betting controls"><div class="dock-inner"><div class="dock-summary"><div class="turn-label ${state.legal.active ? '' : 'waiting'}" role="status">${!ready ? 'RECONNECTING' : state.legal.active ? 'YOUR TURN' : state.street === 'showdown' ? 'SHOWDOWN' : actor ? `${escape(actor.name).toUpperCase()} TO ACT` : 'MAKE YOURSELF AT HOME'}</div><div class="balance"><span>Your stack</span><strong>${number(me.stack)}</strong></div><div class="balance"><span>To call</span><strong>${number(state.legal.toCall)}</strong></div></div>
      ${state.turn ? `<div class="actions"><button data-action="fold" class="quiet" ${!state.legal.active ? 'disabled' : ''}>Fold</button><button data-action="${state.legal.canCheck ? 'check' : 'call'}" class="primary" ${!state.legal.active ? 'disabled' : ''}>${state.legal.canCheck ? 'Check' : `Call ${number(state.legal.toCall)}`}</button><button id="toggle-raise" aria-expanded="${raiseOpen}" ${!state.legal.canRaise ? 'disabled' : ''}>${state.currentBet ? 'Raise' : 'Bet'}</button><button data-action="all-in" class="all-in" ${!state.legal.canAllIn ? 'disabled' : ''}>All-in</button></div>` : ''}
      ${raiseOpen && state.legal.canRaise ? (() => { const min = Math.min(state.legal.minRaiseTo, state.legal.maxRaiseTo); const max = state.legal.maxRaiseTo; return `<form id="raise-form" class="raise-panel"><div><label for="raise-amount">${state.currentBet ? 'Raise' : 'Bet'} to · multiples of ${number(state.settings.smallBlind)}</label><div class="raise-controls"><input id="raise-range" type="range" aria-label="Raise amount slider (logarithmic)" min="0" max="100" value="${sliderPosition(min, min, max)}" step="1" data-min="${min}" data-max="${max}" data-blind="${state.settings.smallBlind}"><input id="raise-amount" aria-label="Raise to amount" type="number" min="${min}" max="${max}" value="${min}" step="${state.settings.smallBlind}" required></div></div><button class="primary raise-submit" type="submit">Confirm</button><div class="quick-bets"><button type="button" data-quick="min">Min</button><button type="button" data-quick="half">½ pot</button><button type="button" data-quick="pot">Pot</button><button type="button" data-quick="three-quarter">¾ pot</button><button type="button" data-quick="all">All-in</button></div></form>`; })() : ''}
    </div></section>`;
  for (const id of detailsOpen) { const el = document.getElementById(id); if (el) el.open = true; }
  for (const id of choices) { const el = document.getElementById(id); if (el) el.checked = true; }
  wireTable(me, total); updateClock(); setButtons();
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
