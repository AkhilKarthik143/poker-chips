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
  return new Promise((resolve, reject) => socket.timeout(2000).emit(event, { revision: socket.state?.revision, ...data }, (error, reply) => error ? reject(error) : resolve(reply)));
}
async function ok(socket, event, data) {
  const reply = await emit(socket, event, data);
  assert.equal(reply.ok, true, reply.error);
  if (reply.state) socket.state = reply.state;
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
  await ok(a, 'rebuy', { playerId: b.state.playerId, amount: 100 });
  await ok(a, 'rebuy', { playerId: c.state.playerId, amount: 100 });
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
  await ok(b, 'join', { code: identity.roomCode, name: 'Guest' }); await barrier(server, [a, b]);
  await ok(a, 'start-hand');
  const replacement = await client();
  assert.equal((await emit(replacement, 'rejoin', { code: identity.roomCode, playerId: identity.playerId, token: 'wrong' })).ok, false);
  await ok(replacement, 'rejoin', { code: identity.roomCode, playerId: identity.playerId, token: identity.token });
  assert.equal(replacement.state.turn, identity.playerId);
  assert.equal(replacement.state.players.find(p => p.id === identity.playerId).stack, 995);
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
