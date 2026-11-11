import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { createAuth } from '../src/auth.js';

const absentAvatarCreatorRoot = fileURLToPath(new URL('./fixtures/no-creator-build/', import.meta.url));

test('new accounts get distinct safe default display names', async () => {
  const links = [];
  const store = new SqliteStore(':memory:');
  const auth = createAuth({ store, mailer: { send: async (_email, link) => links.push(link) } });
  const names = [];
  for (const email of ['same@first.example', 'same@second.example']) {
    await auth.request(email, 'http://localhost');
    names.push((await auth.verify(new URL(links.at(-1)).searchParams.get('token'))).account.display_name);
  }
  const google = await auth.google({ sub: 'third-person', email: 'third@example.com', email_verified: true, name: 'same' });
  assert.deepEqual([...names, google.account.display_name], ['same', 'same 2', 'same 3']);
  const longName = 'abcdefghijklmnopqrst';
  await store.createAccount('long-1', 'long@first.example', longName, Date.now());
  const clipped = await store.createAccount('long-2', 'long@second.example', longName, Date.now());
  assert.equal(clipped.display_name, `${longName.slice(0, 18)} 2`);
});

test('magic link is single-use, session is private and logout invalidates it', async t => {
  let time = 1_000;
  const sent = [];
  const store = new SqliteStore(':memory:');
  const server = createServer({ store, now: () => time, mailer: { enabled: true, send: async (_email, link) => sent.push(link) },
    avatarCreatorRoot: absentAvatarCreatorRoot });
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  const post = (path, body, cookie) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  assert.deepEqual(await (await fetch(url + '/api/config')).json(), { accounts: true, email: true, googleClientId: null, avatarCreator: false });
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
  assert.equal(me.displayName, 'alex'); assert.equal(me.email, 'alex@example.com');
  assert.equal(me.username, null); assert.equal(me.privacy.showUsernameAtTables, false);
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
  const server = createServer({ googleClientId: '12345-test.apps.googleusercontent.com' });
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());
  assert.deepEqual(await (await fetch(url + '/api/config')).json(), { accounts: false, email: false, googleClientId: null, avatarCreator: false });
  assert.equal((await fetch(url + '/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(url + '/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(url + '/api/me')).status, 404);
});

test('local sign-in link requires an explicit demo flag and console mailer', async t => {
  const sent = [];
  const servers = [];
  t.after(async () => { for (const server of servers) await server.close(); });
  async function request(devLogin, local) {
    const server = createServer({ store: new SqliteStore(':memory:'), devLogin,
      mailer: { enabled: true, local, send: async (_email, link) => sent.push(link) } });
    servers.push(server);
    const address = await server.listen();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@example.com' })
    });
    return response.json();
  }
  const normal = await request(false, true);
  const nonlocalMailer = await request(true, false);
  const demo = await request(true, true);
  assert.deepEqual(normal, nonlocalMailer);
  assert.deepEqual(demo.message, normal.message);
  assert.equal('devLink' in normal, false);
  assert.equal('devLink' in nonlocalMailer, false);
  assert.equal(demo.devLink, sent.at(-1));
  assert.match(new URL(demo.devLink).searchParams.get('token'), /^[a-f0-9]{64}$/);
});

test('Google sign-in verifies a credential, links by subject and uses the normal session', async t => {
  const store = new SqliteStore(':memory:');
  const sent = [];
  const clientId = '12345-test.apps.googleusercontent.com';
  const identities = new Map([
    ['new', { sub: 'google-123', email: 'alex@gmail.com', email_verified: true, name: 'Alex' }],
    ['renamed', { sub: 'google-123', email: 'new-address@gmail.com', email_verified: true, name: 'New Name' }],
    ['unverified', { sub: 'unverified-789', email: 'bad@gmail.com', email_verified: false }],
    ['external', { sub: 'external-456', email: 'friend@example.com', email_verified: true, name: 'Friend' }]
  ]);
  const server = createServer({ store, googleClientId: clientId,
    mailer: { enabled: true, send: async (_email, link) => sent.push(link) },
    verifyGoogleIdToken: async (credential, audience) => {
      assert.equal(audience, clientId);
      if (!identities.has(credential)) throw new Error('invalid signature');
      return identities.get(credential);
    }, logError: () => {}, avatarCreatorRoot: absentAvatarCreatorRoot });
  const { port } = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  t.after(() => server.close());
  const post = (path, body, headers = {}) => fetch(url + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.deepEqual(await (await fetch(url + '/api/config')).json(), { accounts: true, email: true, googleClientId: clientId, avatarCreator: false });
  const loginPolicy = (await fetch(url + '/login.html')).headers.get('content-security-policy');
  assert.match(loginPolicy, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(loginPolicy, /style-src 'self' 'unsafe-inline' https:\/\/accounts\.google\.com\/gsi\/style/,
    'Google renders its compact button using injected styles');
  const tablePolicy = (await fetch(url + '/')).headers.get('content-security-policy');
  assert.doesNotMatch(tablePolicy, /accounts\.google\.com|'unsafe-inline'/);
  assert.equal((await post('/api/auth/google', { credential: 'bad' })).status, 400);
  assert.equal((await post('/api/auth/google', { credential: 'wrong.token.sig' })).status, 401);
  identities.set('unverified.token.sig', identities.get('unverified'));
  assert.equal((await post('/api/auth/google', { credential: 'unverified.token.sig' })).status, 401);
  assert.equal((await post('/api/auth/google', { credential: 'new.token.sig' }, { Origin: 'https://foreign.example' })).status, 403);
  identities.set('new.token.sig', identities.get('new'));
  const signedIn = await post('/api/auth/google', { credential: 'new.token.sig' });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Lax/);
  assert.equal((await (await fetch(url + '/api/me', { headers: { Cookie: cookie } })).json()).displayName, 'Alex');
  assert.deepEqual((await (await fetch(url + '/api/me/export', { headers: { Cookie: cookie } })).json()).googleIdentities, ['google-123']);
  identities.set('renamed.token.sig', identities.get('renamed'));
  const returning = await post('/api/auth/google', { credential: 'renamed.token.sig' });
  assert.equal(returning.status, 200);
  assert.equal((await (await fetch(url + '/api/me', { headers: { Cookie: returning.headers.get('set-cookie') } })).json()).email,
    'alex@gmail.com', 'Google subject stays linked if its email changes');
  await post('/api/auth/request', { email: 'friend@example.com' });
  await post('/api/auth/verify', { token: new URL(sent.at(-1)).searchParams.get('token') });
  identities.set('external.token.sig', identities.get('external'));
  const conflict = await post('/api/auth/google', { credential: 'external.token.sig' });
  assert.equal(conflict.status, 409, 'an untrusted third-party email cannot silently link an existing account');
  const deleted = await fetch(url + '/api/me', { method: 'DELETE', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' }) });
  assert.equal(deleted.status, 200);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM google_identities').get().n, 0);
});

test('Google-only accounts work without mail delivery', async t => {
  const server = createServer({ store: new SqliteStore(':memory:'), googleClientId: '12345-test.apps.googleusercontent.com',
    mailer: { enabled: false, send: async () => {} },
    verifyGoogleIdToken: async () => ({ sub: 'subject-1', email: 'guest@gmail.com', email_verified: true }),
    avatarCreatorRoot: absentAvatarCreatorRoot });
  const { port } = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  t.after(() => server.close());
  assert.deepEqual(await (await fetch(url + '/api/config')).json(),
    { accounts: true, email: false, googleClientId: '12345-test.apps.googleusercontent.com', avatarCreator: false });
  const headers = { 'Content-Type': 'application/json' };
  assert.equal((await fetch(url + '/api/auth/request', { method: 'POST', headers, body: '{}' })).status, 404);
  assert.equal((await fetch(url + '/api/auth/google', { method: 'POST', headers,
    body: JSON.stringify({ credential: 'valid.token.sig' }) })).status, 200);
});
