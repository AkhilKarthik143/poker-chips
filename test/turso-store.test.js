import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/store/sqlite.js';
import { createStore } from '../src/store/index.js';
import { FriendsStore } from '../src/friends-store.js';
import { LeagueStore } from '../src/league-store.js';
import { createServer } from '../src/server.js';

test('concurrent account creation and Google identities keep one account per identity', async () => {
  const store = new SqliteStore(':memory:');
  try {
    const sameEmail = await Promise.all(Array.from({ length: 8 }, (_, n) =>
      store.createAccount(randomUUID(), 'same@example.com', `Player ${n}`, 100)));
    assert.equal(new Set(sameEmail.map(account => account.id)).size, 1);
    const otherNames = await Promise.all(Array.from({ length: 4 }, () =>
      store.createAccount(randomUUID(), `${randomUUID()}@example.com`, 'Same Name', 101)));
    assert.equal(new Set(otherNames.map(account => account.display_name)).size, 4);
    const google = await Promise.all(Array.from({ length: 3 }, () =>
      store.signInGoogle('google-sub', 'gmail@gmail.com', 'Google User', true, 102)));
    assert.equal(new Set(google.map(account => account.id)).size, 1);
    assert.equal((await store.signInGoogle('google-sub', 'changed@gmail.com', 'Other', true, 103)).id, google[0].id);
    assert.equal(await store.signInGoogle('new-sub', 'same@example.com', 'Player', false, 104), null);
    assert.equal((await store.db.prepare('SELECT COUNT(*) AS count FROM google_identities').get()).count, 1);
    assert.equal(await store.getAccountByEmail("' OR 1=1 --"), null);
  } finally { await store.close(); }
});

test('transactions roll back fully and migrations upgrade old files once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tablemate-migrate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'old.db');
  const legacy = new DatabaseSync(path);
  legacy.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (0)');
  legacy.close();
  const store = new SqliteStore(path);
  await store.init();
  assert.equal((await store.db.prepare('SELECT version FROM schema_version').get()).version, 9);
  await assert.rejects(store.db.transaction(async () => {
    await store.db.prepare('INSERT INTO accounts (id,email,display_name,created_at) VALUES (?,?,?,?)')
      .run('rollback', 'rollback@example.com', 'Rollback', 1);
    throw new Error('cancel');
  }), /cancel/);
  assert.equal(await store.getAccount('rollback'), null);
  await store.close();
  const reopened = new SqliteStore(path);
  await reopened.init();
  assert.equal((await reopened.db.prepare('SELECT version FROM schema_version').get()).version, 9);
  assert.equal((await reopened.db.prepare('SELECT COUNT(*) AS n FROM schema_version').get()).n, 1);
  await reopened.close();
});

test('Google session, friends and league survive closing and restarting the server', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tablemate-restart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'accounts.db');
  const googleClientId = '12345-test.apps.googleusercontent.com';
  const payload = { sub: 'stable-google-sub', email: 'alex@gmail.com', email_verified: true, name: 'Alex' };
  const options = store => ({ store, googleClientId, verifyGoogleIdToken: async () => payload,
    mailer: { enabled: false, send: async () => {} } });
  const firstStore = new SqliteStore(path);
  const first = createServer(options(firstStore));
  const { port } = await first.listen();
  const base = `http://127.0.0.1:${port}`;
  const signedIn = await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: 'a.b.c' }) });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];
  const account = await firstStore.getAccountByEmail(payload.email);
  await firstStore.updateProfile(account.id, { username: 'alexplayer' }, 100, 0);
  const friend = await firstStore.createAccount(randomUUID(), 'friend@example.com', 'Friend', 100);
  await firstStore.updateProfile(friend.id, { username: 'friendplayer' }, 100, 0);
  await new FriendsStore(firstStore.db).change(account.id, friend.id, 'send', 101);
  const league = await new LeagueStore(firstStore.db).create({ id: randomUUID(), name: 'Friday',
    inviteCode: 'ABCDEFGH', settings: {}, account, memberId: randomUUID(), time: 102 });
  await first.close();

  const secondStore = new SqliteStore(path);
  const second = createServer(options(secondStore));
  try {
    const { port: secondPort } = await second.listen();
    const nextBase = `http://127.0.0.1:${secondPort}`;
    const profile = await fetch(`${nextBase}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).username, 'alexplayer');
    const again = await fetch(`${nextBase}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'a.b.c' }) });
    assert.equal(again.status, 200);
    assert.equal((await secondStore.getAccountByEmail(payload.email)).id, account.id);
    assert.equal((await new FriendsStore(secondStore.db).list(account.id)).outgoing[0].username, 'friendplayer');
    assert.equal((await new LeagueStore(secondStore.db).mine(account.id))[0].id, league.id);
  } finally { await second.close(); }
});

test('database configuration and outages fail closed without enabling accounts', async () => {
  assert.throws(() => createStore(null, 'libsql://example.turso.io', null), /TURSO_AUTH_TOKEN/);
  assert.throws(() => createStore(null, null, 'secret'), /TURSO_DATABASE_URL/);
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { assert.throws(() => createStore('/tmp/ephemeral.db', null, null), /Production account storage/); }
  finally { if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv; }
  const broken = new SqliteStore(':memory:');
  broken.init = async () => { throw new Error('database offline'); };
  const noStart = createServer({ store: broken, googleClientId: '12345-test.apps.googleusercontent.com', logError: () => {} });
  await assert.rejects(noStart.listen(), /database offline/);
  await noStart.close();

  const store = new SqliteStore(':memory:');
  const server = createServer({ store, googleClientId: '12345-test.apps.googleusercontent.com', logError: () => {} });
  const { port } = await server.listen();
  try {
    store.ping = async () => { throw new Error('database offline'); };
    const response = await fetch(`http://127.0.0.1:${port}/api/config`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { accounts: false, email: false, googleClientId: null, avatarCreator: false });
  } finally { await server.close(); }
});
