import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/store/sqlite.js';
import { FriendsStore, FriendError } from '../src/friends-store.js';
import { DEFAULT_PRIVACY, THIRTY_DAYS } from '../src/identity.js';

async function users(store) {
  for (const [id, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['cara', 'Cara']]) {
    await store.createAccount(id, `${id}@example.com`, name, 10);
    await store.updateProfile(id, { username: name }, 20, THIRTY_DAYS);
  }
  return new FriendsStore(store.db);
}

test('friends search, requests, reciprocal acceptance, removal and blocking are consistent', async () => {
  const store = new SqliteStore(':memory:'); const friends = await users(store);
  assert.deepEqual(friends.search('alice', 'no'), []);
  assert.deepEqual(friends.search('alice', 'bo').map(user => [user.username, user.status]), [['Bob', 'not-friends']]);
  await store.updateProfile('cara', { privacy: { ...DEFAULT_PRIVACY, profileVisibility: 'private' } }, 21, THIRTY_DAYS);
  assert.equal(friends.search('alice', 'ca')[0].avatar, null);
  assert.throws(() => friends.change('alice', 'alice', 'send', 30), FriendError);
  assert.deepEqual(friends.change('alice', 'bob', 'send', 30), { status: 'request-sent' });
  assert.deepEqual(friends.change('alice', 'bob', 'send', 31), { status: 'request-sent' });
  assert.equal(friends.list('bob').incoming.length, 1);
  assert.equal(friends.unread('bob'), 1);
  assert.throws(() => friends.change('alice', 'bob', 'accept', 32), FriendError);
  assert.deepEqual(friends.change('bob', 'alice', 'send', 33), { status: 'friends' });
  assert.equal(friends.list('alice').friends.length, 1);
  assert.equal(friends.list('bob').friends.length, 1);
  assert.equal(friends.unread('bob'), 0);
  assert.equal(friends.unread('alice'), 1);
  friends.markRead('alice', 34); assert.equal(friends.unread('alice'), 0);
  assert.equal(friends.change('alice', 'bob', 'remove', 35).status, 'not-friends');
  assert.equal(friends.list('bob').friends.length, 0);
  friends.change('alice', 'bob', 'send', 36);
  assert.equal(friends.change('bob', 'alice', 'decline', 37).status, 'not-friends');
  friends.change('alice', 'bob', 'send', 38);
  assert.equal(friends.change('alice', 'bob', 'cancel', 39).status, 'not-friends');
  friends.change('alice', 'bob', 'send', 40);
  assert.equal(friends.change('bob', 'alice', 'accept', 41).status, 'friends');
  assert.equal(friends.change('alice', 'bob', 'block', 42).status, 'blocked');
  assert.equal(friends.list('bob').friends.length, 0);
  assert.equal(friends.list('alice').blocked.length, 1);
  assert.equal(friends.peer('bob', 'alice'), null);
  assert.deepEqual(friends.search('bob', 'al'), []);
  assert.throws(() => friends.change('bob', 'alice', 'send', 43), FriendError);
  assert.equal(friends.change('alice', 'bob', 'unblock', 44).status, 'not-friends');
  assert.equal(friends.list('alice').friends.length, 0);
  await store.close();
});

test('friendship uses stable accounts through restart and username change; deletion cascades', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tablemate-friends-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'friends.db'); let store = new SqliteStore(path);
  let friends = await users(store);
  friends.change('alice', 'bob', 'send', 100); friends.change('bob', 'alice', 'accept', 101);
  await store.close(); store = new SqliteStore(path); friends = new FriendsStore(store.db);
  assert.equal(friends.list('alice').friends[0].username, 'Bob');
  await store.updateProfile('bob', { username: 'NewBob' }, THIRTY_DAYS + 21, THIRTY_DAYS);
  assert.equal(friends.list('alice').friends[0].username, 'NewBob');
  assert.equal((await store.exportAccount('alice')).friendships[0].username, 'NewBob');
  await store.deleteAccount('bob', THIRTY_DAYS + 22);
  assert.equal(friends.list('alice').friends.length, 0);
  assert.equal(friends.unread('alice'), 0);
  await store.close();
});
