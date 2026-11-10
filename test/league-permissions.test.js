import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from '../src/server.js';
import { hashSecret } from '../src/auth.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { LeagueStore } from '../src/league-store.js';
import { createStore } from '../src/store/index.js';

const roles = ['guest', 'nonmember', 'member', 'co', 'commissioner'];
const memberRead = [401, 404, 200, 200, 200];
const commissionerWrite = [401, 404, 403, 403, 200];
const leaderWrite = [401, 404, 403, 200, 200];

async function fixture() {
  const store = new SqliteStore(':memory:');
  const roster = new LeagueStore(store.db);
  const people = {};
  const cookies = {};
  for (const role of roles.slice(1)) {
    const account = await store.createAccount(randomUUID(), `${role}@example.com`, role, Date.now());
    const token = randomBytes(32).toString('hex');
    await store.saveSession(hashSecret(token), account.id, Date.now() + 60_000);
    people[role] = account;
    cookies[role] = `tm_session=${token}`;
  }
  const id = randomUUID();
  roster.create({ id, name: 'Friday Night', inviteCode: 'ABCDEFGH',
    settings: { startingStack: 1000, smallBlind: 5, bigBlind: 10, blindMinutes: 0, centsPer1000Chips: 0 },
    account: people.commissioner, memberId: randomUUID(), time: Date.now() });
  const member = roster.join(id, people.member, randomUUID(), Date.now());
  const co = roster.join(id, people.co, randomUUID(), Date.now());
  roster.setRole(id, co.id, 'co');
  const server = createServer({ store, mailer: { enabled: true, send: async () => {} } });
  const { port } = await server.listen();
  return { base: `http://127.0.0.1:${port}`, server, store, roster, id, memberId: member.id, cookies };
}

test('league endpoints enforce the roster permission matrix', async () => {
  const cases = [
    { name: 'create', method: 'POST', path: () => '/api/leagues', body: () => ({ name: 'Another League' }), expected: [401, 201, 201, 201, 201] },
    { name: 'mine', method: 'GET', path: () => '/api/leagues', expected: [401, 200, 200, 200, 200] },
    { name: 'join', method: 'POST', path: () => '/api/leagues/join', body: () => ({ inviteCode: 'ABCDEFGH' }), expected: [401, 200, 200, 200, 200] },
    { name: 'detail', method: 'GET', path: f => `/api/leagues/${f.id}`, expected: memberRead },
    { name: 'live', method: 'GET', path: f => `/api/leagues/${f.id}/live`, expected: memberRead },
    { name: 'rename', method: 'PATCH', path: f => `/api/leagues/${f.id}`, body: () => ({ name: 'Renamed League' }), expected: commissionerWrite },
    { name: 'leave', method: 'POST', path: f => `/api/leagues/${f.id}/leave`, expected: [401, 404, 200, 200, 400] },
    { name: 'rotate invite', method: 'POST', path: f => `/api/leagues/${f.id}/invite/rotate`, expected: leaderWrite },
    { name: 'change role', method: 'PATCH', path: f => `/api/leagues/${f.id}/members/${f.memberId}`, body: () => ({ role: 'co' }), expected: commissionerWrite },
    { name: 'remove member', method: 'DELETE', path: f => `/api/leagues/${f.id}/members/${f.memberId}`, expected: leaderWrite },
    { name: 'transfer', method: 'POST', path: f => `/api/leagues/${f.id}/transfer`, body: f => ({ memberId: f.memberId }), expected: commissionerWrite }
  ];
  for (const scenario of cases) {
    for (const [index, role] of roles.entries()) {
      const f = await fixture();
      try {
        const body = scenario.body?.(f);
        const response = await fetch(f.base + scenario.path(f), { method: scenario.method,
          headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(f.cookies[role] ? { Cookie: f.cookies[role] } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        assert.equal(response.status, scenario.expected[index], `${scenario.name} as ${role}`);
      } finally { await f.server.close(); }
    }
  }
});

test('league roster caps at 30 active members and guest mode hides league routes', async () => {
  const f = await fixture();
  try {
    for (let index = 3; index < 30; index++) {
      const account = await f.store.createAccount(randomUUID(), `seat${index}@example.com`, `Seat ${index}`, Date.now());
      f.roster.join(f.id, account, randomUUID(), Date.now());
    }
    const extra = await f.store.createAccount(randomUUID(), 'extra@example.com', 'Extra', Date.now());
    assert.throws(() => f.roster.join(f.id, extra, randomUUID(), Date.now()), /full/);
    assert.equal(f.roster.roster(f.id).filter(row => row.leftAt === null).length, 30);
  } finally { await f.server.close(); }
  const guestServer = createServer({ store: createStore(null) });
  const { port } = await guestServer.listen();
  try {
    for (const path of ['/api/leagues', `/api/leagues/${randomUUID()}/records`]) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 404);
    }
  } finally { await guestServer.close(); }
});
