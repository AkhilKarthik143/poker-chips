import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SqliteStore } from '../src/store/sqlite.js';
import { createServer } from '../src/server.js';
import { hashSecret } from '../src/auth.js';
import { THIRTY_DAYS, validateUsername, usernameError } from '../src/identity.js';

test('client and server username rules agree on boundary and abuse cases', () => {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../public/identity.js', import.meta.url), 'utf8'), context);
  const cases = ['Abc', 'A_2', 'ABCDEFGHIJKLMNOPQRST', 'ab', 'a'.repeat(21), '2alex', 'a__b', 'a-b',
    'ADMIN', 'tablemate', 'h3lp', 'f_u_c_k', 'sh1t', 'al<ex', 'alex', null];
  for (const value of cases) {
    assert.equal(context.window.TablemateIdentity.usernameError(value), usernameError(value), String(value));
    assert.equal(context.window.TablemateIdentity.validateUsername(value), validateUsername(value), String(value));
  }
});

test('username claim, cooldown, owner revert, hold, deletion and exact boundary', async () => {
  const store = new SqliteStore(':memory:');
  const first = await store.createAccount('first', 'first@example.com', 'First', 0);
  const second = await store.createAccount('second', 'second@example.com', 'Second', 0);
  assert.deepEqual((await Promise.all([(await store.updateProfile(first.id, { username: 'PokerAce' }, 100, THIRTY_DAYS)),
    (await store.updateProfile(second.id, { username: 'pokerace' }, 100, THIRTY_DAYS))])).map(result => result.reason || result.account.username), ['PokerAce', 'taken']);
  assert.equal((await store.usernameAvailability(first.id, 'OtherName', 101, THIRTY_DAYS)), 'cooldown');
  assert.equal((await store.updateProfile(first.id, { username: 'OtherName' }, 100 + THIRTY_DAYS, THIRTY_DAYS)).account.username, 'OtherName');
  assert.equal((await store.usernameAvailability(second.id, 'pokerace', 101 + THIRTY_DAYS, THIRTY_DAYS)), 'held');
  assert.equal((await store.updateProfile(first.id, { username: 'PokerAce' }, 102 + THIRTY_DAYS, THIRTY_DAYS)).account.username, 'PokerAce');
  await store.deleteAccount(first.id, 103 + THIRTY_DAYS);
  assert.equal((await store.usernameAvailability(second.id, 'PokerAce', 104 + THIRTY_DAYS, THIRTY_DAYS)), 'held');
  assert.equal((await store.usernameAvailability(second.id, 'PokerAce', 103 + 2 * THIRTY_DAYS, THIRTY_DAYS)), null);
  await store.close();
});

test('username API rate limit and no-database feature flag', async t => {
  const store = new SqliteStore(':memory:');
  await store.createAccount('first', 'first@example.com', 'First', 0);
  const token = 'a'.repeat(64);
  await store.saveSession(hashSecret(token), 'first', 100_000);
  const server = createServer({ store, now: () => 1000, mailer: { enabled: true, send: async () => {} } });
  const noDb = createServer({});
  const { port } = await server.listen(); const noDbPort = (await noDb.listen()).port;
  t.after(async () => { await server.close(); await noDb.close(); });
  const root = `http://127.0.0.1:${port}`; const headers = { Cookie: `tm_session=${token}` };
  assert.equal((await fetch(`${root}/api/username/check?u=GoodName`, { headers })).status, 200);
  assert.equal((await fetch(`${root}/api/me/profile`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'GoodName' }) })).status, 200);
  assert.deepEqual(await (await fetch(`${root}/api/username/check?u=goodname`, { headers })).json(), { available: true, reason: null });
  for (let index = 0; index < 28; index++) await fetch(`${root}/api/username/check?u=OtherName`, { headers });
  assert.equal((await fetch(`${root}/api/username/check?u=OtherName`, { headers })).status, 429);
  assert.equal((await fetch(`http://127.0.0.1:${noDbPort}/api/username/check?u=alex`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${noDbPort}/api/username/suggestions`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${noDbPort}/api/u/alex`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${noDbPort}/api/me/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${noDbPort}/api/me/onboarding/skip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
});
