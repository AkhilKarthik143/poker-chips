import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect } from 'socket.io-client';
import { SqliteStore } from '../src/store/sqlite.js';
import { createServer } from '../src/server.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const cookieFor = token => `tm_session=${token}`;

async function session(store, accountId) {
  const token = randomBytes(32).toString('hex');
  await store.saveSession(hash(token), accountId, Date.now() + 60 * 60 * 1000);
  return cookieFor(token);
}

function emit(socket, event, payload = {}) {
  const needsSeat = !['create', 'join', 'rejoin', 'table-preview'].includes(event);
  return new Promise((resolve, reject) => socket.timeout(3000).emit(event,
    { ...(needsSeat ? { revision: socket.state?.revision, token: socket.token } : {}), ...payload },
    (error, reply) => error ? reject(error) : resolve(reply)));
}

async function barrier(server, sockets) {
  server.io.sockets.sockets.forEach(socket => {
    if (!socket.listenerCount('stats-test-ping')) socket.on('stats-test-ping', (_payload, ack) => ack());
  });
  await Promise.all(sockets.filter(socket => socket.connected).map(socket => new Promise(resolve => socket.emit('stats-test-ping', {}, resolve))));
}

test('completed gameplay becomes provisional, finalizes once, and survives restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tablemate-stats-'));
  const dbPath = join(dir, 'tablemate.db');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const firstStore = new SqliteStore(dbPath);
  await firstStore.init();
  const alex = await firstStore.createAccount(randomUUID(), 'alex@example.com', 'Alex', 1);
  const blair = await firstStore.createAccount(randomUUID(), 'blair@example.com', 'Blair', 1);
  const alexCookie = await session(firstStore, alex.id);
  const blairCookie = await session(firstStore, blair.id);
  const serverOptions = store => ({ store, googleClientId: 'stats-test.apps.googleusercontent.com', mailer: { enabled: false, send: async () => {} } });
  const first = createServer(serverOptions(firstStore));
  const address = await first.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  const client = async cookie => {
    const socket = connect(base, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookie } });
    sockets.push(socket);
    socket.on('state', state => { socket.state = state; });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  };

  try {
    const alexSocket = await client(alexCookie);
    const blairSocket = await client(blairCookie);
    const created = await emit(alexSocket, 'create', { name: 'Alex' });
    alexSocket.token = created.token; alexSocket.state = created.state;
    const nightId = created.state.nightId;
    const joined = await emit(blairSocket, 'join', { code: created.roomCode, name: 'Blair' });
    blairSocket.token = joined.token; blairSocket.state = joined.state;
    await barrier(first, sockets);

    const started = await emit(alexSocket, 'start-hand');
    assert.equal(started.ok, true, started.error);
    alexSocket.state = started.state;
    await barrier(first, sockets);
    const firstActor = alexSocket.state.turn === alexSocket.state.playerId ? alexSocket : blairSocket;
    const showdownActor = firstActor === alexSocket ? blairSocket : alexSocket;
    const allIn = await emit(firstActor, 'action', { type: 'all-in' });
    assert.equal(allIn.ok, true, allIn.error);
    firstActor.state = allIn.state;
    await barrier(first, sockets);
    const call = await emit(showdownActor, 'action', { type: 'call' });
    assert.equal(call.ok, true, call.error);
    showdownActor.state = call.state;
    await barrier(first, sockets);
    assert.equal(showdownActor.state.street, 'showdown');
    const pot = showdownActor.state.pots[0];
    const picked = await emit(alexSocket, 'showdown-pick', { potId: pot.id, winnerIds: [pot.eligible[0]] });
    assert.equal(picked.ok, true, picked.error);
    alexSocket.state = picked.state;
    await barrier(first, sockets);

    const firstLoser = picked.state.players.find(player => player.stack === 0);
    assert.ok(firstLoser, 'the all-in hand leaves a player eligible for a rebuy');
    const rebuy = await emit(alexSocket, 'rebuy', { playerId: firstLoser.id, amount: 100 });
    assert.equal(rebuy.ok, true, rebuy.error);
    alexSocket.state = rebuy.state;
    await barrier(first, sockets);

    const secondStarted = await emit(alexSocket, 'start-hand');
    assert.equal(secondStarted.ok, true, secondStarted.error);
    alexSocket.state = secondStarted.state;
    await barrier(first, sockets);
    const secondActor = alexSocket.state.turn === alexSocket.state.playerId ? alexSocket : blairSocket;
    const secondFinished = await emit(secondActor, 'action', { type: 'fold' });
    assert.equal(secondFinished.ok, true, secondFinished.error);
    secondActor.state = secondFinished.state;
    await barrier(first, sockets);

    await first.rooms.get(created.roomCode).persistChain;
    const openNight = await firstStore.getNight(nightId);
    assert.equal(openNight.hands, 2, 'the second hand updates the existing night');
    assert.equal((await firstStore.db.prepare('SELECT COUNT(*) AS count FROM nights WHERE id = ?').get(nightId)).count, 1);
    let response = await fetch(`${base}/api/me/stats`, { headers: { Cookie: blairCookie } });
    assert.equal(response.status, 200);
    let stats = await response.json();
    assert.equal(stats.lifetime.nights, 0, 'an open night must not enter lifetime totals');
    assert.equal(stats.currentNight.provisional, true);
    assert.equal(stats.currentNight.stats.nights, 1);
    assert.ok(stats.currentNight.stats.handsPlayed >= 1, 'provisional stats include the completed gameplay hands that count for the player');

    const ended = await emit(alexSocket, 'host:endNight');
    assert.equal(ended.ok, true, ended.error);
    await first.rooms.get(created.roomCode).persistChain;
    const night = await firstStore.getNight(nightId);
    assert.equal(night.ended_at !== null, true);
    assert.equal(night.players.reduce((sum, player) => sum + player.net, 0), 0);

    response = await fetch(`${base}/api/me/stats`, { headers: { Cookie: blairCookie } });
    stats = await response.json();
    assert.equal(stats.lifetime.nights, 1);
    assert.equal(stats.currentNight, null);
    assert.equal(stats.nights.length, 1);
    assert.equal(stats.lifetime.handsPlayed >= 1, true);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    await first.close();
  }

  const secondStore = new SqliteStore(dbPath);
  const second = createServer(serverOptions(secondStore));
  try {
    const secondAddress = await second.listen();
    const response = await fetch(`http://127.0.0.1:${secondAddress.port}/api/me/stats`, { headers: { Cookie: blairCookie } });
    assert.equal(response.status, 200);
    const stats = await response.json();
    assert.equal(stats.lifetime.nights, 1);
    assert.equal(stats.nights.length, 1);
  } finally {
    await second.close();
  }
});
