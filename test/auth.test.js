import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';

test('magic link is single-use, session is private and logout invalidates it', async t => {
  let time = 1_000;
  const sent = [];
  const store = new SqliteStore(':memory:');
  const server = createServer({ store, now: () => time, mailer: { enabled: true, send: async (_email, link) => sent.push(link) } });
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  const post = (path, body, cookie) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  assert.deepEqual(await (await fetch(url + '/api/config')).json(), { accounts: true });
  assert.equal((await fetch(url + '/api/auth/request', { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alex@example.com' }) })).status, 403);
  const first = await post('/api/auth/request', { email: 'ALEX@example.com' });
  const second = await post('/api/auth/request', { email: 'unknown@example.com' });
  assert.deepEqual(await first.json(), await second.json(), 'request never reveals account existence');
  await post('/api/auth/request', { email: 'alex@example.com' });
  await post('/api/auth/request', { email: 'alex@example.com' });
  assert.equal(sent.length, 4, 'three requests per address are allowed');
  await post('/api/auth/request', { email: 'alex@example.com' });
  assert.equal(sent.length, 4, 'a fourth request for the same address is rate limited');
  const token = new URL(sent[0]).searchParams.get('token');
  assert.ok(token);
  const verified = await post('/api/auth/verify', { token });
  assert.equal(verified.status, 200);
  assert.equal((await post('/api/auth/verify', { token })).status, 400);
  const cookie = verified.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Lax/);
  assert.equal((await fetch(url + '/api/me')).status, 401);
  const me = await (await fetch(url + '/api/me', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(me, { displayName: 'alex', email: 'alex@example.com' });
  const socket = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookie } });
  sockets.push(socket);
  await new Promise(resolve => socket.once('connect', resolve));
  const created = await new Promise(resolve => socket.emit('create', { name: 'Alex', settings: {} }, resolve));
  assert.equal(created.ok, true);
  assert.equal(created.state.signedIn, true);
  for (const secret of [me.email, token, cookie.split(';')[0], store.db.prepare('SELECT id FROM accounts').get().id]) {
    assert.equal(JSON.stringify(created.state).includes(secret), false);
  }
  await post('/api/auth/logout', {}, cookie);
  assert.equal((await fetch(url + '/api/me', { headers: { Cookie: cookie } })).status, 401);
  await post('/api/auth/request', { email: me.email });
  time += 16 * 60_000;
  assert.equal((await post('/api/auth/verify', { token: new URL(sent.at(-1)).searchParams.get('token') })).status, 400);
});

test('no-database mode hides auth endpoints', async t => {
  const server = createServer();
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());
  assert.deepEqual(await (await fetch(url + '/api/config')).json(), { accounts: false });
  assert.equal((await fetch(url + '/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(url + '/api/me')).status, 404);
});
