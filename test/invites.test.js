import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { hashSecret } from '../src/auth.js';
import { THIRTY_DAYS } from '../src/identity.js';
import { safeInviteReturn } from '../src/invites.js';

const origin = 'https://tablemate.example';
const token = id => id[0].repeat(64);

async function fixture(t) {
  const store = new SqliteStore(':memory:');
  for (const id of ['alice', 'bob', 'cara']) {
    await store.createAccount(id, `${id}@example.com`, id, 0);
    await store.updateProfile(id, { username: id }, 1, THIRTY_DAYS);
    await store.saveSession(hashSecret(token(id)), id, 100_000);
  }
  const sent = [];
  const server = createServer({ store, now: () => 1000, allowedOrigins: [origin], logError: () => {},
    mailer: { enabled: true, send: async (_email, link) => sent.push(link) } });
  const root = `http://127.0.0.1:${(await server.listen()).port}`;
  t.after(() => server.close());
  const api = async (id, path, method = 'GET', body) => {
    const response = await fetch(root + path, { method,
      headers: { ...(id ? { Cookie: `tm_session=${token(id)}` } : {}),
        ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}) },
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}) });
    return { status: response.status, headers: response.headers,
      data: await response.json().catch(() => null) };
  };
  return { store, server, root, api, sent };
}

test('only exact invitation paths survive sign in', () => {
  const friend = `/invite.html?friend=${'a'.repeat(32)}`;
  assert.equal(safeInviteReturn(friend), friend);
  assert.equal(safeInviteReturn('/invite.html?league=ABCDEFGH'), '/invite.html?league=ABCDEFGH');
  for (const path of ['https://evil.test', '//evil.test', '/invite.html?league=ABCDEFGH&next=//evil.test',
    '/invite.html?league=ABCDEFGH#frag', '/invite.html?league=ABCDEFGH=bad',
    '/invite.html?friend=%2F%2Fevil.test', '/me.html', '\\evil.test']) assert.equal(safeInviteReturn(path), null);
});

test('friend share identity persists across database reopen', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tablemate-invite-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'accounts.db');
  const first = new SqliteStore(path);
  await first.createAccount('alice', 'alice@example.com', 'Alice', 0);
  const shareId = await first.friendShareId('alice');
  await first.close();
  const reopened = new SqliteStore(path);
  assert.equal(await reopened.friendShareId('alice'), shareId);
  await reopened.close();
});

test('stable friend links expose only permitted identity and use existing request rules', async t => {
  const { store, root, api } = await fixture(t);
  const shared = await api('alice', '/api/invites/me');
  assert.equal(shared.status, 200);
  assert.match(shared.data.url, /^https:\/\/tablemate\.example\/invite\.html\?friend=[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(shared.data).includes('alice@example.com'), false);
  const path = shared.data.path;
  assert.equal((await fetch(root + path)).status, 200);
  const endpoint = `/api/invites/friend/${new URL(shared.data.url).searchParams.get('friend')}`;
  const bobShare = await api('bob', '/api/invites/me');
  const bobEndpoint = `/api/invites/friend/${new URL(bobShare.data.url).searchParams.get('friend')}`;
  assert.equal((await api(null, endpoint)).data.signedIn, false);
  assert.equal((await api('alice', endpoint)).data.status, 'self');
  assert.equal((await api('bob', endpoint)).data.status, 'not-friends');
  assert.equal((await api('bob', endpoint + '/send', 'POST')).status, 200);
  assert.equal((await api('alice', bobEndpoint)).data.status, 'request-received');
  assert.equal((await api('bob', endpoint)).data.status, 'request-sent');
  assert.equal((await api('alice', bobEndpoint + '/accept', 'POST')).data.status, 'friends');
  assert.equal((await api('bob', endpoint)).data.status, 'friends');
  assert.equal((await api('bob', endpoint + '/send', 'POST')).status, 409);
  await store.updateProfile('alice', { username: 'alice_new' }, THIRTY_DAYS + 10, THIRTY_DAYS);
  assert.equal((await api('alice', '/api/invites/me')).data.path, path);
  assert.equal((await api('bob', endpoint)).data.username, 'alice_new');
  await store.updateProfile('alice', { privacy: { profileVisibility: 'private', showUsernameAtTables: false,
    showAvatarAtTables: false } }, THIRTY_DAYS + 20, THIRTY_DAYS);
  const privatePreview = await api(null, endpoint);
  assert.equal(privatePreview.data.displayName, 'Tablemate player');
  assert.equal(privatePreview.data.username, null);
  assert.equal(privatePreview.data.avatar, null);
  assert.equal((await api('bob', endpoint + '/decline', 'POST')).status, 409);
  await api('bob', '/api/friends/alice_new/block', 'POST');
  assert.equal((await api('bob', endpoint)).data.status, 'blocked');
  assert.equal((await api('alice', endpoint)).data.status, 'self');
  assert.equal((await api('alice', bobEndpoint)).status, 404);
  const caraShare = await api('cara', '/api/invites/me');
  const caraEndpoint = `/api/invites/friend/${new URL(caraShare.data.url).searchParams.get('friend')}`;
  await store.deleteAccount('cara');
  assert.equal((await api('bob', caraEndpoint)).status, 404);
});

test('league links preview safely, join once, and fail after rotation', async t => {
  const { api, store, root } = await fixture(t);
  const created = await api('alice', '/api/leagues', 'POST', { name: 'Friday Night' });
  assert.equal(created.status, 201);
  const id = created.data.id;
  const share = await api('alice', `/api/leagues/${id}/invite`);
  assert.equal(share.status, 200);
  assert.equal(share.data.url, `${origin}/invite.html?league=${created.data.inviteCode}`);
  assert.equal((await fetch(root + share.data.path)).status, 200);
  assert.equal((await api('bob', `/api/leagues/${id}/invite`)).status, 404);
  const endpoint = `/api/invites/league/${share.data.inviteCode}`;
  const publicPreview = await api(null, endpoint);
  assert.deepEqual(publicPreview.data, { name: 'Friday Night', signedIn: false, needsSetup: false, alreadyMember: false });
  assert.equal(publicPreview.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await api('bob', endpoint)).data.alreadyMember, false);
  const joined = await Promise.all([api('bob', endpoint + '/join', 'POST'), api('bob', endpoint + '/join', 'POST')]);
  assert.deepEqual(joined.map(result => result.status), [200, 200]);
  assert.equal(joined.filter(result => result.data.alreadyMember).length, 1);
  assert.equal((await store.db.prepare('SELECT COUNT(*) AS n FROM league_members WHERE league_id = ? AND account_id = ?').get(id, 'bob')).n, 1);
  assert.equal((await api('bob', `/api/leagues/${id}`)).data.inviteCode, undefined);
  assert.equal((await api('bob', `/api/leagues/${id}/invite`)).status, 403);
  const bobMember = (await store.db.prepare('SELECT id FROM league_members WHERE league_id = ? AND account_id = ?').get(id, 'bob'));
  await api('alice', `/api/leagues/${id}/members/${bobMember.id}`, 'PATCH', { role: 'co' });
  assert.equal((await api('bob', `/api/leagues/${id}/invite`)).status, 200);
  assert.equal((await api('bob', endpoint)).data.alreadyMember, true);
  assert.equal((await api('cara', endpoint + '/join', 'POST')).status, 200);
  const rotated = await api('alice', `/api/leagues/${id}/invite/rotate`, 'POST');
  assert.equal(rotated.status, 200);
  assert.equal((await api(null, endpoint)).status, 404);
  assert.equal((await api('bob', endpoint + '/join', 'POST')).status, 404);
  assert.equal((await api(null, `/api/invites/league/${rotated.data.inviteCode}`)).status, 200);
  assert.equal((await api(null, '/api/invites/league/INVALID1')).status, 404);
});

test('simultaneous reciprocal link taps never auto-accept a friendship', async t => {
  const { api, store } = await fixture(t);
  const alice = new URL((await api('alice', '/api/invites/me')).data.url).searchParams.get('friend');
  const bob = new URL((await api('bob', '/api/invites/me')).data.url).searchParams.get('friend');
  const results = await Promise.all([
    api('alice', `/api/invites/friend/${bob}/send`, 'POST'),
    api('bob', `/api/invites/friend/${alice}/send`, 'POST')
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await store.db.prepare('SELECT status FROM friend_relations WHERE user_a = ? AND user_b = ?').get('alice', 'bob')).status, 'pending');
});

test('email verification carries only a validated invite to onboarding', async t => {
  const { api, sent } = await fixture(t);
  const destination = `/invite.html?friend=${'a'.repeat(32)}`;
  await api(null, '/api/auth/request', 'POST', { email: 'new@example.com', returnTo: destination });
  assert.equal(new URL(sent.at(-1)).searchParams.get('return'), destination);
  await api(null, '/api/auth/request', 'POST', { email: 'other@example.com', returnTo: '//evil.test' });
  assert.equal(new URL(sent.at(-1)).searchParams.has('return'), false);
  const tokenValue = new URL(sent.at(-2)).searchParams.get('token');
  const verified = await api(null, '/api/auth/verify', 'POST', { token: tokenValue });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.onboarding, true);
  assert.equal((await api(null, '/api/invites/league/ABCDEFGH/join', 'POST')).status, 401);
});

test('invitation previews fail clearly when accounts or storage are unavailable', async t => {
  const disabled = createServer({ store: { enabled: false, async init() {}, async close() {} } });
  const root = `http://127.0.0.1:${(await disabled.listen()).port}`;
  t.after(() => disabled.close());
  assert.equal((await fetch(root + '/api/invites/league/ABCDEFGH')).status, 503);
  const { store, api } = await fixture(t);
  const me = await api('alice', '/api/invites/me');
  const shareId = new URL(me.data.url).searchParams.get('friend');
  store.getSession = async () => { throw new Error('database offline'); };
  assert.equal((await api('bob', `/api/invites/friend/${shareId}`)).status, 503);
});
