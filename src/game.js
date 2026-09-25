import { RequestError, validName, normalizedName } from './validation.js';
/** Pure, immutable Hold'em chip accounting. IDs and time are supplied by callers. */
export const STREETS = ['preflop', 'flop', 'turn', 'river'];
const MAX_CHIPS = 1_000_000_000_000;
const MAX_SETTING = 1_000_000_000;
const check = (condition, message) => { if (!condition) throw new RequestError(message); };
const integer = (n, min = 1, max = MAX_CHIPS) => Number.isSafeInteger(n) && n >= min && n <= max;
export const isPlaying = state => STREETS.includes(state.street) || state.street === 'showdown';
const player = (state, id) => {
  const found = state.players.find(p => p.id === id);
  check(found, 'Player not found.');
  return found;
};
const live = state => state.players.filter(p => p.inHand && !p.folded);
const able = state => live(state).filter(p => p.stack > 0);
const clockwise = (players, seat) => [...players].sort((a, b) => ((a.seat - seat + 9) % 10) - ((b.seat - seat + 9) % 10));
const next = (players, seat) => clockwise(players, seat)[0];
const sumBets = state => state.players.reduce((sum, p) => sum + p.contributed, 0);
function log(state, text) {
  state.log.push({ hand: state.handNumber, street: state.street, text, pot: sumBets(state) });
  state.log = state.log.slice(-200);
}
function edit(state, fn, remember = false) {
  const snapshot = { ...state };
  delete snapshot.history;
  const copy = structuredClone(snapshot);
  copy.history = remember ? [...state.history.slice(-39), structuredClone(snapshot)] : [];
  fn(copy);
  assertConservation(copy);
  return copy;
}
function settings(input) {
  const value = { startingStack: 1000, smallBlind: 5, bigBlind: 10, blindMinutes: 0, ...input };
  check(integer(value.startingStack, 1, MAX_SETTING), 'Starting stack must be a positive whole number.');
  check(integer(value.smallBlind, 1, MAX_SETTING) && integer(value.bigBlind, 1, MAX_SETTING) && value.smallBlind <= value.bigBlind, 'Blinds must be positive whole numbers; small blind cannot exceed big blind.');
  check(value.bigBlind % value.smallBlind === 0, 'Big blind must be a multiple of the small blind.');
  check(integer(value.blindMinutes, 0, 1440), 'Blind timer must be 0–1440 whole minutes.');
  return value;
}
export function createTable(input = {}) {
  return { settings: settings(input), players: [], seatOrder: [], dealerSeat: -1, smallBlindId: null, bigBlindId: null,
    street: 'lobby', handNumber: 0, turn: null, currentBet: 0, minRaise: 0, pots: [],
    totalChips: 0, log: [], history: [], blindDeadline: null, lastResult: null };
}
export function assertConservation(state) {
  check(state.players.every(p => integer(p.stack, 0) && integer(p.contributed, 0)), 'Invalid chip accounting.');
  check(state.players.reduce((sum, p) => sum + p.stack + p.contributed, 0) === state.totalChips, 'Chip conservation failed.');
  return true;
}
export function addPlayer(state, id, name) {
  check(!isPlaying(state), 'Join between hands.');
  check(state.players.length < 10, 'This table has 10 players.');
  check(state.totalChips + state.settings.startingStack <= MAX_CHIPS, 'Table chip limit reached.');
  check(typeof id === 'string' && id.length > 0 && !state.players.some(p => p.id === id), 'Invalid or duplicate player.');
  check(validName(name), 'Name must be 1–20 characters without control characters or angle brackets.');
  name = normalizedName(name);
  check(!state.players.some(p => normalizedName(p.name).toLowerCase() === name.toLowerCase()), 'Name already taken in this room');
  return edit(state, s => {
    const seat = Array.from({ length: 10 }, (_, i) => i).find(i => !s.players.some(p => p.seat === i));
    s.players.push({ id, name: name.trim(), seat, stack: s.settings.startingStack, sittingOut: false,
      inHand: false, folded: false, streetBet: 0, contributed: 0, actedAt: null });
    s.totalChips += s.settings.startingStack;
    s.seatOrder = [...s.players].sort((a, b) => a.seat - b.seat).map(p => p.id);
    log(s, `${name.trim()} joined the table.`);
  });
}
export function configure(state, input) {
  check(!isPlaying(state), 'Change settings between hands.');
  const value = settings({ ...state.settings, ...input });
  return edit(state, s => {
    s.settings = value;
    s.blindDeadline = null;
    // Before the first deal the host's starting stack applies to every seat.
    if (s.handNumber === 0) {
      s.players.forEach(p => { p.stack = value.startingStack; });
      s.totalChips = s.players.length * value.startingStack;
    }
    log(s, 'Table settings updated.');
  });
}
export function rebuy(state, id, amount) {
  check(!isPlaying(state), 'Add chips between hands.');
  check(integer(amount, 1, MAX_SETTING) && state.totalChips + amount <= MAX_CHIPS, 'Invalid chip amount.');
  player(state, id);
  return edit(state, s => {
    const p = player(s, id);
    p.stack += amount;
    s.totalChips += amount;
    log(s, `${p.name} added ${amount} chips.`);
  });
}
/** Transfers are administrative: no new chips and no undo across the transfer. */
export function donate(state, senderId, recipientId, amount) {
  check(!isPlaying(state), 'Donate chips between hands.');
  check(senderId !== recipientId, 'Choose another player.');
  const sender = player(state, senderId);
  player(state, recipientId);
  check(integer(amount, 1) && amount <= sender.stack, 'Enter a positive whole number no greater than your stack.');
  return edit(state, s => {
    const from = player(s, senderId); const to = player(s, recipientId);
    from.stack -= amount; to.stack += amount;
    log(s, `${from.name} donated ${amount} chips to ${to.name}.`);
  });
}
export function setSitOut(state, id, value) {
  check(typeof value === 'boolean', 'Sit-out must be true or false.');
  return edit(state, s => {
    const p = player(s, id);
    p.sittingOut = value;
    log(s, `${p.name} will ${value ? 'sit out' : 'play'} next hand.`);
  });
}
export function removePlayer(state, id) {
  check(!isPlaying(state), 'Leave or kick between hands. Sit out now to skip the next hand.');
  return edit(state, s => {
    const p = player(s, id);
    s.totalChips -= p.stack;
    s.players = s.players.filter(p => p.id !== id);
    s.seatOrder = s.seatOrder.filter(playerId => playerId !== id);
    log(s, `${p.name} left with ${p.stack} chips.`);
  });
}
export function reorderSeats(state, newOrder) {
  check(!isPlaying(state), "Can't reorder seats mid-hand");
  check(Array.isArray(newOrder) && newOrder.length === state.players.length && new Set(newOrder).size === newOrder.length && newOrder.every(id => state.players.some(p => p.id === id)), 'Invalid player list.');
  return edit(state, s => {
    s.seatOrder = [...newOrder];
    s.seatOrder.forEach((id, seat) => { player(s, id).seat = seat; });
    // Reordering between hands resets the button to the first physical seat.
    s.dealerSeat = -1;
    log(s, 'Host reordered the seats.');
  });
}
function pay(state, p, amount) {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.streetBet += paid;
  p.contributed += paid;
  return paid;
}
export function startHand(state, now = 0) {
  check(!isPlaying(state), 'Finish the current hand first.');
  check(state.players.filter(p => !p.sittingOut && p.stack > 0).length >= 2, 'Need at least two players with chips.');
  check(Number.isFinite(now) && now >= 0, 'Invalid time.');
  return edit(state, s => {
    const period = s.settings.blindMinutes * 60_000;
    if (period) {
      if (s.blindDeadline === null) s.blindDeadline = now + period;
      if (now >= s.blindDeadline) {
        const levels = Math.floor((now - s.blindDeadline) / period) + 1;
        const factor = 2 ** Math.min(levels, 30);
        s.settings.smallBlind = Math.min(MAX_SETTING, s.settings.smallBlind * factor);
        s.settings.bigBlind = Math.min(MAX_SETTING, s.settings.bigBlind * factor);
        s.blindDeadline += levels * period;
        log(s, `Blinds increased to ${s.settings.smallBlind}/${s.settings.bigBlind}.`);
      }
    }
    s.players.forEach(p => Object.assign(p, { inHand: !p.sittingOut && p.stack > 0,
      folded: false, streetBet: 0, contributed: 0, actedAt: null }));
    const entrants = live(s);
    s.dealerSeat = next(entrants, s.dealerSeat).seat;
    const dealer = entrants.find(p => p.seat === s.dealerSeat);
    const sb = entrants.length === 2 ? dealer : next(entrants, dealer.seat);
    const bb = next(entrants, sb.seat);
    s.smallBlindId = sb.id;
    s.bigBlindId = bb.id;
    s.handNumber++;
    s.street = 'preflop';
    s.currentBet = s.settings.bigBlind;
    s.minRaise = s.settings.bigBlind;
    s.pots = [];
    s.lastResult = null;
    log(s, `Hand ${s.handNumber}. ${dealer.name} has the button. Deal physical hole cards.`);
    log(s, `${sb.name} posts small blind ${pay(s, sb, s.settings.smallBlind)}.`);
    log(s, `${bb.name} posts big blind ${pay(s, bb, s.settings.bigBlind)}.`);
    progress(s, bb.seat);
  });
}
export function calculatePots(state) {
  const levels = [...new Set(state.players.map(p => p.contributed).filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  return levels.map((level, index) => {
    const contributors = state.players.filter(p => p.contributed >= level);
    const pot = { id: index, amount: (level - previous) * contributors.length,
      eligible: contributors.filter(p => p.inHand && !p.folded).map(p => p.id), winners: null };
    previous = level;
    return pot;
  });
}
function refundUncalled(state) {
  const byBet = [...state.players].sort((a, b) => b.streetBet - a.streetBet);
  const refund = byBet[0].streetBet - (byBet[1]?.streetBet || 0);
  if (refund > 0) {
    const p = byBet[0];
    p.streetBet -= refund;
    p.contributed -= refund;
    p.stack += refund;
    log(state, `${p.name} receives ${refund} uncalled chips back.`);
  }
}
function finish(state, awards) {
  state.lastResult = { hand: state.handNumber, awards, total: sumBets(state) };
  for (const award of awards) {
    player(state, award.id).stack += award.amount;
    log(state, `${player(state, award.id).name} wins ${award.amount} chips (${award.label}).`);
  }
  state.players.forEach(p => { p.contributed = 0; p.streetBet = 0; });
  state.street = 'complete';
  state.turn = null;
  state.currentBet = 0;
}
function progress(state, afterSeat) {
  if (live(state).length === 1) {
    const winner = live(state)[0];
    state.pots = [];
    finish(state, [{ id: winner.id, amount: sumBets(state), label: 'everyone else folded' }]);
    return;
  }
  // A lone player with chips can only match actual opposing bets, never bet into an empty side pot.
  if (able(state).length <= 1) state.currentBet = Math.max(...state.players.map(p => p.streetBet));
  const pending = able(state).filter(p => p.streetBet < state.currentBet || (able(state).length > 1 && p.actedAt === null));
  if (pending.length) {
    state.turn = next(pending, afterSeat).id;
    return;
  }
  refundUncalled(state);
  const index = STREETS.indexOf(state.street);
  state.turn = null;
  if (index === 3) {
    state.street = 'showdown';
    state.pots = calculatePots(state);
    log(state, 'Showdown. Reveal physical cards; host selects winners for each pot.');
    return;
  }
  state.street = STREETS[index + 1];
  state.currentBet = 0;
  state.minRaise = state.settings.bigBlind;
  state.players.forEach(p => { p.streetBet = 0; p.actedAt = null; });
  log(state, `${state.street.toUpperCase()}: reveal ${state.street === 'flop' ? 'three community cards' : 'one community card'} on the real table.`);
  progress(state, state.dealerSeat);
}
export function legalActions(state, id) {
  const p = player(state, id);
  const active = STREETS.includes(state.street) && state.turn === id;
  const toCall = Math.max(0, state.currentBet - p.streetBet);
  const reopened = p.actedAt === null || p.actedAt === 0 || state.currentBet - p.actedAt >= state.minRaise;
  const canRaise = active && reopened && able(state).length > 1 && p.stack > toCall;
  return { active, toCall: Math.min(toCall, p.stack), fullToCall: toCall,
    canCheck: active && toCall === 0, canCall: active && toCall > 0,
    canRaise, minRaiseTo: state.currentBet + state.minRaise, maxRaiseTo: p.streetBet + p.stack,
    canAllIn: active && (p.stack <= toCall || canRaise) };
}
export function act(state, id, intent) {
  check(intent && typeof intent === 'object', 'Invalid action.');
  check(state.turn === id && STREETS.includes(state.street), 'It is not your turn.');
  const legal = legalActions(state, id);
  return edit(state, s => {
    const p = player(s, id);
    const type = intent.type;
    if (type === 'fold') {
      p.folded = true;
      log(s, `${p.name} folds.`);
    } else if (type === 'check') {
      check(legal.canCheck, 'You must call or fold.');
      p.actedAt = s.currentBet;
      log(s, `${p.name} checks.`);
    } else if (type === 'call' || (type === 'all-in' && p.stack <= legal.fullToCall)) {
      check(legal.canCall, 'There is no bet to call.');
      const paid = pay(s, p, legal.toCall);
      p.actedAt = s.currentBet;
      log(s, `${p.name} calls ${paid}${p.stack === 0 ? ' · all-in' : ''}.`);
    } else if (type === 'raise' || type === 'all-in') {
      check(legal.canRaise, 'Betting has not reopened, or there is nobody left to raise.');
      const target = type === 'all-in' ? legal.maxRaiseTo : intent.amount;
      check(integer(target) && target > s.currentBet && target <= legal.maxRaiseTo, 'Invalid raise-to amount.');
      check(type === 'all-in' || target % s.settings.smallBlind === 0, `Bids must be multiples of ${s.settings.smallBlind}.`);
      const increase = target - s.currentBet;
      check(increase >= s.minRaise || target === legal.maxRaiseTo, `Minimum raise is to ${legal.minRaiseTo}.`);
      if (increase >= s.minRaise) s.minRaise = increase;
      pay(s, p, target - p.streetBet);
      s.currentBet = target;
      p.actedAt = target;
      log(s, `${p.name} ${type === 'all-in' || p.stack === 0 ? 'goes all-in' : 'raises'} to ${target}.`);
    } else throw new RequestError('Unknown action.');
    progress(s, p.seat);
  }, true);
}
export function pickWinners(state, potId, winnerIds) {
  check(state.street === 'showdown', 'There is no showdown to resolve.');
  const pot = state.pots.find(p => p.id === potId);
  check(pot && !pot.winners, 'Pot not found or already awarded.');
  check(Array.isArray(winnerIds) && winnerIds.length > 0 && new Set(winnerIds).size === winnerIds.length && winnerIds.every(id => pot.eligible.includes(id)), 'Select eligible winners, without duplicates.');
  return edit(state, s => {
    s.pots.find(p => p.id === potId).winners = [...winnerIds];
    log(s, `Pot ${potId + 1}: ${winnerIds.map(id => player(s, id).name).join(' + ')} selected.`);
    if (s.pots.every(p => p.winners)) {
      const awards = [];
      for (const p of s.pots) {
        const ordered = clockwise(p.winners.map(id => player(s, id)), s.dealerSeat);
        const share = Math.floor(p.amount / ordered.length);
        const odd = p.amount % ordered.length;
        ordered.forEach((winner, i) => awards.push({ id: winner.id, amount: share + (i < odd ? 1 : 0), label: p.id === 0 ? 'main pot' : `side pot ${p.id}` }));
      }
      finish(s, awards);
    }
  }, true);
}
export function undo(state) {
  check(state.history.length > 0, 'Nothing to undo.');
  const restored = structuredClone(state.history.at(-1));
  restored.history = state.history.slice(0, -1);
  log(restored, 'Host undid the last action.');
  assertConservation(restored);
  return restored;
}
