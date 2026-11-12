import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { hashSecret } from '../src/auth.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { LeagueStore } from '../src/league-store.js';

const ask = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));

test('league co-host controls follow the signed-in roster role, even after role changes and reconnects', async t => {
  const store = new SqliteStore(':memory:');
  const roster = new LeagueStore(store.db);
  const accounts = {};
  const cookies = {};
  for (const name of ['owner', 'co', 'member']) {
    accounts[name] = await store.createAccount(randomUUID(), `${name}@example.com`, name, Date.now());
    const token = randomBytes(32).toString('hex');
    await store.saveSession(hashSecret(token), accounts[name].id, Date.now() + 60_000);
    cookies[name] = `tm_session=${token}`;
  }
  const leagueId = randomUUID();
  (await roster.create({ id: leagueId, name: 'Friday Night', inviteCode: 'ABCDEFGH',
    settings: { startingStack: 1000, smallBlind: 5, bigBlind: 10, blindMinutes: 0, centsPer1000Chips: 0 },
    account: accounts.owner, memberId: randomUUID(), time: Date.now() }));
  const coMember = (await roster.join(leagueId, accounts.co, randomUUID(), Date.now()));
  (await roster.join(leagueId, accounts.member, randomUUID(), Date.now()));
  (await roster.setRole(leagueId, coMember.id, 'co'));
  const server = createServer({ store, mailer: { enabled: true, send: async () => {} } });
  const { port } = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = async cookie => {
    const socket = connect(base, { transports: ['websocket'], forceNew: true,
      ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}) });
    sockets.push(socket);
    socket.on('state', state => { socket.state = state; });
    await new Promise(resolve => socket.once('connect', resolve));
    return socket;
  };
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  const owner = await open(cookies.owner);
  const co = await open(cookies.co);
  const member = await open(cookies.member);
  const guest = await open();
  const created = await ask(owner, 'create', { name: 'Owner', leagueId });
  const coSeat = await ask(co, 'join', { name: 'Co', code: created.roomCode });
  const memberSeat = await ask(member, 'join', { name: 'Member', code: created.roomCode });
  const guestSeat = await ask(guest, 'join', { name: 'Guest', code: created.roomCode });
  const room = server.rooms.get(created.roomCode);
  const auth = result => ({ token: result.token, revision: room.revision });
  assert.deepEqual(created.state.permissions, { manage: true, owner: true });
  assert.deepEqual(coSeat.state.permissions, { manage: true, owner: false });
  assert.deepEqual(memberSeat.state.permissions, { manage: false, owner: false });
  assert.deepEqual(guestSeat.state.permissions, { manage: false, owner: false });
  assert.equal((await ask(member, 'host-settings', { ...auth(memberSeat), settings: { smallBlind: 10 } })).ok, false);
  assert.equal((await ask(guest, 'start-hand', auth(guestSeat))).ok, false);
  assert.equal((await ask(co, 'undo', auth(coSeat))).ok, false);
  assert.equal((await ask(co, 'rebuy', { ...auth(coSeat), playerId: memberSeat.playerId, amount: 100 })).ok, false);
  assert.equal((await ask(co, 'kick', { ...auth(coSeat), playerId: guestSeat.playerId })).ok, false);
  assert.equal((await ask(co, 'host-settings', { ...auth(coSeat), settings: { smallBlind: 10, bigBlind: 20 } })).ok, true);
  assert.equal((await ask(co, 'host:rebuyPolicy', { token: coSeat.token, mode: 'host' })).ok, true);
  assert.equal((await ask(member, 'rebuy:request', { token: memberSeat.token, amount: 200 })).ok, true);
  assert.deepEqual((await ask(co, 'rebuy:approve', { ...auth(coSeat), playerId: memberSeat.playerId })).state.rebuyRequests, []);
  assert.equal((await ask(co, 'start-hand', auth(coSeat))).ok, true);

  const roleUpdate = new Promise(resolve => co.once('state', resolve));
  const demoted = await fetch(`${base}/api/leagues/${leagueId}/members/${coMember.id}`, {
    method: 'PATCH', headers: { Cookie: cookies.owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'member' }) });
  assert.equal(demoted.status, 200);
  assert.deepEqual((await roleUpdate).permissions, { manage: false, owner: false });
  assert.equal((await ask(co, 'host:rebuyPolicy', { token: coSeat.token, mode: 'host' })).ok, false);
  (await roster.setRole(leagueId, coMember.id, 'co'));
  const anonymousReconnect = await open();
  const stolenSeat = await ask(anonymousReconnect, 'rejoin', { code: created.roomCode, playerId: coSeat.playerId, token: coSeat.token });
  assert.deepEqual(stolenSeat.state.permissions, { manage: false, owner: false });
  assert.equal(stolenSeat.state.signedIn, false);
  assert.equal((await ask(anonymousReconnect, 'host:rebuyPolicy', { token: coSeat.token, mode: 'host' })).ok, false);
  const signedReconnect = await open(cookies.co);
  const recovered = await ask(signedReconnect, 'rejoin', { code: created.roomCode, playerId: coSeat.playerId, token: coSeat.token });
  assert.deepEqual(recovered.state.permissions, { manage: true, owner: false });
  assert.equal((await ask(signedReconnect, 'host:rebuyPolicy', { token: coSeat.token, mode: 'host' })).ok, true);
  assert.equal(JSON.stringify(recovered.state).includes(accounts.co.id), false);
  assert.equal(JSON.stringify(recovered.state).includes(accounts.co.email), false);
  const signedOutState = new Promise(resolve => signedReconnect.once('state', resolve));
  const loggedOut = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookies.co } });
  assert.equal(loggedOut.status, 200);
  assert.deepEqual((await signedOutState).permissions, { manage: false, owner: false });
  assert.equal((await ask(signedReconnect, 'host:rebuyPolicy', { token: coSeat.token, mode: 'host' })).ok, false);
  const freshSession = randomBytes(32).toString('hex');
  await store.saveSession(hashSecret(freshSession), accounts.co.id, Date.now() + 60_000);
  const activeCo = await open(`tm_session=${freshSession}`);
  const activeRejoin = await ask(activeCo, 'rejoin', { code: created.roomCode, playerId: coSeat.playerId, token: coSeat.token });
  assert.equal(activeRejoin.ok, true, activeRejoin.error);
  assert.equal(activeRejoin.state.permissions.manage, true);
  const seats = new Map([[created.playerId, [owner, created.token]], [coSeat.playerId, [activeCo, coSeat.token]],
    [memberSeat.playerId, [member, memberSeat.token]], [guestSeat.playerId, [guest, guestSeat.token]]]);
  for (let i = 0; i < 4 && room.game.street !== 'complete'; i++) {
    const [actor, token] = seats.get(room.game.turn);
    const folded = await ask(actor, 'action', { token, revision: room.revision, type: 'fold' });
    assert.equal(folded.ok, true, folded.error);
  }
  assert.equal(room.game.street, 'complete');
  assert.equal((await ask(activeCo, 'host:endNight', { token: coSeat.token, revision: room.revision })).ok, true);
  assert.equal(server.rooms.has(created.roomCode), false);
});
