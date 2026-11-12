import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { LeagueStore } from '../src/league-store.js';

test('league roster, locked season, saved results, review trail and private room settings', async t => {
  const links = [];
  const errors = [];
  const store = new SqliteStore(':memory:');
  const server = createServer({ store, mailer: { enabled: true, send: async (_email, link) => links.push(link) },
    logError: error => errors.push(error.message) });
  const address = await server.listen(); const base = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  const api = async (path, method = 'GET', body, cookie) => {
    const response = await fetch(base + path, { method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    let data; try { data = await response.json(); } catch { data = null; }
    return { status: response.status, data, cookie: response.headers.get('set-cookie') };
  };
  const account = async email => {
    await api('/api/auth/request', 'POST', { email });
    const token = new URL(links.at(-1)).searchParams.get('token');
    return (await api('/api/auth/verify', 'POST', { token })).cookie;
  };
  const aCookie = await account('alex@example.com');
  const bCookie = await account('blair@example.com');
  const cCookie = await account('casey@example.com');
  const created = await api('/api/leagues', 'POST', { name: 'Friday Night' }, aCookie);
  assert.equal(created.status, 201);
  const leagueId = created.data.id;
  assert.equal((await api(`/api/leagues/${leagueId}`, 'GET', null, cCookie)).status, 404);
  assert.equal((await api(`/api/leagues/${leagueId}/seasons`, 'POST', { name: 'Fall', scoring: { type: 'points', table: [10, 7, 5] } }, cCookie)).status, 404);
  const joined = await api('/api/leagues/join', 'POST', { inviteCode: created.data.inviteCode }, bCookie);
  assert.equal(joined.status, 200);
  assert.equal((await api('/api/leagues/join', 'POST', { inviteCode: created.data.inviteCode }, bCookie)).data.members.length, 2);
  assert.equal((await api(`/api/leagues/${leagueId}/seasons`, 'POST', { name: 'Nope', scoring: { type: 'net' } }, bCookie)).status, 403);
  const season = await api(`/api/leagues/${leagueId}/seasons`, 'POST', { name: 'Fall', scoring: { type: 'points', table: [10, 7, 5], minNightsPct: 50 } }, aCookie);
  assert.equal(season.status, 201);
  const seasonId = season.data.id;
  assert.equal((await api(`/api/leagues/${leagueId}/seasons/${seasonId}/activate`, 'POST', {}, aCookie)).status, 200);
  assert.notEqual((await api(`/api/leagues/${leagueId}/seasons/${seasonId}`, 'PATCH', { scoring: { type: 'net' } }, aCookie)).status, 200);
  const socket = async cookie => {
    const value = connect(base, { transports: ['websocket'], forceNew: true, ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}) });
    sockets.push(value); value.on('state', state => { value.state = state; });
    await new Promise(resolve => value.once('connect', resolve)); return value;
  };
  const emit = (socketValue, event, body) => new Promise(resolve => socketValue.emit(event, body, resolve));
  const a = await socket(aCookie); const b = await socket(bCookie); const sub = await socket();
  const start = await emit(a, 'create', { name: 'Alex', leagueId, settings: { startingStack: 5000 } });
  assert.equal(start.ok, true);
  assert.equal(start.state.settings.startingStack, 1000, 'league settings override the client');
  assert.equal('leagueId' in start.state.settings, false);
  assert.equal(JSON.stringify(start.state).includes(leagueId), false);
  assert.equal((await emit(b, 'create', { name: 'Blair', leagueId })).ok, false);
  const secondStart = await emit(a, 'create', { name: 'Alex', leagueId });
  assert.equal(secondStart.ok, false, 'seated socket cannot start a duplicate room');
  const anotherCommissionerTab = await socket(aCookie);
  const existingStart = await emit(anotherCommissionerTab, 'create', { name: 'Alex', leagueId });
  assert.equal(existingStart.roomCode, start.roomCode, 'an unseated commissioner tab reuses the open room');
  const joinedSeat = await emit(b, 'join', { name: 'Blair', code: start.roomCode });
  assert.equal(joinedSeat.ok, true);
  const subSeat = await emit(sub, 'join', { name: 'Guest', code: start.roomCode });
  assert.equal(subSeat.ok, true);
  assert.equal((await api(`/api/leagues/${leagueId}/live`, 'GET', null, aCookie)).data.roomCode, start.roomCode);
  const hand = await emit(a, 'start-hand', { token: start.token, revision: subSeat.state.revision });
  assert.equal(hand.ok, true);
  const foldA = await emit(a, 'action', { token: start.token, revision: hand.state.revision, type: 'fold' });
  assert.equal(foldA.ok, true);
  const foldB = await emit(b, 'action', { token: joinedSeat.token, revision: foldA.state.revision, type: 'fold' });
  assert.equal(foldB.ok, true, JSON.stringify({ error: foldB.error, errors }));
  assert.equal(foldB.state.street, 'complete');
  const saveNight = store.saveNight.bind(store);
  store.saveNight = async () => { throw new Error('disk full'); };
  const failedEnd = await emit(a, 'host:endNight', { token: start.token, revision: foldB.state.revision });
  assert.equal(failedEnd.ok, false);
  assert.equal((await api(`/api/leagues/${leagueId}/live`, 'GET', null, aCookie)).data.roomCode, start.roomCode);
  store.saveNight = saveNight;
  assert.equal((await emit(a, 'host:endNight', { token: start.token, revision: foldB.state.revision })).ok, true);
  assert.deepEqual(errors, ['disk full']);
  assert.equal((await api(`/api/leagues/${leagueId}/live`, 'GET', null, aCookie)).data.roomCode, null);
  const fresh = await emit(anotherCommissionerTab, 'create', { name: 'Alex', leagueId });
  assert.equal(fresh.ok, true);
  assert.notEqual(fresh.roomCode, start.roomCode);
  const standings = await api(`/api/leagues/${leagueId}/seasons/${seasonId}/standings`, 'GET', null, aCookie);
  assert.equal(standings.data.standings[0].nights, 1);
  assert.equal(standings.data.standings[0].score, 1000);
  const nights = await api(`/api/leagues/${leagueId}/nights`, 'GET', null, aCookie);
  assert.equal(nights.data.nights[0].participants.length, 3);
  assert.equal(nights.data.nights[0].results.length, 2, 'guest is outside standings');
  const privateValues = [aCookie.split(';')[0], bCookie.split(';')[0], cCookie.split(';')[0],
    ...(await store.db.prepare('SELECT id,email FROM accounts').all()).flatMap(row => [row.id, row.email]),
    ...(await store.db.prepare('SELECT claim_hash FROM night_players').all()).map(row => row.claim_hash)];
  for (const response of [created.data, start.state, joinedSeat.state, subSeat.state, standings.data, nights.data,
    (await api(`/api/leagues/${leagueId}/records`, 'GET', null, aCookie)).data]) {
    for (const value of privateValues) assert.equal(JSON.stringify(response).includes(value), false, `league data leaked ${value.slice(0, 8)}`);
  }
  const nightId = nights.data.nights[0].id;
  assert.equal((await api(`/api/leagues/${leagueId}/nights/${nightId}/void`, 'POST', { reason: 'Seat total corrected' }, bCookie)).status, 403);
  assert.equal((await api(`/api/leagues/${leagueId}/members/${joined.data.members[1].memberId}`, 'PATCH', { role: 'co' }, aCookie)).status, 200);
  assert.equal((await api(`/api/leagues/${leagueId}/nights/${nightId}/void`, 'POST', { reason: 'Seat total corrected' }, bCookie)).status, 200);
  assert.equal((await api(`/api/leagues/${leagueId}/seasons/${seasonId}/standings`, 'GET', null, aCookie)).data.standings[0].score, 0);
  assert.equal((await api(`/api/leagues/${leagueId}/audit`, 'GET', null, aCookie)).data.entries[0].detail.reason, 'Seat total corrected');
  assert.equal((await api(`/api/leagues/${leagueId}/nights`, 'GET', null, aCookie)).data.nights[0].voidReason, 'Seat total corrected');
  assert.equal((await api(`/api/leagues/${leagueId}/audit?page=1.5`, 'GET', null, aCookie)).status, 400);
  assert.equal((await api(`/api/leagues/${leagueId}/nights/${nightId}/restore`, 'POST', { reason: 'Verified totals' }, aCookie)).status, 200);
  assert.equal((await api(`/api/leagues/${leagueId}/nights`, 'GET', null, aCookie)).data.nights[0].voidReason, null);
  assert.equal((await api(`/api/leagues/${leagueId}/seasons/${seasonId}/close`, 'POST', {}, aCookie)).data.championMemberId, created.data.members[0].memberId);
  assert.notEqual((await api(`/api/leagues/${leagueId}/nights/${nightId}/void`, 'POST', { reason: 'Too late' }, aCookie)).status, 200);
  const closedResults = (await store.db.prepare('SELECT member_id,rank,net FROM league_night_results WHERE night_id = ? ORDER BY member_id').all(nightId));
  (await store.db.prepare(`UPDATE night_players SET net = net + CASE name WHEN 'Alex' THEN 100 WHEN 'Blair' THEN -100 ELSE 0 END
    WHERE night_id = ?`).run(nightId));
  (await new LeagueStore(store.db).finalizeNight(nightId));
  assert.deepEqual((await store.db.prepare('SELECT member_id,rank,net FROM league_night_results WHERE night_id = ? ORDER BY member_id').all(nightId)), closedResults);
  const beforeDelete = (await api(`/api/leagues/${leagueId}/seasons/${seasonId}/standings`, 'GET', null, bCookie)).data.standings;
  assert.equal((await api('/api/me', 'DELETE', { confirm: 'DELETE' }, aCookie)).status, 200);
  const afterDelete = (await api(`/api/leagues/${leagueId}/seasons/${seasonId}/standings`, 'GET', null, bCookie)).data.standings;
  assert.deepEqual(afterDelete.map(row => [row.memberId, row.score, row.nights]), beforeDelete.map(row => [row.memberId, row.score, row.nights]));
  assert.equal(afterDelete.find(row => row.memberId === created.data.members[0].memberId).former, true);
  assert.equal((await api(`/api/leagues/${leagueId}`, 'GET', null, bCookie)).data.myRole, 'commissioner');
  const secondLeague = await api('/api/leagues', 'POST', { name: 'Sunday Night' }, bCookie);
  const secondRoom = await emit(b, 'create', { name: 'Blair', leagueId: secondLeague.data.id });
  assert.equal(secondRoom.ok, true);
  assert.notEqual(secondRoom.roomCode, fresh.roomCode);
  assert.equal((await api(`/api/leagues/${leagueId}/live`, 'GET', null, bCookie)).data.roomCode, fresh.roomCode);
  assert.equal((await api(`/api/leagues/${secondLeague.data.id}/live`, 'GET', null, bCookie)).data.roomCode, secondRoom.roomCode);
});
