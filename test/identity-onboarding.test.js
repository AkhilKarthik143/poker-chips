import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/store/sqlite.js';
import { createServer } from '../src/server.js';
import { createAuth, hashSecret } from '../src/auth.js';
import { validateUsername } from '../src/identity.js';

test('first magic-link sign-in is marked for onboarding, returning sign-in is not', async () => {
  const links = []; const store = new SqliteStore(':memory:');
  const auth = createAuth({ store, mailer: { send: async (_email, link) => links.push(link) } });
  await auth.request('person@example.com', 'http://localhost');
  const first = await auth.verify(new URL(links.at(-1)).searchParams.get('token'));
  assert.equal(first.isNew, true);
  await auth.request('person@example.com', 'http://localhost');
  const second = await auth.verify(new URL(links.at(-1)).searchParams.get('token'));
  assert.equal(second.isNew, false);
  assert.equal(first.account.id, second.account.id);
  await store.close();
});

test('skip assigns distinct valid usernames and stored avatars; suggestions are available', async t => {
  const store = new SqliteStore(':memory:');
  for (const [id, email, token] of [['one', 'one@example.com', 'a'.repeat(64)], ['two', 'two@example.com', 'b'.repeat(64)]]) {
    await store.createAccount(id, email, 'Poker Friend', 1000);
    await store.saveSession(hashSecret(token), id, 100_000);
  }
  const server = createServer({ store, now: () => 2000, mailer: { enabled: true, send: async () => {} } });
  const { port } = await server.listen(); const root = `http://127.0.0.1:${port}`;
  t.after(() => server.close());
  const cookie = character => ({ Cookie: `tm_session=${character.repeat(64)}` });
  const suggestionsResponse = await fetch(root + '/api/username/suggestions', { headers: cookie('a') });
  assert.equal(suggestionsResponse.status, 200);
  const { suggestions } = await suggestionsResponse.json();
  assert.equal(suggestions.length, 3);
  for (const username of suggestions) {
    assert.equal(validateUsername(username), true);
    const check = await (await fetch(`${root}/api/username/check?u=${username}`, { headers: cookie('a') })).json();
    assert.equal(check.available, true);
  }
  const skip = character => fetch(root + '/api/me/onboarding/skip', { method: 'POST', headers: { ...cookie(character), 'Content-Type': 'application/json' }, body: '{}' });
  const [first, second] = await Promise.all([skip('a'), skip('b')]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const one = await first.json(); const two = await second.json();
  assert.match(one.username, /^player[a-z0-9]{5}$/);
  assert.match(two.username, /^player[a-z0-9]{5}$/);
  assert.notEqual(one.username, two.username);
  assert.equal(validateUsername(one.username), true);
  assert.equal(await (await skip('a')).json().then(data => data.username), one.username);
  assert.equal(store.db.prepare('SELECT avatar_json FROM accounts WHERE id = ?').get('one').avatar_json !== null, true);
  assert.equal((await fetch(root + '/healthz')).status, 200);
});
