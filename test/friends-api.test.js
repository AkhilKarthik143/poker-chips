import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { hashSecret } from '../src/auth.js';
import { THIRTY_DAYS } from '../src/identity.js';

const tokenFor = id => ({ alice: 'a', bob: 'b', cara: 'c' })[id].repeat(64);

test('friends API requires an account, validates input, syncs requests and limits search', async t => {
  const store = new SqliteStore(':memory:');
  for (const id of ['alice', 'bob', 'cara']) {
    await store.createAccount(id, `${id}@example.com`, id, 0);
    await store.updateProfile(id, { username: id }, 1, THIRTY_DAYS);
    await store.saveSession(hashSecret(tokenFor(id)), id, 100_000);
  }
  const server = createServer({ store, now: () => 1000, mailer: { enabled: true, send: async () => {} } });
  const noDb = createServer({});
  const root = `http://127.0.0.1:${(await server.listen()).port}`;
  const noDbRoot = `http://127.0.0.1:${(await noDb.listen()).port}`;
  t.after(async () => { await server.close(); await noDb.close(); });
  const request = (id, path, action = null, body = {}) => fetch(root + path, { method: action ? 'POST' : 'GET',
    headers: { ...(id ? { Cookie: `tm_session=${tokenFor(id)}` } : {}),
      ...(action ? { 'Content-Type': 'application/json' } : {}) },
    ...(action ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request(null, '/api/friends')).status, 401);
  assert.equal((await fetch(noDbRoot + '/api/friends')).status, 404);
  assert.equal((await request('alice', '/api/friends/search?q=bo')).status, 200);
  const search = await (await request('alice', '/api/friends/search?q=bo')).json();
  assert.deepEqual(search.users.map(item => [item.username, item.status]), [['bob', 'not-friends']]);
  assert.equal(JSON.stringify(search).includes('@example.com'), false);
  assert.deepEqual((await (await request('alice', '/api/friends/search?q=zz')).json()).users, []);
  assert.equal((await request('alice', '/api/friends/search?q=%25')).status, 400);
  assert.equal((await request('alice', '/api/friends/alice/send', true)).status, 400);
  assert.equal((await request('alice', '/api/friends/bob/send', true, { senderId: 'cara' })).status, 400);
  assert.equal((await request('alice', '/api/friends/bob/send', true)).status, 200);
  assert.equal((await request('alice', '/api/friends/bob/send', true)).status, 200);
  assert.equal((await (await request('bob', '/api/friends')).json()).incoming.length, 1);
  assert.equal((await (await request('bob', '/api/friends/summary')).json()).unread, 1);
  assert.equal((await request('cara', '/api/friends/alice/accept', true)).status, 409);
  assert.equal((await request('bob', '/api/friends/alice/accept', true)).status, 200);
  assert.equal((await (await request('alice', '/api/friends')).json()).friends.length, 1);
  assert.equal((await (await request('alice', '/api/friends')).json()).notifications[0].kind, 'accepted');
  assert.equal((await request('alice', '/api/friends/notifications/read', true)).status, 200);
  assert.equal((await (await request('alice', '/api/friends/summary')).json()).unread, 0);
  assert.equal((await request('bob', '/api/friends/alice/remove', true)).status, 200);
  assert.equal((await request('bob', '/api/friends/alice/block', true)).status, 200);
  assert.equal((await request('alice', '/api/friends/bob/send', true)).status, 404);
  assert.equal((await request('bob', '/api/friends/alice/unblock', true)).status, 200);
  assert.equal((await (await request('bob', '/api/friends')).json()).friends.length, 0);
  for (let index = 0; index < 27; index++) await request('alice', '/api/friends/search?q=bo');
  assert.equal((await request('alice', '/api/friends/search?q=bo')).status, 429);
});

test('an account seat can start a friendship without exposing account IDs or changing poker state', async t => {
  const store = new SqliteStore(':memory:');
  for (const id of ['alice', 'bob']) {
    await store.createAccount(id, `${id}@example.com`, id, 0);
    await store.updateProfile(id, { username: id }, 1, THIRTY_DAYS);
    await store.saveSession(hashSecret(tokenFor(id)), id, 100_000);
  }
  const server = createServer({ store, now: () => 1000, mailer: { enabled: true, send: async () => {} } });
  const root = `http://127.0.0.1:${(await server.listen()).port}`;
  const sockets = []; t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  async function socket(id) {
    const client = connect(root, { transports: ['websocket'], forceNew: true,
      ...(id ? { extraHeaders: { Cookie: `tm_session=${tokenFor(id)}` } } : {}) });
    sockets.push(client); await new Promise(resolve => client.once('connect', resolve)); return client;
  }
  const alice = await socket('alice');
  const created = await new Promise(resolve => alice.emit('create', { name: 'Alice', settings: {} }, resolve));
  const bob = await socket('bob');
  const joined = await new Promise(resolve => bob.emit('join', { code: created.roomCode, name: 'Bob' }, resolve));
  const guest = await socket(null);
  const currentState = new Promise(resolve => alice.once('state', resolve));
  const guestJoin = await new Promise(resolve => guest.emit('join', { code: created.roomCode, name: 'Guest' }, resolve));
  assert.equal(guestJoin.ok, true);
  const current = await currentState;
  assert.deepEqual(current.socialSeats, [joined.playerId]);
  assert.deepEqual(guestJoin.state.socialSeats, []);
  const headers = { Cookie: `tm_session=${tokenFor('alice')}` };
  const path = `/api/friends/table/${created.roomCode}/${joined.playerId}`;
  const peer = await (await fetch(root + path, { headers })).json();
  assert.equal(peer.displayName, 'bob');
  assert.equal(JSON.stringify(peer).includes('bob@example.com'), false);
  assert.equal(JSON.stringify(current).includes('bob@example.com'), false);
  assert.equal(JSON.stringify(current).includes('alice@example.com'), false);
  const before = current.revision;
  assert.equal((await fetch(root + path + '/request', { method: 'POST', headers: { ...headers,
    'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  bob.disconnect();
  const bobAgain = await socket('bob');
  const after = await new Promise(resolve => bobAgain.emit('rejoin', { code: created.roomCode,
    playerId: joined.playerId, token: joined.token }, resolve));
  assert.equal(after.state.revision, before);
  assert.equal(after.state.street, current.street);
  assert.equal((await (await fetch(root + '/api/friends', { headers })).json()).outgoing.length, 1);
  assert.equal((await fetch(root + `/api/friends/table/${created.roomCode}/${guestJoin.playerId}`, { headers })).status, 404);
  assert.equal((await fetch(root + path)).status, 401);
});
