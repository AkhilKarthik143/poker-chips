import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { SqliteStore } from '../src/store/sqlite.js';
import { createServer } from '../src/server.js';
import { hashSecret } from '../src/auth.js';
import { LeagueStore } from '../src/league-store.js';
import { THIRTY_DAYS, defaultAvatarV2 } from '../src/identity.js';

test('profiles require shared league, hide private users uniformly, and update atomically', async t => {
  const store = new SqliteStore(':memory:');
  const names = ['alice', 'bob', 'carol'];
  const sessionToken = name => ({ alice: 'a', bob: 'b', carol: 'c' })[name].repeat(64);
  for (const name of names) {
    await store.createAccount(name, `${name}@example.com`, name, 1_700_000_000_000);
    await store.updateProfile(name, { username: name }, 1_700_000_000_000, THIRTY_DAYS);
    await store.saveSession(hashSecret(sessionToken(name)), name, 1_800_000_000_000);
  }
  const leagues = new LeagueStore(store.db);
  const alice = await store.getAccount('alice'); const bob = await store.getAccount('bob');
  const leagueId = '11111111-1111-4111-8111-111111111111';
  (await leagues.create({ id: leagueId, name: 'Friday', inviteCode: 'ABCDEFGH', settings: {}, account: alice, memberId: 'member-1', time: 1 }));
  (await leagues.join(leagueId, bob, 'member-2', 2));
  const server = createServer({ store, now: () => 1_700_000_000_100, mailer: { enabled: true, send: async () => {} } });
  const { port } = await server.listen(); const root = `http://127.0.0.1:${port}`;
  t.after(() => server.close());
  const cookie = name => `tm_session=${sessionToken(name)}`;
  const get = (path, name) => fetch(root + path, { headers: name ? { Cookie: cookie(name) } : {} });
  const put = (name, body) => fetch(root + '/api/me/profile', { method: 'PUT',
    headers: { Cookie: cookie(name), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await get('/api/u/alice')).status, 401);
  const visibleResponse = await get('/api/u/alice', 'bob');
  assert.equal(visibleResponse.status, 200, await visibleResponse.clone().text());
  const visible = await visibleResponse.json();
  assert.deepEqual(visible.sharedLeagues, [{ id: leagueId, name: 'Friday' }]);
  assert.equal(visible.username, 'alice'); assert.equal(visible.memberSince, 'November 2023');
  for (const secret of ['alice@example.com', 'alice', 'tm_session', 'profileVisibility']) {
    if (secret === 'alice') continue;
    assert.equal(JSON.stringify(visible).includes(secret), false);
  }
  const hidden = await get('/api/u/alice', 'carol');
  const missing = await get('/api/u/missing', 'carol');
  assert.equal(hidden.status, 404); assert.equal(await hidden.text(), await missing.text());
  assert.equal((await put('alice', { displayName: 'Alice New', avatar: { shape: 'circle' } })).status, 400);
  assert.equal((await get('/api/me', 'alice')).status, 200);
  assert.equal((await (await get('/api/me', 'alice')).json()).displayName, 'alice', 'invalid patch rolls back');
  const privacy = { profileVisibility: 'private', showUsernameAtTables: false, showAvatarAtTables: true };
  assert.equal((await put('alice', { displayName: 'Alice New', privacy })).status, 200);
  assert.equal((await (await get('/api/me', 'alice')).json()).displayName, 'Alice New');
  assert.equal((await put('alice', { username: 'bob', displayName: 'Wrong Name' })).status, 409);
  assert.equal((await (await get('/api/me', 'alice')).json()).displayName, 'Alice New', 'a conflicting username rolls back the accompanying name');
  assert.equal((await put('bob', { displayName: 'Alice New' })).status, 200);
  const privateResult = await get('/api/u/alice', 'bob');
  assert.equal(privateResult.status, 404); assert.equal(await privateResult.text(), await (await get('/api/u/missing', 'bob')).text());
  assert.equal((await (await get('/api/u/alice', 'alice')).json()).displayName, 'Alice New');
  const roster = await (await get(`/api/leagues/${leagueId}`, 'bob')).json();
  assert.equal(roster.members.find(member => member.username === 'alice').displayName, 'Alice New');
  assert.equal(roster.members.find(member => member.username === 'bob').displayName, 'Alice New', 'duplicate display names remain distinguishable by username');
  assert.equal(JSON.stringify(roster).includes('alice@example.com'), false);
});

test('table view exposes only opted-in username and enum avatar', async t => {
  const store = new SqliteStore(':memory:');
  await store.createAccount('id-secret', 'secret@example.com', 'Alex', 1000);
  await store.updateProfile('id-secret', { username: 'AlexName' }, 1000, THIRTY_DAYS);
  const token = 'a'.repeat(64); await store.saveSession(hashSecret(token), 'id-secret', 100_000);
  const server = createServer({ store, now: () => 2000, mailer: { enabled: true, send: async () => {} } });
  const { port } = await server.listen(); const root = `http://127.0.0.1:${port}`;
  const sockets = []; t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  async function socket(cookie) {
    const client = connect(root, { transports: ['websocket'], forceNew: true,
      ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}) });
    sockets.push(client); await new Promise(resolve => client.once('connect', resolve)); return client;
  }
  const owner = await socket(`tm_session=${token}`);
  const created = await new Promise(resolve => owner.emit('create', { name: 'Alex', settings: {} }, resolve));
  const guest = await socket();
  const joined = await new Promise(resolve => guest.emit('join', { code: created.roomCode, name: 'Guest' }, resolve));
  assert.equal(joined.ok, true);
  const state = joined.state;
  assert.deepEqual(state.identities[created.playerId].avatar, defaultAvatarV2('id-secret'));
  assert.deepEqual(Object.keys(state.identities[created.playerId]), ['avatar']);
  assert.equal('username' in state.identities[created.playerId], false);
  for (const secret of ['secret@example.com', 'id-secret', token, 'showUsernameAtTables']) assert.equal(JSON.stringify(state).includes(secret), false);
  const changedAvatar = { ...defaultAvatarV2('id-secret'), hat: 'cowboy' };
  const avatarState = new Promise(resolve => guest.once('state', resolve));
  const avatarResponse = await fetch(root + '/api/me/profile', { method: 'PUT', headers: { Cookie: `tm_session=${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar: changedAvatar }) });
  assert.equal(avatarResponse.status, 200);
  assert.deepEqual((await avatarState).identities[created.playerId].avatar, changedAvatar);
  const nextState = new Promise(resolve => guest.once('state', resolve));
  const response = await fetch(root + '/api/me/profile', { method: 'PUT', headers: { Cookie: `tm_session=${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ privacy: { profileVisibility: 'leagues', showUsernameAtTables: true, showAvatarAtTables: false } }) });
  assert.equal(response.status, 200);
  const next = await nextState;
  assert.equal(next.identities[created.playerId].username, 'AlexName');
  assert.equal('avatar' in next.identities[created.playerId], false);
  const afterLogout = new Promise(resolve => guest.once('state', resolve));
  await fetch(root + '/api/auth/logout', { method: 'POST', headers: { Cookie: `tm_session=${token}` } });
  assert.equal(created.playerId in (await afterLogout).identities, false);
});
