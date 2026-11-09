import test from 'node:test';
import assert from 'node:assert/strict';
import { createTable, addPlayer, configure, startHand, act, calculatePots, pickWinners, legalActions, undo, reorderSeats,
  rebuy, donate, setSitOut, removePlayer, settlement, assertConservation } from '../src/game.js';
function table(stacks = [1000, 1000, 1000], options = {}) {
  let s = createTable(options);
  stacks.forEach((_, i) => { s = addPlayer(s, String(i), `Player ${i}`); });
  s.players.forEach((p, i) => { p.stack = stacks[i]; });
  s.totalChips = stacks.reduce((a, b) => a + b, 0);
  return s;
}
function play(s, type, amount) { return act(s, s.turn, { type, amount }); }
function checkDown(s) {
  for (let n = 0; s.turn && n < 50; n++) s = play(s, legalActions(s, s.turn).canCheck ? 'check' : 'call');
  return s;
}
function award(s) {
  while (s.street === 'showdown') {
    const p = s.pots.find(p => !p.winners);
    s = pickWinners(s, p.id, [p.eligible[0]]);
  }
  return s;
}
test('multiway blinds and button rotate past sitting-out or busted seats', () => {
  let s = startHand(table());
  assert.equal(s.dealerSeat, 0); assert.equal(s.smallBlindId, '1'); assert.equal(s.bigBlindId, '2'); assert.equal(s.turn, '0');
  assert.deepEqual(s.players.map(p => p.stack), [1000, 995, 990]);
  s = award(checkDown(s)); s = setSitOut(s, '1', true); s = startHand(s);
  assert.equal(s.dealerSeat, 2); assert.equal(s.smallBlindId, '2'); assert.equal(s.turn, '2');
});
test('heads-up dealer posts small blind and acts first preflop, last postflop', () => {
  let s = startHand(table([100, 100]));
  assert.equal(s.smallBlindId, '0'); assert.equal(s.turn, '0');
  s = play(s, 'call'); s = play(s, 'check');
  assert.equal(s.street, 'flop'); assert.equal(s.turn, '1');
});
test('minimum raises, invalid actions, immutability and out-of-turn checks', () => {
  const original = startHand(table());
  assert.throws(() => act(original, '1', { type: 'fold' }), /turn/);
  assert.throws(() => play(original, 'check'), /call/);
  assert.throws(() => play(original, 'raise', 15), /Minimum/);
  for (const amount of [NaN, Infinity, 20.5, '20', 1001]) assert.throws(() => play(original, 'raise', amount));
  let s = play(original, 'raise', 30);
  assert.equal(s.minRaise, 20); assert.equal(legalActions(s, '1').minRaiseTo, 50);
  assert.throws(() => play(s, 'raise', 45), /Minimum/);
  s = play(s, 'raise', 50); assert.equal(s.currentBet, 50);
  assert.equal(original.currentBet, 10); assert.equal(original.players[0].stack, 1000);
});
test('short all-in does not reopen betting for prior caller', () => {
  let s = startHand(table([100, 15, 100]));
  s = play(s, 'call'); s = play(s, 'all-in'); s = play(s, 'call');
  assert.equal(s.turn, '0'); assert.equal(legalActions(s, '0').canRaise, false);
  assert.throws(() => play(s, 'all-in'), /reopened/);
  s = play(s, 'call'); assert.equal(s.street, 'flop'); assertConservation(s);
});
test('cumulative short all-ins reopen when they total a full raise', () => {
  let s = startHand(table([20, 100, 100, 100, 15])); // first actor seat 3
  s = play(s, 'call'); s = play(s, 'all-in'); s = play(s, 'all-in');
  s = play(s, 'call'); s = play(s, 'call');
  assert.equal(s.turn, '3'); assert.equal(legalActions(s, '3').canRaise, true);
  s = play(s, 'raise', 30); assert.equal(s.currentBet, 30);
});
test('three-way all-ins produce correct side pots', () => {
  let s = startHand(table([50, 100, 200]));
  s = play(s, 'all-in'); s = play(s, 'all-in'); s = play(s, 'call');
  assert.equal(s.street, 'showdown');
  assert.deepEqual(s.pots.map(p => p.amount), [150, 100]);
  assert.deepEqual(s.pots.map(p => p.eligible), [['0', '1', '2'], ['1', '2']]);
  assert.equal(s.players[2].stack, 100);
  s = pickWinners(s, 0, ['0']); s = pickWinners(s, 1, ['1']);
  assert.deepEqual(s.players.map(p => p.stack), [150, 100, 100]); assertConservation(s);
});
test('split pots give odd chips to first winner clockwise left of dealer', () => {
  let s = startHand(table([100, 100, 100], { smallBlind: 1, bigBlind: 1 }));
  s = checkDown(s); assert.equal(s.pots[0].amount, 3);
  s = pickWinners(s, 0, ['0', '2']);
  assert.deepEqual(s.players.map(p => p.stack), [100, 99, 101]);
});
test('fold-out pays instantly; undo restores chips and current turn', () => {
  let s = startHand(table()); s = play(s, 'fold');
  const previous = s; s = play(s, 'fold');
  assert.equal(s.street, 'complete'); assert.deepEqual(s.players.map(p => p.stack), [1000, 995, 1005]);
  assert.deepEqual(s.players.map(p => p.handsWon), [0, 0, 1]);
  assert.deepEqual(s.players.map(p => p.handsPlayed), [0, 0, 1], 'preflop folders are excluded from hands played');
  assert.deepEqual(Object.fromEntries(settlement(s).rows.map(row => [row.id, row.handsPlayed])), { '0': 0, '1': 0, '2': 1 });
  s = undo(s); assert.deepEqual(s.players, previous.players); assert.equal(s.turn, '1');
});
test('short blind and lone funded player do not invent a side pot', () => {
  let s = startHand(table([100, 2]));
  assert.equal(s.street, 'showdown'); assert.equal(s.pots[0].amount, 4);
  assert.deepEqual(s.players.map(p => p.stack), [98, 0]);
  s = award(s); assertConservation(s);
});
test('folded contributions count in pots but folded players are ineligible', () => {
  let s = startHand(table()); s = play(s, 'call'); s = play(s, 'call'); s = play(s, 'check');
  s = play(s, 'raise', 20); s = play(s, 'fold'); s = play(s, 'call'); s = checkDown(s);
  assert.deepEqual(s.players.map(p => p.handsPlayed), [1, 1, 1], 'a postflop fold still counts as a played hand');
  assert.deepEqual(s.pots.map(p => p.amount), [30, 40]);
  assert.deepEqual(s.pots[0].eligible, ['0', '1']);
  assert.throws(() => pickWinners(s, 0, ['2']), /eligible/);
  assert.throws(() => pickWinners(s, 0, ['0', '0']), /duplicates/);
});
test('showdown awards and undo are atomic and conserve chips', () => {
  let s = checkDown(startHand(table()));
  const original = structuredClone(s);
  s = pickWinners(s, 0, ['1']); s = undo(s);
  assert.equal(s.street, 'showdown'); assert.deepEqual(s.players, original.players); assert.equal(s.pots[0].winners, null);
});
test('administration validates, changes chip ledger, and clears undo boundaries', () => {
  let s = table([100, 100]);
  s = rebuy(s, '0', 50); assert.equal(s.totalChips, 250);
  s = configure(s, { startingStack: 300 }); assert.equal(s.totalChips, 650);
  s = startHand(s);
  assert.throws(() => rebuy(s, '0', 1), /between/);
  assert.throws(() => removePlayer(s, '0'), /between/);
  assert.throws(() => configure(s, { bigBlind: 20 }), /between/);
  assert.throws(() => addPlayer(s, '2', 'New'), /between/);
  s = play(s, 'fold'); s = removePlayer(s, '1'); assert.equal(s.history.length, 0); assertConservation(s);
});
test('night ledger tracks buy-in, rebuys, entrants and departed cash-out without affecting chips', () => {
  let s = createTable({ startingStack: 100 });
  s = addPlayer(s, 'a', 'Alex'); s = addPlayer(s, 'b', 'Blair'); s = addPlayer(s, 'c', 'Casey');
  assert.deepEqual(s.players.map(p => [p.initialBuyIn, p.rebuyCount, p.totalRebuyChips, p.buyIn, p.handsPlayed, p.handsWon]),
    [[100, 0, 0, 100, 0, 0], [100, 0, 0, 100, 0, 0], [100, 0, 0, 100, 0, 0]]);
  s = rebuy(s, 'a', 50); assert.equal(s.players[0].buyIn, 150); assert.equal(s.players[0].stack, 150);
  s = configure(s, { startingStack: 200 });
  assert.deepEqual(s.players.map(p => [p.initialBuyIn, p.rebuyCount, p.totalRebuyChips, p.buyIn, p.stack]),
    [[200, 1, 50, 250, 250], [200, 0, 0, 200, 200], [200, 0, 0, 200, 200]]);
  s = setSitOut(s, 'c', true); s = startHand(s);
  assert.deepEqual(s.players.map(p => p.handsPlayed), [1, 1, 0]);
  s = award(checkDown(s));
  s = removePlayer(s, 'c');
  assert.deepEqual(s.departed, [{ id: 'c', name: 'Casey', initialBuyIn: 200, buyIn: 200, rebuyCount: 0, totalRebuyChips: 0,
    rebuyHistory: [], cashOut: 200, handsWon: 0, handsPlayed: 0, handsDealt: 0 }]);
  assert.equal(s.totalChips, 450); assertConservation(s);
});
test('completed rebuys record their source and time once in the settlement tracker', () => {
  let s = createTable({ startingStack: 100, centsPer1000Chips: 2500 });
  s = addPlayer(s, 'a', 'Alex'); s = addPlayer(s, 'b', 'Blair');
  assert.deepEqual([s.players[0].initialBuyIn, s.players[0].rebuyCount, s.players[0].totalRebuyChips, s.players[0].rebuyHistory], [100, 0, 0, []]);
  s = rebuy(s, 'a', 50, { timestamp: 1000, source: 'host' });
  s = rebuy(s, 'b', 25, { timestamp: 2000, source: 'host' });
  s = rebuy(s, 'a', 75, { timestamp: 3000, source: 'request' });
  assertConservation(s);
  const alex = s.players.find(p => p.id === 'a');
  assert.equal(alex.stack, 225); assert.equal(alex.initialBuyIn + alex.totalRebuyChips, alex.buyIn);
  assert.equal(alex.rebuyCount, 2); assert.equal(alex.totalRebuyChips, 125);
  assert.deepEqual(alex.rebuyHistory.map(({ playerId, name, amount, handNumber, timestamp, source }) => [playerId, name, amount, handNumber, timestamp, source]), [
    ['a', 'Alex', 50, 0, 1000, 'host'], ['a', 'Alex', 75, 0, 3000, 'request']
  ]);
  const summary = settlement(s);
  assert.deepEqual(summary.rows.map(row => [row.name, row.initialBuyIn, row.rebuyCount, row.totalRebuyChips, row.totalBuyIn, row.cashOut, row.net]), [
    ['Alex', 100, 2, 125, 225, 225, 0], ['Blair', 100, 1, 25, 125, 125, 0]
  ]);
  assert.deepEqual(summary.rebuyTotals, { initialBuyIn: 200, rebuyCount: 3, totalRebuyChips: 150, totalPurchased: 350,
    initialBuyInMoney: '+$5.00', totalRebuyChipsMoney: '+$3.75', totalPurchasedMoney: '+$8.75' });
  const beforeDonate = structuredClone(summary.rebuyTotals);
  s = donate(s, 'a', 'b', 50);
  assert.deepEqual(settlement(s).rebuyTotals, beforeDonate);
  assert.equal(settlement(s).rows.reduce((total, row) => total + row.net, 0), 0);
  assertConservation(s);
});
test('pre-hand starting-stack changes retain completed rebuy history and purchased chips', () => {
  let s = createTable({ startingStack: 100 });
  s = addPlayer(s, 'a', 'Alex'); s = addPlayer(s, 'b', 'Blair');
  s = rebuy(s, 'a', 50, { timestamp: 123, source: 'host' });
  s = configure(s, { startingStack: 250 });
  const alex = s.players.find(p => p.id === 'a');
  assert.deepEqual([alex.initialBuyIn, alex.rebuyCount, alex.totalRebuyChips, alex.buyIn, alex.stack], [250, 1, 50, 300, 300]);
  assert.equal(alex.rebuyHistory[0].timestamp, 123);
  assert.equal(s.totalChips, 550);
  assert.equal(settlement(s).rebuyTotals.totalPurchased, 550);
  assertConservation(s);
});
test('hands won count once across split pots and undo restores the result ledger', () => {
  let s = startHand(table([50, 100, 200]));
  s = play(s, 'all-in'); s = play(s, 'all-in'); s = play(s, 'call');
  s = pickWinners(s, 0, ['1']); s = pickWinners(s, 1, ['1']);
  assert.equal(s.players[1].handsWon, 1);
  const completed = s;
  s = undo(s);
  assert.equal(s.street, 'showdown'); assert.equal(s.players[1].handsWon, 0);
  assert.equal(completed.players[1].handsWon, 1);
  const split = pickWinners(checkDown(startHand(table())), 0, ['0', '2']);
  assert.deepEqual(split.players.map(p => p.handsWon), [1, 0, 1]);
});
test('settlement merges normalized names and emits deterministic transfers for every net', () => {
  let s = createTable({ startingStack: 1000, centsPer1000Chips: 2500 });
  s = addPlayer(s, 'sam', 'Sam'); s = addPlayer(s, 'alex', 'Alex'); s = addPlayer(s, 'blair', 'Blair');
  s.players.find(p => p.id === 'sam').stack = 900;
  s.players.find(p => p.id === 'alex').stack = 1200;
  s.players.find(p => p.id === 'blair').stack = 900;
  const before = structuredClone(s);
  const summary = settlement(s);
  assert.deepEqual(summary.rows.map(row => row.name), ['Alex', 'Blair', 'Sam']);
  assert.deepEqual(summary.rows.map(row => row.net), [200, -100, -100]);
  assert.equal(summary.rows.reduce((sum, row) => sum + row.net, 0), 0);
  assert.deepEqual(summary.transfers.map(item => [item.fromName, item.toName, item.chips]), [['Blair', 'Alex', 100], ['Sam', 'Alex', 100]]);
  assert.equal(summary.transfers.length, 2);
  assert.equal(summary.rows[0].netMoney, '+$5.00'); assert.equal(summary.transfers[0].money, '+$2.50');
  assert.deepEqual(s, before);
});
test('settlement includes and merges departed/rejoined names and rounds cash values to cents', () => {
  let s = createTable({ startingStack: 1000, centsPer1000Chips: 1000 });
  s = addPlayer(s, 'sam-old', 'Sam'); s = addPlayer(s, 'alex', 'Alex');
  s = rebuy(s, 'sam-old', 500, { timestamp: 100, source: 'host' });
  s = rebuy(s, 'sam-old', 250, { timestamp: 200, source: 'request' });
  s = donate(s, 'sam-old', 'alex', 100); s = removePlayer(s, 'sam-old'); s = addPlayer(s, 'sam-new', 'sAM');
  const summary = settlement(s);
  const sam = summary.rows.find(row => row.name.toLowerCase() === 'sam');
  assert.equal(sam.initialBuyIn, 2000); assert.equal(sam.rebuyCount, 2); assert.equal(sam.totalRebuyChips, 750);
  assert.equal(sam.buyIn, 2750); assert.equal(sam.totalBuyIn, 2750); assert.equal(sam.cashOut, 2650); assert.equal(sam.net, -100);
  assert.equal(sam.rebuyHistory.length, 2); assert.deepEqual(sam.rebuyHistory.map(item => item.playerId), ['sam-old', 'sam-old']);
  assert.equal(sam.netMoney, '-$1.00');
  assert.deepEqual(summary.transfers.map(item => [item.fromName.toLowerCase(), item.toName, item.chips]), [['sam', 'Alex', 100]]);
  let rounding = createTable({ startingStack: 1000, centsPer1000Chips: 501 });
  rounding = addPlayer(rounding, 'a', 'A'); rounding = addPlayer(rounding, 'b', 'B');
  rounding.players[0].stack++; rounding.players[1].stack--;
  assert.equal(settlement(rounding).transfers[0].money, '+$0.01');
  assert.deepEqual(settlement(createTable()).transfers, []);
  const solo = addPlayer(createTable(), 'solo', 'Solo');
  assert.equal(settlement(solo).rows.length, 1); assert.deepEqual(settlement(solo).transfers, []);
});
test('timer increases blinds only on a new hand', () => {
  let s = startHand(table([1000, 1000], { blindMinutes: 1 }), 1000);
  assert.equal(s.blindDeadline, 61000);
  s = play(s, 'fold'); s = startHand(s, 61000);
  assert.equal(s.settings.bigBlind, 20); assert.equal(s.blindDeadline, 121000);
});
test('ten-seat cap and invalid settings are rejected', () => {
  let s = createTable(); for (let i = 0; i < 10; i++) s = addPlayer(s, String(i), `P${i}`);
  assert.throws(() => addPlayer(s, '11', 'Full'), /10 players/);
  assert.throws(() => createTable({ smallBlind: 20, bigBlind: 10 }));
  assert.throws(() => createTable({ startingStack: -1 }));
  assert.throws(() => createTable({ centsPer1000Chips: -1 }));
  assert.throws(() => createTable({ centsPer1000Chips: 10_000_001 }));
  assert.throws(() => createTable({ smallBlind: 3, bigBlind: 10 }), /multiple/);
});

test('raise-to amounts must be multiples of the small blind', () => {
  let s = startHand(table([100, 100, 100], { smallBlind: 5, bigBlind: 10 }));
  assert.throws(() => play(s, 'raise', 23), /multiples/);
  s = play(s, 'raise', 25);
  assert.equal(s.currentBet, 25);
});

test('seat reorder changes the next hand order and rejects mid-hand changes', () => {
  let s = table([100, 100, 100]);
  const ids = s.players.map(p => p.id);
  s = reorderSeats(s, [ids[2], ids[0], ids[1]]);
  assert.deepEqual(s.seatOrder, [ids[2], ids[0], ids[1]]);
  s = startHand(s);
  assert.equal(s.dealerSeat, 0); assert.equal(s.smallBlindId, ids[0]); assert.equal(s.bigBlindId, ids[1]);
  assert.throws(() => reorderSeats(s, ids), /mid-hand/);
});
test('chip conservation across 100 deterministic varied hands', () => {
  let seed = 81;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let hand = 0; hand < 100; hand++) {
    let s = startHand(table(Array.from({ length: 2 + hand % 9 }, () => 10 + Math.floor(random() * 200))));
    const total = s.totalChips;
    for (let n = 0; s.turn && n < 200; n++) {
      const legal = legalActions(s, s.turn);
      const choice = random();
      s = play(s, choice < 0.15 ? 'fold' : choice < 0.4 && legal.canAllIn ? 'all-in' : legal.canCheck ? 'check' : 'call');
      assertConservation(s);
    }
    s = award(s); assert.equal(s.street, 'complete');
    assert.equal(s.players.reduce((a, p) => a + p.stack, 0), total);
  }
});
test('pot layers scale to all ten seats', () => {
  const s = table(Array(10).fill(100));
  s.players.forEach((p, i) => { p.inHand = true; p.contributed = (i + 1) * 10; });
  assert.deepEqual(calculatePots(s).map(p => p.amount), [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
});

test('unmatched overbet is refunded before showdown', () => {
  let s = startHand(table([200, 50, 100]));
  s = play(s, 'all-in'); s = play(s, 'all-in'); s = play(s, 'all-in');
  assert.equal(s.players[0].stack, 100);
  assert.deepEqual(s.pots.map(p => p.amount), [150, 100]);
  assertConservation(s);
});

test('large legal stacks can win a whole multi-billion chip table', () => {
  let s = startHand(table([1_000_000_000, 1_000_000_000, 1_000_000_000]));
  s = play(s, 'all-in'); s = play(s, 'call'); s = play(s, 'call');
  s = pickWinners(s, 0, ['0']);
  assert.equal(s.players[0].stack, 3_000_000_000); assertConservation(s);
});

test('a player who checked can raise a short opening all-in', () => {
  let s = startHand(table([100, 100, 15]));
  s = play(s, 'call'); s = play(s, 'call'); s = play(s, 'check');
  assert.equal(s.street, 'flop');
  s = play(s, 'check'); s = play(s, 'all-in'); s = play(s, 'call');
  assert.equal(s.turn, '1'); assert.equal(legalActions(s, '1').canRaise, true);
  s = play(s, 'raise', 15); assert.equal(s.currentBet, 15);
});


test('reorder validates all player lists atomically and heads-up uses new order', () => {
  const original = table([100, 100]);
  for (const order of [['0'], ['0', '0'], ['0', 'foreign'], null]) {
    assert.throws(() => reorderSeats(original, order), /Invalid player list/);
    assert.deepEqual(original.seatOrder, ['0', '1']);
  }
  let s = startHand(reorderSeats(original, ['1', '0']));
  assert.equal(s.smallBlindId, '1'); assert.equal(s.bigBlindId, '0'); assert.equal(s.turn, '1');
  s = award(checkDown(s)); s = startHand(s);
  assert.equal(s.smallBlindId, '0'); assert.equal(s.bigBlindId, '1'); assert.equal(s.turn, '0');
});

test('joining a vacated seat keeps explicit order aligned with physical seats', () => {
  let s = removePlayer(table(), '1'); s = addPlayer(s, 'new', 'New');
  assert.deepEqual(s.seatOrder, ['0', 'new', '2']);
});
