import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';

async function setup(t, options) {
  const server = createServer(options);
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.disconnect()); await server.close(); });
  async function client() {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    socket.on('state', state => { socket.state = state; });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  return { server, url, client };
}
function emit(socket, event, data = {}) {
  return new Promise((resolve, reject) => socket.timeout(2000).emit(event, { ...(!['create', 'join', 'rejoin', 'table-preview'].includes(event) ? { revision: socket.state?.revision, token: socket.token } : {}), ...data }, (error, reply) => error ? reject(error) : resolve(reply)));
}
async function ok(socket, event, data) {
  const reply = await emit(socket, event, data);
  assert.equal(reply.ok, true, reply.error);
  if (reply.state) socket.state = reply.state;
  if (reply.token || data?.token) socket.token = reply.token || data.token;
  return reply;
}
async function sync(sockets) { // wait for current broadcast delivery; no arbitrary sleep
  await Promise.all(sockets.filter(s => s.connected).map(s => new Promise(resolve => s.emit('health-ping', {}, resolve))));
}
// Ordered Socket.IO packets ensure a trailing acknowledgement observes preceding broadcasts.
async function barrier(server, sockets) {
  server.io.sockets.sockets.forEach(s => {
    if (!s.listenerCount('health-ping')) s.on('health-ping', (_p, ack) => ack());
  });
  await sync(sockets);
}

test('three players complete all four streets, all-in, side pot and host showdown picks', async t => {
  const { client, server, url } = await setup(t);
  const a = await client(); const b = await client(); const c = await client();
  const created = await ok(a, 'create', { name: 'A', settings: { startingStack: 100, smallBlind: 5, bigBlind: 10 } });
  await ok(b, 'join', { code: created.roomCode, name: 'B' });
  await ok(c, 'join', { code: created.roomCode, name: 'C' });
  await barrier(server, [a, b, c]);
  const playerB = b.state.players.find(p => p.id === b.state.playerId);
  assert.deepEqual([playerB.initialBuyIn, playerB.rebuyCount], [100, 0]);
  assert.equal((await emit(b, 'rebuy', { playerId: c.state.playerId, amount: 100 })).ok, false);
  assert.equal((await emit(a, 'rebuy', { playerId: b.state.playerId, amount: 100, source: 'request' })).ok, false);
  await ok(a, 'rebuy', { playerId: b.state.playerId, amount: 100 });
  await ok(a, 'rebuy', { playerId: c.state.playerId, amount: 100 });
  await barrier(server, [a, b, c]);
  assert.deepEqual([b.state.players.find(p => p.id === b.state.playerId).initialBuyIn, b.state.players.find(p => p.id === b.state.playerId).rebuyCount,
    b.state.players.find(p => p.id === b.state.playerId).totalRebuyChips, b.state.players.find(p => p.id === b.state.playerId).buyIn], [100, 1, 100, 200]);
  assert.equal(b.state.players.find(p => p.id === b.state.playerId).rebuyHistory[0].source, 'host');
  assert.deepEqual(a.state.settlement.rebuyTotals, { initialBuyIn: 300, rebuyCount: 2, totalRebuyChips: 200, totalPurchased: 500,
    initialBuyInMoney: null, totalRebuyChipsMoney: null, totalPurchasedMoney: null });
  await ok(a, 'start-hand'); await barrier(server, [a, b, c]);
  await ok(a, 'action', { type: 'all-in' }); await barrier(server, [a, b, c]);
  await ok(b, 'action', { type: 'call' }); await barrier(server, [a, b, c]);
  await ok(c, 'action', { type: 'call' }); await barrier(server, [a, b, c]);
  assert.equal(a.state.street, 'flop');
  await ok(b, 'action', { type: 'raise', amount: 20 }); await barrier(server, [a, b, c]);
  await ok(c, 'action', { type: 'call' }); await barrier(server, [a, b, c]);
  assert.equal(a.state.street, 'turn');
  await ok(b, 'action', { type: 'check' }); await barrier(server, [a, b, c]);
  await ok(c, 'action', { type: 'check' }); await barrier(server, [a, b, c]);
  assert.equal(a.state.street, 'river');
  await ok(b, 'action', { type: 'raise', amount: 20 }); await barrier(server, [a, b, c]);
  await ok(c, 'action', { type: 'call' }); await barrier(server, [a, b, c]);
  assert.equal(a.state.street, 'showdown'); assert.deepEqual(a.state.pots.map(p => p.amount), [300, 80]);
  const denied = await emit(b, 'showdown-pick', { potId: 0, winnerIds: [b.state.playerId] });
  assert.equal(denied.ok, false); assert.match(denied.error, /host/);
  await ok(a, 'showdown-pick', { potId: 0, winnerIds: [a.state.playerId] });
  await ok(a, 'showdown-pick', { potId: 1, winnerIds: [b.state.playerId] });
  assert.equal(a.state.street, 'complete');
  assert.deepEqual(a.state.players.map(p => p.stack), [300, 140, 60]);
  assert.equal(a.state.players.reduce((sum, p) => sum + p.stack, 0), 500);
  assert.equal('history' in a.state, false); assert.equal(JSON.stringify(a.state).includes(created.token), false);
  const health = await fetch(`${url}/healthz`); assert.equal(health.status, 200);
});

test('rejoin restores identity, stack and turn; token forgery and old socket are rejected', async t => {
  const { client, server } = await setup(t);
  const a = await client(); const b = await client();
  const identity = await ok(a, 'create', { name: 'Host' });
  const guest = await ok(b, 'join', { code: identity.roomCode, name: 'Guest' }); await barrier(server, [a, b]);
  await ok(a, 'rebuy', { playerId: guest.playerId, amount: 125 }); await barrier(server, [a, b]);
  await ok(a, 'start-hand');
  const replacement = await client();
  assert.equal((await emit(replacement, 'rejoin', { code: identity.roomCode, playerId: identity.playerId, token: 'wrong' })).ok, false);
  await ok(replacement, 'rejoin', { code: identity.roomCode, playerId: identity.playerId, token: identity.token });
  assert.equal(replacement.state.turn, identity.playerId);
  assert.equal(replacement.state.players.find(p => p.id === identity.playerId).stack, 995);
  const restoredGuest = replacement.state.players.find(p => p.id === guest.playerId);
  assert.deepEqual([restoredGuest.initialBuyIn, restoredGuest.rebuyCount, restoredGuest.totalRebuyChips, restoredGuest.buyIn], [1000, 1, 125, 1125]);
  assert.equal(restoredGuest.rebuyHistory[0].amount, 125);
  await barrier(server, [replacement, b]);
  assert.equal(a.connected, false);
  await ok(replacement, 'action', { type: 'call' });
});

test('server rejects out of turn, non-host settings, duplicate/stale intents and invalid payloads', async t => {
  const { client, server } = await setup(t);
  const a = await client(); const b = await client();
  const identity = await ok(a, 'create', { name: 'Host' });
  await ok(b, 'join', { code: identity.roomCode, name: 'Guest' }); await barrier(server, [a, b]);
  assert.equal((await emit(b, 'host-settings', { settings: { bigBlind: 20 } })).ok, false);
  assert.equal((await emit(b, 'rebuy', { playerId: b.state.playerId, amount: 100 })).ok, false);
  await ok(a, 'start-hand'); await barrier(server, [a, b]);
  assert.equal((await emit(b, 'action', { type: 'fold', playerId: a.state.playerId })).ok, false);
  const revision = a.state.revision;
  await ok(a, 'action', { type: 'call' });
  assert.match((await emit(a, 'action', { type: 'fold', revision })).error, /changed/);
  const bad = await new Promise(resolve => a.emit('action', null, resolve)); assert.equal(bad.ok, false);
});

test('host can reorder seats between hands and broadcasts the new order', async t => {
  const { client, server } = await setup(t);
  const a = await client(); const b = await client(); const c = await client();
  const created = await ok(a, 'create', { name: 'A' });
  await ok(b, 'join', { code: created.roomCode, name: 'B' }); await ok(c, 'join', { code: created.roomCode, name: 'C' });
  await barrier(server, [a, b, c]);
  const order = [c.state.playerId, a.state.playerId, b.state.playerId];
  await ok(a, 'host:reorderSeats', { order }); await barrier(server, [a, b, c]);
  assert.deepEqual(a.state.seatOrder, order); assert.deepEqual(b.state.seatOrder, order); assert.deepEqual(c.state.seatOrder, order);
  assert.equal((await emit(b, 'host:reorderSeats', { order: order.slice().reverse() })).ok, false);
  assert.match((await emit(a, 'host:reorderSeats', { order: [order[0], order[0], order[1]] })).error, /Invalid player list/);
  await ok(a, 'start-hand');
  const midHand = await emit(a, 'host:reorderSeats', { order });
  assert.equal(midHand.ok, false); assert.match(midHand.error, /mid-hand/);
});

test('six-hour idle cleanup removes rooms and tokens', async t => {
  let time = 0;
  const { client, server } = await setup(t, { now: () => time });
  const a = await client(); await ok(a, 'create', { name: 'Idle' });
  time = 6 * 60 * 60 * 1000; server.sweep(); assert.equal(server.rooms.size, 0);
});

test('host departure transfers host; kicks invalidate seat tokens', async t => {
  const { client, server } = await setup(t);
  const a = await client(); const b = await client(); const c = await client();
  const identity = await ok(a, 'create', { name: 'A' });
  await ok(b, 'join', { code: identity.roomCode, name: 'B' });
  const guest = await ok(c, 'join', { code: identity.roomCode, name: 'C' }); await barrier(server, [a, b, c]);
  await ok(a, 'kick', { playerId: guest.playerId });
  const r = await emit(c, 'rejoin', { code: guest.roomCode, playerId: guest.playerId, token: guest.token }); assert.equal(r.ok, false);
  await ok(a, 'leave'); await barrier(server, [b]); assert.equal(b.state.hostId, b.state.playerId);
});

test('a dropped connection keeps its chips; host fold and undo preserve disconnected presence', async t => {
  const { client, server } = await setup(t);
  const a = await client(); const b = await client(); const c = await client();
  const host = await ok(a, 'create', { name: 'Host' });
  const guest = await ok(b, 'join', { code: host.roomCode, name: 'Guest' });
  await ok(c, 'join', { code: host.roomCode, name: 'Third' }); await barrier(server, [a, b, c]);
  await ok(a, 'start-hand'); await ok(a, 'action', { type: 'call' });
  const disconnected = new Promise(resolve => server.io.sockets.sockets.get(b.id).once('disconnect', resolve));
  b.disconnect(); await disconnected; await barrier(server, [a, c]);
  const seat = a.state.players.find(p => p.id === guest.playerId);
  assert.equal(seat.stack, 995); assert.equal(seat.connected, false); assert.equal(a.state.turn, guest.playerId);
  await ok(a, 'host-fold'); await ok(a, 'undo');
  assert.equal(a.state.turn, guest.playerId);
  assert.equal(a.state.players.find(p => p.id === guest.playerId).connected, false);
  const restored = await client();
  await ok(restored, 'rejoin', { code: guest.roomCode, playerId: guest.playerId, token: guest.token });
  assert.equal(restored.state.players.find(p => p.id === guest.playerId).stack, 995);
  await ok(restored, 'action', { type: 'call' });
});

test('join preview is read-only, hides identities, and rejects a changed buy-in', async t => {
  const { client, server } = await setup(t, { now: () => 123456 });
  const a = await client(); const b = await client();
  const created = await ok(a, 'create', { name: 'Host' });
  const preview = await ok(b, 'table-preview', { code: created.roomCode });
  assert.equal(preview.startingStack, 1000); assert.equal(preview.players, 1);
  assert.equal(preview.playerId, undefined); assert.equal(preview.token, undefined);
  assert.equal(server.rooms.get(created.roomCode).game.players.length, 1);
  await ok(a, 'host-settings', { settings: { startingStack: 500 } });
  const denied = await emit(b, 'join', { code: created.roomCode, name: 'Guest', expectedBuyIn: 1000 });
  assert.equal(denied.ok, false); assert.match(denied.error, /Buy-in changed/);
  assert.equal(server.rooms.get(created.roomCode).game.players.length, 1);
  await ok(b, 'join', { code: created.roomCode, name: 'Guest', expectedBuyIn: 500 });
  await barrier(server, [a, b]);
  assert.equal(a.state.log.at(-1).timestamp, 123456);
  await ok(a, 'start-hand');
  assert.match((await emit(b, 'table-preview', { code: created.roomCode })).error, /between hands/);
});

test('view broadcasts settlement snapshots and marks the prior values during a hand', async t => {
  const { client, server } = await setup(t);
  const a = await client(); const b = await client();
  const created = await ok(a, 'create', { name: 'Alex', settings: { startingStack: 100, smallBlind: 5, bigBlind: 10, centsPer1000Chips: 2500 } });
  await ok(b, 'join', { code: created.roomCode, name: 'Blair' }); await barrier(server, [a, b]);
  assert.equal(a.state.settlement.centsPer1000Chips, 2500);
  assert.equal(a.state.settlement.rows.reduce((sum, row) => sum + row.net, 0), 0);
  assert.equal((await emit(a, 'host-settings', { settings: { centsPer1000Chips: 10_000_001 } })).ok, false);
  const previous = structuredClone(a.state.settlement);
  await ok(a, 'start-hand'); await barrier(server, [a, b]);
  assert.deepEqual(a.state.settlement, previous);
  assert.match(a.state.settlementNote, /Hand in progress/);
  assert.equal(JSON.stringify(a.state).includes(created.token), false);
});

test('rebuy requests are revision-stable, visible only to host and requester, and cancel/deny cleanly', async t => {
  const { client, server } = await setup(t);
  const host = await client(); const requester = await client(); const other = await client();
  const table = await ok(host, 'create', { name: 'Host', settings: { startingStack: 250, smallBlind: 5, bigBlind: 10 } });
  const player = await ok(requester, 'join', { code: table.roomCode, name: 'Requesting' });
  const spectator = await ok(other, 'join', { code: table.roomCode, name: 'Other' });
  await barrier(server, [host, requester, other]);
  const revision = host.state.revision;
  assert.equal((await emit(requester, 'rebuy:request', { amount: 125 })).ok, true);
  await barrier(server, [host, requester, other]);
  assert.equal(host.state.revision, revision);
  assert.deepEqual(host.state.rebuyRequests.map(item => [item.id, item.name, item.amount]), [[player.playerId, 'Requesting', 125]]);
  assert.deepEqual(requester.state.rebuyRequests.map(item => item.id), [player.playerId]);
  assert.deepEqual(other.state.rebuyRequests, []);
  assert.equal(JSON.stringify(other.state.rebuyRequests).includes('Requesting'), false);
  const duplicate = await emit(requester, 'rebuy:request', { amount: 100 });
  assert.equal(duplicate.ok, false); assert.match(duplicate.error, /already have/);
  await ok(other, 'rebuy:request', {}); await barrier(server, [host, requester, other]);
  assert.deepEqual(host.state.rebuyRequests.map(item => item.amount), [125, 250]);
  const deniedResult = new Promise(resolve => requester.once('rebuy-result', resolve));
  const denied = await emit(host, 'rebuy:deny', { playerId: player.playerId });
  assert.equal(denied.ok, true); assert.deepEqual(await deniedResult, { type: 'denied' });
  await barrier(server, [host, requester, other]);
  assert.equal(host.state.revision, revision);
  assert.deepEqual(host.state.rebuyRequests.map(item => item.id), [spectator.playerId]);
  const canceled = await emit(other, 'rebuy:cancel');
  assert.equal(canceled.ok, true); await barrier(server, [host, other]);
  assert.equal(host.state.revision, revision); assert.deepEqual(host.state.rebuyRequests, []);
  assert.equal((await emit(other, 'rebuy:deny', { playerId: player.playerId })).ok, false);
  assert.equal(host.state.settlement.rebuyTotals.rebuyCount, 0);
  assert.deepEqual(host.state.players.map(item => [item.rebuyCount, item.totalRebuyChips]), [[0, 0], [0, 0], [0, 0]]);
});

test('rebuy approval uses the normal revision gate, rejects during a hand, and then adds chips and ledger buy-in', async t => {
  const { client, server } = await setup(t);
  const host = await client(); const requester = await client();
  const table = await ok(host, 'create', { name: 'Host', settings: { startingStack: 100, smallBlind: 5, bigBlind: 10 } });
  const player = await ok(requester, 'join', { code: table.roomCode, name: 'Player' }); await barrier(server, [host, requester]);
  await ok(requester, 'rebuy:request', {}); await barrier(server, [host, requester]);
  const initialRevision = host.state.revision;
  await ok(host, 'start-hand'); await barrier(server, [host, requester]);
  const deniedNonHost = await emit(requester, 'rebuy:approve', { playerId: player.playerId, amount: 150 });
  assert.equal(deniedNonHost.ok, false);
  const duringHandRevision = host.state.revision;
  const midHand = await emit(host, 'rebuy:approve', { playerId: player.playerId, amount: 150 });
  assert.equal(midHand.ok, false); assert.match(midHand.error, /between hands/);
  assert.equal((await emit(host, 'rebuy', { playerId: player.playerId, amount: 100 })).ok, false);
  assert.equal(host.state.revision, duringHandRevision);
  assert.equal(host.state.players.find(item => item.id === player.playerId).rebuyCount, 0);
  assert.equal(server.rooms.get(table.roomCode).rebuyRequests.has(player.playerId), true);
  await ok(host, 'action', { type: 'fold' }); await barrier(server, [host, requester]);
  const result = new Promise(resolve => requester.once('rebuy-result', resolve));
  const before = host.state.revision;
  await ok(host, 'rebuy:approve', { playerId: player.playerId, amount: 150 }); await barrier(server, [host, requester]);
  assert.equal(host.state.revision, before + 1);
  const reboughtPlayer = host.state.players.find(item => item.id === player.playerId);
  assert.deepEqual([reboughtPlayer.initialBuyIn, reboughtPlayer.rebuyCount, reboughtPlayer.totalRebuyChips, reboughtPlayer.buyIn], [100, 1, 150, 250]);
  assert.deepEqual(reboughtPlayer.rebuyHistory.map(item => [item.playerId, item.name, item.amount, item.source]), [[player.playerId, 'Player', 150, 'request']]);
  assert.equal(requester.state.players.find(item => item.id === player.playerId).totalRebuyChips, 150);
  assert.equal(host.state.settlement.rows.find(item => item.name === 'Player').buyIn, 250);
  assert.equal(host.state.settlement.rebuyTotals.rebuyCount, 1);
  assert.equal(server.rooms.get(table.roomCode).rebuyRequests.has(player.playerId), false);
  assert.deepEqual(await result, { type: 'approved', amount: 150 });
  assert.ok(initialRevision < before);
});

test('leaving or kicking a requester clears its pending rebuy request', async t => {
  const { client, server } = await setup(t);
  const host = await client(); const leaving = await client(); const kicked = await client();
  const table = await ok(host, 'create', { name: 'Host' });
  const departed = await ok(leaving, 'join', { code: table.roomCode, name: 'Leaving' });
  const removed = await ok(kicked, 'join', { code: table.roomCode, name: 'Kicked' }); await barrier(server, [host, leaving, kicked]);
  await ok(host, 'rebuy', { playerId: departed.playerId, amount: 40 });
  await ok(host, 'rebuy', { playerId: departed.playerId, amount: 20 });
  await ok(host, 'rebuy', { playerId: removed.playerId, amount: 25 }); await barrier(server, [host, leaving, kicked]);
  await ok(leaving, 'rebuy:request', {}); await ok(kicked, 'rebuy:request', {}); await barrier(server, [host, leaving, kicked]);
  await ok(leaving, 'leave'); await barrier(server, [host, kicked]);
  assert.equal(server.rooms.get(table.roomCode).rebuyRequests.has(departed.playerId), false);
  const left = host.state.settlement.rows.find(row => row.name === 'Leaving');
  assert.deepEqual([left.initialBuyIn, left.rebuyCount, left.totalRebuyChips, left.buyIn], [1000, 2, 60, 1060]);
  assert.equal(left.rebuyHistory.length, 2);
  await ok(host, 'kick', { playerId: removed.playerId }); await barrier(server, [host]);
  assert.equal(server.rooms.get(table.roomCode).rebuyRequests.has(removed.playerId), false);
  assert.deepEqual(host.state.rebuyRequests, []);
  const kickedRow = host.state.settlement.rows.find(row => row.name === 'Kicked');
  assert.deepEqual([kickedRow.initialBuyIn, kickedRow.rebuyCount, kickedRow.totalRebuyChips, kickedRow.buyIn], [1000, 1, 25, 1025]);
});
