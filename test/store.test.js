import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { SqliteStore } from '../src/store/sqlite.js';
import { createStore } from '../src/store/index.js';
import { createServer } from '../src/server.js';

const hash = value => createHash('sha256').update(value).digest('hex');

test('SQLite night upsert is idempotent, retains departed seats and preserves zero-sum nets', async t => {
  const store = new SqliteStore(':memory:');
  t.after(async () => (await store.close()));
  const row = (id, cashOut) => ({ id, name: id, claimHash: hash(id), buyIn: 100, cashOut,
    net: cashOut - 100, handsPlayed: 1, handsWon: Number(cashOut > 100), vpipHands: 1,
    pfrHands: 0, raises: 0, calls: 1, checks: 0, folds: 0, allIns: 0, showdowns: 1, showdownWins: Number(cashOut > 100) });
  const snapshot = { nightId: 'night-1', roomCode: 'ABCDEFGH', startedAt: 1, updatedAt: 2,
    hands: 1, settings: { startingStack: 100 }, settlement: { rows: [] }, players: [row('present', 120), row('departed', 80)] };
  await store.saveNight(snapshot);
  await store.saveNight({ ...snapshot, updatedAt: 3, endedAt: 3 });
  const saved = await store.getNight('night-1');
  assert.equal((await store.db.prepare('SELECT count(*) AS n FROM nights').get()).n, 1);
  assert.equal(saved.players.length, 2);
  assert.equal(saved.players.reduce((sum, player) => sum + player.net, 0), 0);
  assert.equal(saved.players.find(player => player.seat_id === 'departed').claim_hash, hash('departed'));
  assert.equal(saved.ended_at, 3);
  assert.equal(await store.claimNight('night-1', hash('wrong'), 'me'), 0);
  assert.equal(await store.claimNight('night-1', hash('departed'), 'me'), 1);
  assert.equal(await store.claimNight('night-1', hash('departed'), 'other'), 0);
  assert.equal((await store.getNight('night-1')).players.find(player => player.seat_id === 'departed').account_id, 'me');
});

test('no database configuration selects a no-op store', async () => {
  const store = createStore('');
  assert.equal(store.enabled, false);
  assert.equal(await store.getNight('anything'), null);
  await store.saveNight({});
});

test('completed hand persists without exposing seat token hash, and a store failure leaves play running', async t => {
  const store = new SqliteStore(':memory:');
  const errors = [];
  const server = createServer({ store, logError: error => errors.push(error.message) });
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  const client = async () => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    socket.on('state', value => { socket.state = value; });
    await new Promise(resolve => socket.once('connect', resolve));
    return socket;
  };
  const send = (socket, event, data = {}) => new Promise(resolve => socket.emit(event,
    { ...(['create', 'join'].includes(event) ? {} : { token: socket.token, revision: socket.state.revision }), ...data }, resolve));
  const a = await client(); const b = await client();
  const created = await send(a, 'create', { name: 'Alex' }); a.token = created.token; a.state = created.state;
  const joined = await send(b, 'join', { code: created.roomCode, name: 'Blair' }); b.token = joined.token; b.state = joined.state;
  await send(a, 'start-hand');
  const finished = await send(a, 'action', { type: 'fold' });
  assert.equal(finished.ok, true);
  assert.equal(finished.state.street, 'complete');
  const saved = await store.getNight(created.state.nightId);
  assert.equal(saved.players.length, 2);
  assert.equal(saved.players.reduce((sum, p) => sum + p.net, 0), 0);
  assert.equal(JSON.stringify(finished.state).includes(hash(created.token)), false);
  assert.equal((await send(b, 'host:endNight')).ok, false);
  assert.equal((await send(a, 'host:endNight')).ok, true);
  assert.ok((await store.getNight(created.state.nightId)).ended_at);
  store.saveNight = () => { throw new Error('disk full'); };
  const restarted = await send(a, 'start-hand');
  assert.equal(restarted.ok, true);
  b.state = { revision: restarted.state.revision };
  const nextHand = await send(b, 'action', { type: 'fold' });
  assert.equal(nextHand.ok, true, 'a failed save cannot interrupt a completed hand');
  await Promise.resolve();
  assert.deepEqual(errors, ['disk full']);
});
