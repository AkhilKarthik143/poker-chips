import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { avatarForAccount, validAvatar, validPhotoAvatar } from '../src/identity.js';

async function login(base, links, email) {
  await fetch(base + '/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const token = new URL(links.at(-1)).searchParams.get('token');
  const response = await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('photo avatar upload is private storage with a revocable public image key', async t => {
  const links = [];
  const server = createServer({ store: new SqliteStore(':memory:'), mailer: { enabled: true, send: async (_email, link) => links.push(link) } });
  const { port } = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  t.after(() => server.close());
  const cookie = await login(base, links, 'photo@example.test');
  const upload = (bytes, type = 'image/jpeg', headers = {}) => fetch(base + '/api/me/avatar-photo', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': type, ...headers }, body: bytes });
  const input = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#fbc4a4' } })
    .jpeg().withExif({ IFD0: { Copyright: 'Secret photo metadata' } }).toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  assert.equal((await fetch(base + '/api/me/avatar-photo', { method: 'POST', body: input })).status, 401);
  assert.equal((await upload(input, 'image/jpeg', { Origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await upload(input, 'image/svg+xml')).status, 415);
  assert.equal((await upload(input, 'image/png')).status, 400);
  const first = await upload(input);
  assert.equal(first.status, 200);
  const profile = await first.json();
  assert.equal(profile.avatar.v, 3);
  assert.match(profile.avatar.key, /^[0-9a-f]{32}$/);
  assert.equal(validPhotoAvatar(profile.avatar), true);
  assert.equal(validAvatar(profile.avatar), false, 'a client cannot select an arbitrary photo key via profile update');
  assert.equal((await fetch(base + '/api/me/profile', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar: profile.avatar }) })).status, 400);
  const path = `/avatar-photos/${profile.avatar.key}.webp`;
  const imageResponse = await fetch(base + path);
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get('content-type'), /^image\/webp/);
  assert.equal(imageResponse.headers.get('cache-control'), 'private, no-store');
  const output = Buffer.from(await imageResponse.arrayBuffer());
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 256); assert.equal(metadata.height, 256);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined);
  const exported = await (await fetch(base + '/api/me/export', { headers: { Cookie: cookie } })).json();
  assert.equal(Buffer.from(exported.avatarPhoto.base64, 'base64').compare(output), 0);
  const replacement = await upload(await sharp({ create: { width: 200, height: 250, channels: 3, background: '#79e5da' } }).png().toBuffer(), 'image/png');
  assert.equal(replacement.status, 200);
  const next = await replacement.json();
  assert.notEqual(next.avatar.key, profile.avatar.key);
  assert.equal((await fetch(base + path)).status, 404, 'replacing a photo revokes the old URL');
  assert.equal((await fetch(base + `/avatar-photos/${next.avatar.key}.webp`)).status, 200);
  const removed = await fetch(base + '/api/me/avatar-photo', { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).avatar.v, 2);
  assert.equal((await fetch(base + `/avatar-photos/${next.avatar.key}.webp`)).status, 404);
  assert.equal((await fetch(base + '/api/me/avatar-photo', { method: 'DELETE', headers: { Cookie: cookie } })).status, 409);
});

test('photo records persist with SQLite and disappear with the account', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'tablemate-photo-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'tablemate.db');
  const photo = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#aabbcc' } }).webp().toBuffer();
  const key = 'a'.repeat(32);
  const first = new SqliteStore(path);
  await first.createAccount('photo-account', 'person@example.test', 'Person', 1);
  await first.setAvatarPhoto('photo-account', key, photo, 2);
  await first.close();
  const reopened = new SqliteStore(path);
  assert.deepEqual(avatarForAccount(await reopened.getAccount('photo-account')), { v: 3, key });
  assert.equal((await reopened.getAvatarPhoto(key)).compare(photo), 0);
  await reopened.deleteAccount('photo-account');
  assert.equal(await reopened.getAvatarPhoto(key), null);
  await reopened.close();
});

test('a photo reaches table seats only while avatar sharing is enabled', async t => {
  const links = [];
  const server = createServer({ store: new SqliteStore(':memory:'), mailer: { enabled: true, send: async (_email, link) => links.push(link) } });
  const { port } = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  const cookie = await login(base, links, 'table-photo@example.test');
  const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ab69d0' } }).png().toBuffer();
  const uploaded = await fetch(base + '/api/me/avatar-photo', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: image });
  const { avatar } = await uploaded.json();
  const socket = async headers => {
    const client = connect(base, { transports: ['websocket'], extraHeaders: headers }); sockets.push(client);
    await new Promise(resolve => client.once('connect', resolve)); return client;
  };
  const owner = await socket({ Cookie: cookie });
  const created = await new Promise(resolve => owner.emit('create', { name: 'Photo', settings: {} }, resolve));
  assert.equal(created.ok, true);
  const guest = await socket({});
  const joined = await new Promise(resolve => guest.emit('join', { code: created.roomCode, name: 'Guest' }, resolve));
  assert.equal(joined.ok, true);
  assert.deepEqual(joined.state.identities[created.playerId].avatar, avatar);
  assert.equal(JSON.stringify(joined.state).includes('table-photo@example.test'), false);
  const changed = new Promise(resolve => guest.once('state', resolve));
  const privacy = await fetch(base + '/api/me/profile', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ privacy: { profileVisibility: 'private', showUsernameAtTables: false, showAvatarAtTables: false } }) });
  assert.equal(privacy.status, 200);
  assert.equal('avatar' in (await changed).identities[created.playerId], false);
});
