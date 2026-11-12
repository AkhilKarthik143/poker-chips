import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { DEFAULT_PREFS } from '../src/prefs-schema.js';

const ask = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));
const seat = result => ({ token: result.token, revision: result.state.revision });

test('seat cosmetics validate, broadcast, avoid revisions and leave cleanly', async t => {
  const store = new SqliteStore(':memory:');
  const sent = [];
  const server = createServer({ store, mailer: { enabled: true, send: async (_email, link) => sent.push(link) } });
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  const open = async cookie => { const socket = connect(url, { transports: ['websocket'], forceNew: true,
    extraHeaders: cookie ? { Cookie: cookie } : {} }); sockets.push(socket);
    await new Promise(resolve => socket.once('connect', resolve)); return socket; };
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  const host = await open();
  const created = await ask(host, 'create', { name: 'Host', settings: {} });
  const guest = await open();
  const joined = await ask(guest, 'join', { code: created.roomCode, name: 'Guest' });
  assert.equal(joined.state.cosmetics[joined.playerId].color, 'c2');
  const beforeRevision = joined.state.revision;
  const seen = new Promise(resolve => host.once('state', state => { if (state.cosmetics[joined.playerId]?.avatar === 'palm') resolve(state); }));
  const styled = await ask(guest, 'seat:cosmetics', { ...seat(joined), avatar: 'palm', color: 'c3', note: 'River reader' });
  assert.equal(styled.ok, true);
  assert.equal(styled.state.revision, beforeRevision);
  assert.deepEqual(styled.state.cosmetics[joined.playerId], { avatar: 'palm', color: 'c3', note: 'River reader' });
  const hostView = await seen;
  assert.equal(hostView.cosmetics[joined.playerId].avatar, 'palm');
  for (const patch of [{ avatar: 'file:///photo.png' }, { color: 'c1' }, { note: '<b>' },
    { note: 'x'.repeat(25) }, { note: 'bad\u0000text' }, { note: 'okay', extra: 'bad' }]) {
    const result = await ask(guest, 'seat:cosmetics', { token: joined.token, ...patch });
    assert.equal(result.ok, false);
  }
  const started = await ask(host, 'start-hand', { token: created.token, revision: beforeRevision });
  assert.equal(started.ok, true, 'cosmetics did not invalidate an in-flight game action');
  assert.equal(JSON.stringify(hostView).includes('River reader'), true);
  const email = 'member@example.com';
  await fetch(url + '/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const verified = await fetch(url + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: new URL(sent[0]).searchParams.get('token') }) });
  const cookie = verified.headers.get('set-cookie');
  const accountId = (await store.db.prepare('SELECT id FROM accounts WHERE email = ?').get(email)).id;
  await store.saveSettings(accountId, { ...DEFAULT_PREFS, defaultAvatar: 'crown', defaultSeatColor: 'c4', note: 'Ace' }, Date.now());
  const member = await open(cookie);
  // A new seat can join once the hand ends; this separate room avoids changing game flow.
  const signedRoom = await ask(member, 'create', { name: 'Member', settings: {} });
  assert.deepEqual(signedRoom.state.cosmetics[signedRoom.playerId], { avatar: 'crown', color: 'c4', note: 'Ace' });
  assert.equal(JSON.stringify(signedRoom.state).includes(accountId), false);
  assert.equal(JSON.stringify(signedRoom.state).includes(email), false);
  assert.equal(JSON.stringify(signedRoom.state).includes('defaultAvatar'), false);
  assert.equal(JSON.stringify(signedRoom.state).includes(signedRoom.token), false);
  const left = await ask(member, 'leave', { token: signedRoom.token, revision: signedRoom.state.revision });
  assert.equal(left.ok, true);
  assert.equal(server.rooms.has(signedRoom.roomCode), false);
});
