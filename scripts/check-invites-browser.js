/* global window, document, navigator, innerWidth */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { hashSecret } from '../src/auth.js';
import { THIRTY_DAYS } from '../src/identity.js';

const store = new SqliteStore(':memory:');
for (const name of ['alice', 'bob']) {
  await store.createAccount(name, `${name}@example.com`, name, Date.now());
  await store.updateProfile(name, { username: name }, Date.now(), THIRTY_DAYS);
}
const aliceToken = 'a'.repeat(64);
await store.saveSession(hashSecret(aliceToken), 'alice', Date.now() + 3_600_000);
const server = createServer({ store, devLogin: true,
  mailer: { enabled: true, local: true, async send() {} } });
const address = await server.listen();
const root = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
let socket;
try {
  const alice = await browser.newContext({ viewport: { width: 390, height: 844 },
    permissions: ['clipboard-read', 'clipboard-write'] });
  await alice.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: async payload => { window.__lastShared = payload; } });
  });
  await alice.addCookies([{ name: 'tm_session', value: aliceToken, domain: '127.0.0.1', path: '/' }]);
  const owner = await alice.newPage();
  owner.on('pageerror', error => errors.push(`owner: ${error.message}`));
  await owner.goto(root + '/me.html');
  await owner.locator('#share-profile').click();
  await owner.locator('.invite-share-dialog[open]').waitFor();
  const friendUrl = await owner.locator('.invite-share-url').first().inputValue();
  writeFileSync('/tmp/tablemate-friend-share-url.txt', friendUrl);
  assert.match(friendUrl, /\/invite\.html\?friend=[a-f0-9]{32}$/);
  assert.equal(await owner.evaluate(expected => {
    const qr = window.qrcode(0, 'M'); qr.addData(expected); qr.make();
    return document.querySelector('.invite-share-qr img').src === qr.createDataURL(7, 4);
  }, friendUrl), true, 'QR image encodes the exact copy link');
  await owner.getByRole('button', { name: 'Copy Link' }).click();
  assert.equal(await owner.evaluate(() => navigator.clipboard.readText()), friendUrl);
  await owner.getByRole('button', { name: 'Share', exact: true }).click();
  assert.equal(await owner.evaluate(() => window.__lastShared.url), friendUrl);
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await owner.screenshot({ path: '/tmp/tablemate-friend-share-mobile.png' });
  await owner.getByRole('button', { name: 'Close share panel' }).click();
  await owner.locator('.invite-share-dialog').waitFor({ state: 'detached' });

  const recipient = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const bob = await recipient.newPage();
  bob.on('pageerror', error => errors.push(`recipient: ${error.message}`));
  await bob.goto(friendUrl);
  await bob.getByRole('link', { name: 'Sign in to add friend' }).click();
  assert.match(bob.url(), /\/login\.html\?return=/);
  assert.match(await bob.locator('#login-invite-context').textContent(), /friend request/);
  await bob.locator('#email').fill('bob@example.com');
  await bob.getByRole('button', { name: 'Send sign-in link' }).click();
  await bob.locator('#local-login-link:visible').click();
  await bob.getByRole('button', { name: 'Sign in', exact: true }).click();
  await bob.getByRole('button', { name: 'Add Friend' }).waitFor();
  await bob.reload();
  await bob.getByRole('button', { name: 'Add Friend' }).click();
  await bob.getByText('Friend Request Sent').first().waitFor();
  const friendList = await (await owner.request.get(root + '/api/friends')).json();
  assert.equal(friendList.incoming.length, 1);

  const created = await owner.evaluate(async () => {
    const response = await fetch('/api/leagues', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Friday Night' }) });
    return response.json();
  });
  await owner.goto(`${root}/league.html?id=${created.id}`);
  await owner.getByRole('button', { name: 'Invite Members' }).click();
  const leagueUrl = await owner.locator('.invite-share-url').first().inputValue();
  writeFileSync('/tmp/tablemate-league-share-url.txt', leagueUrl);
  assert.equal(leagueUrl, `${root}/invite.html?league=${created.inviteCode}`);
  assert.equal(await owner.evaluate(expected => {
    const qr = window.qrcode(0, 'M'); qr.addData(expected); qr.make();
    return document.querySelector('.invite-share-qr img').src === qr.createDataURL(7, 4);
  }, leagueUrl), true);
  await owner.getByRole('button', { name: 'Copy Invite Code' }).click();
  assert.equal(await owner.evaluate(() => navigator.clipboard.readText()), created.inviteCode);
  await owner.screenshot({ path: '/tmp/tablemate-league-share-mobile.png' });
  await owner.getByRole('button', { name: 'Close share panel' }).click();

  const newcomer = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const cara = await newcomer.newPage();
  cara.on('pageerror', error => errors.push(`newcomer: ${error.message}`));
  await cara.goto(leagueUrl);
  await cara.getByRole('link', { name: 'Sign in to join league' }).click();
  await cara.locator('#email').fill('cara@example.com');
  await cara.getByRole('button', { name: 'Send sign-in link' }).click();
  await cara.locator('#local-login-link:visible').click();
  await cara.getByRole('button', { name: 'Sign in', exact: true }).click();
  await cara.getByRole('button', { name: 'Skip for now' }).waitFor();
  await cara.getByRole('button', { name: 'Skip for now' }).click();
  await cara.getByRole('button', { name: 'Join League' }).waitFor();
  await cara.reload();
  await cara.getByRole('button', { name: 'Join League' }).click();
  await cara.waitForURL(/\/league\.html\?id=.*&joined=1/);
  await cara.getByText('You joined this league.').waitFor();
  await cara.reload();
  await cara.getByText('You joined this league.').waitFor();
  assert.equal(await cara.locator('#invite-members').isVisible(), false);
  assert.equal(await cara.locator('#league-invite-code-row').isVisible(), false);

  await store.createAccount('dave', 'dave@example.com', 'Dave', Date.now());
  const daveToken = 'd'.repeat(64);
  await store.saveSession(hashSecret(daveToken), 'dave', Date.now() + 3_600_000);
  const unfinished = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await unfinished.addCookies([{ name: 'tm_session', value: daveToken, domain: '127.0.0.1', path: '/' }]);
  const dave = await unfinished.newPage();
  await dave.goto(leagueUrl);
  await dave.getByRole('link', { name: 'Finish account setup' }).click();
  await dave.getByRole('button', { name: 'Skip for now' }).click();
  await dave.getByRole('button', { name: 'Join League' }).waitFor();

  socket = connect(root, { transports: ['websocket'], extraHeaders: { Cookie: `tm_session=${aliceToken}` } });
  await new Promise(resolve => socket.once('connect', resolve));
  const room = await new Promise(resolve => socket.emit('create', { name: 'Alice', settings: {} }, resolve));
  assert.equal(room.ok, true);
  await owner.goto(`${root}/friends.html?code=${room.roomCode}`);
  await owner.getByRole('button', { name: 'Share table link' }).first().click();
  const tableUrl = await owner.locator('.invite-share-url').first().inputValue();
  assert.equal(tableUrl, `${root}/?code=${room.roomCode}`);

  for (const [width, height] of [[390, 844], [844, 390], [768, 1024], [1280, 720]]) {
    await owner.setViewportSize({ width, height });
    assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      `horizontal overflow at ${width}x${height}`);
    assert.equal(await owner.locator('.invite-share-dialog[open]').count(), 1);
    await owner.locator('.invite-share-qr img').scrollIntoViewIfNeeded();
    const bounds = await owner.locator('.invite-share-qr img').boundingBox();
    assert.ok(bounds && bounds.width >= 150 && bounds.x >= 0 && bounds.x + bounds.width <= width,
      `QR clipped at ${width}x${height}`);
  }
  assert.deepEqual(errors, []);
  process.stdout.write('Browser invite flow passed: friend QR/copy, logged-out sign-in, new-user onboarding, league join, table QR, four viewports.\n');
} finally {
  socket?.disconnect();
  await browser.close();
  await server.close();
}
