import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/opaque',
  expirationTime: null,
  keys: { p256dh: 'B'.repeat(40), auth: 'A'.repeat(24) }
};

async function setup(t, { enabled = true, sendNotification = async () => {} } = {}) {
  const deliveries = [];
  const pushTransport = {
    setVapidDetails: (...args) => { deliveries.vapid = args; },
    sendNotification: (sub, payload, options) => {
      deliveries.push({ subscription: sub, payload: JSON.parse(payload), options });
      return sendNotification(sub, payload, options);
    }
  };
  const server = createServer({
    pushTransport,
    vapid: enabled ? { publicKey: 'public-vapid-key', privateKey: 'private-vapid-key', subject: 'mailto:test@example.com' } : {},
    logError: () => {}
  });
  const address = await server.listen(); const url = `http://127.0.0.1:${address.port}`; const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  async function client() {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false }); sockets.push(socket);
    socket.on('state', state => { socket.state = state; });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  return { server, client, deliveries };
}

function emit(socket, event, data = {}) {
  const payload = { ...(!['create', 'join', 'rejoin', 'table-preview'].includes(event) ? { revision: socket.state?.revision, token: socket.token } : {}), ...data };
  return new Promise((resolve, reject) => socket.timeout(2000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response)));
}
async function ok(socket, event, data) {
  const result = await emit(socket, event, data); assert.equal(result.ok, true, result.error);
  if (result.state) socket.state = result.state;
  if (result.token) socket.token = result.token;
  return result;
}
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await nextTask();
  assert.equal(predicate(), true, 'socket states did not reach the latest revision');
}

test('push config stays private, subscriptions and presence do not change revisions, and hidden turns notify', async t => {
  const { client, server, deliveries } = await setup(t); const host = await client(); const guest = await client();
  const created = await ok(host, 'create', { name: 'Host' });
  await ok(guest, 'join', { name: 'Guest', code: created.roomCode });
  const room = server.rooms.get(created.roomCode); await waitUntil(() => host.state.revision === room.revision);
  assert.equal(host.state.push.enabled, true); assert.equal(host.state.push.publicKey, 'public-vapid-key');
  const revision = room.revision;
  await ok(host, 'push:subscribe', { subscription, revision: 0 });
  await ok(guest, 'push:subscribe', { subscription: { ...subscription, endpoint: 'https://web.push.apple.com/guest' } });
  await ok(host, 'presence', { hidden: false }); await ok(guest, 'presence', { hidden: false });
  assert.equal(room.revision, revision);
  assert.equal(JSON.stringify(host.state).includes(subscription.endpoint), false);
  assert.equal(JSON.stringify(guest.state).includes(subscription.endpoint), false);
  assert.equal(JSON.stringify(host.state).includes(host.token), false);
  assert.equal(room.pushSubscriptions.has(host.state.playerId), true); assert.equal(room.pushSubscriptions.has(guest.state.playerId), true);

  await ok(host, 'start-hand');
  await waitUntil(() => guest.state.revision === room.revision);
  assert.equal(deliveries.length, 0, 'the first actor is foregrounded');
  const actorId = room.game.turn;
  const actor = actorId === host.state.playerId ? host : guest;
  const target = actor === host ? guest : host;
  await ok(target, 'presence', { hidden: true });
  const move = actor.state.legal.canCheck ? 'check' : 'call';
  await ok(actor, 'action', { type: move }); await waitUntil(() => target.state.revision === room.revision); await nextTask();
  assert.equal(room.game.turn, target.state.playerId);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].payload.body, `Your turn at table ${created.roomCode}`);
  assert.equal(deliveries[0].payload.tag, `tablemate-${created.roomCode}`);
  assert.deepEqual(deliveries[0].options, { TTL: 60, urgency: 'high' });

  const beforeUnsubscribe = room.revision;
  await ok(target, 'push:unsubscribe');
  assert.equal(room.revision, beforeUnsubscribe);
  assert.equal(room.pushSubscriptions.has(target.state.playerId), false);
});

test('disconnected subscriptions receive turn changes and expired endpoints are removed', async t => {
  const { client, server, deliveries } = await setup(t, { sendNotification: async () => { const error = new Error('Gone'); error.statusCode = 410; throw error; } });
  const host = await client(); const guest = await client(); const created = await ok(host, 'create', { name: 'Host' });
  await ok(guest, 'join', { name: 'Guest', code: created.roomCode });
  const room = server.rooms.get(created.roomCode); await waitUntil(() => host.state.revision === room.revision);
  await ok(host, 'push:subscribe', { subscription });
  await ok(guest, 'push:subscribe', { subscription: { ...subscription, endpoint: 'https://web.push.apple.com/guest' } });
  await ok(host, 'start-hand');
  await waitUntil(() => guest.state.revision === room.revision);
  const actorId = room.game.turn;
  const actor = actorId === host.state.playerId ? host : guest;
  const target = actor === host ? guest : host;
  const targetServerSocket = server.io.sockets.sockets.get(target.id);
  const disconnected = new Promise(resolve => targetServerSocket.once('disconnect', resolve));
  target.disconnect(); await disconnected;
  const move = actor.state.legal.canCheck ? 'check' : 'call';
  await ok(actor, 'action', { type: move }); await waitUntil(() => room.game.turn === target.state.playerId); await nextTask();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].subscription.endpoint, target === host ? subscription.endpoint : 'https://web.push.apple.com/guest');
  assert.equal(room.pushSubscriptions.has(target.state.playerId), false, '410 endpoints are forgotten');
});

test('missing VAPID configuration disables the feature and rejects subscription storage', async t => {
  const { client } = await setup(t, { enabled: false }); const host = await client(); const created = await ok(host, 'create', { name: 'Host' });
  assert.equal(host.state.push.enabled, false); assert.equal(host.state.push.publicKey, '');
  assert.equal((await emit(host, 'push:subscribe', { subscription })).ok, false);
  assert.equal((await emit(host, 'push:subscribe', { subscription: { ...subscription, extra: 'leak' } })).ok, false);
  assert.equal((await emit(host, 'push:subscribe', { subscription: { ...subscription, endpoint: 'https://127.0.0.1:443/internal' } })).ok, false);
  assert.equal((await emit(host, 'presence', { hidden: 'false' })).ok, false);
  assert.equal(host.state.roomCode, created.roomCode);
});
