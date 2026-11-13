/* global window, document, requestAnimationFrame, innerWidth, getComputedStyle */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';
import { createServer } from '../src/server.js';

const shots = process.env.TABLEMATE_MOBILE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const capture = (page, name) => shots ? page.screenshot({ path: join(shots, name), animations: 'disabled' }) : Promise.resolve();

async function socketPlayer(url, code, name, sockets) {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const joined = await new Promise((resolve, reject) => socket.timeout(3000).emit('join', { code, name }, (error, response) => error ? reject(error) : resolve(response)));
  assert.equal(joined.ok, true, joined.error);
}

async function createTable(browser, url, width, height, name) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('#name').fill(name);
  await page.locator('#entry-submit').click();
  await page.locator('#copy-code').waitFor();
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'new table begins at its header');
  const code = (await page.locator('#copy-code strong').innerText()).trim();
  return { context, page, code };
}

test('phone entry, guarded actions, ten seats, quick access and viewport layout', async t => {
  const server = createServer();
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = await chromium.launch({ headless: true });
  const sockets = [];
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await browser.close(); await server.close(); });

  const first = await createTable(browser, url, 360, 740, 'Host');
  const guestContext = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const guestPage = await guestContext.newPage();
  await guestPage.goto(`${url}?code=${first.code}`);
  assert.equal(await guestPage.locator('#join-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await guestPage.locator('#room-code').inputValue(), first.code);
  assert.ok(await guestPage.locator('#room-code').evaluate(el => el.getBoundingClientRect().top) < await guestPage.locator('#name').evaluate(el => el.getBoundingClientRect().top));
  await guestPage.locator('#name').fill('Guest');
  await guestPage.locator('#entry-submit').click();
  await guestPage.locator('#dialog-form button[type=submit]').click();
  await guestPage.locator('#copy-code').waitFor();
  assert.equal(await guestPage.evaluate(() => window.scrollY), 0, 'joined table begins at its header');
  await first.page.locator('.oval-seat').nth(1).waitFor();
  await guestPage.locator('#table-settings').click();
  assert.equal(await guestPage.locator('#manage-table').evaluate(el => el.open), true);
  assert.equal(await guestPage.locator('#your-seat').evaluate(el => el.open), true);
  await guestPage.locator('#rebuy-request-amount').fill('125');
  await guestPage.locator('#rebuy-request-form button[type="submit"]').click();
  await guestPage.locator('.rebuy-request-controls [role="status"]').getByText(/Pending/).waitFor();
  await first.page.locator('#table-settings').getByText('1').waitFor();
  await first.page.locator('#table-settings').click();
  await first.page.locator('#your-seat > summary').focus();
  await first.page.keyboard.press('Tab');
  assert.equal(await first.page.evaluate(() => document.activeElement?.matches('#manage-table > summary')), true,
    'keyboard focus wraps to the Manage Table heading');
  await capture(first.page, 'manage-360x740.png');
  await first.page.locator('#open-rebuy-requests-host').click();
  await first.page.locator('[data-rebuy-approve]').click();
  await guestPage.locator('.oval-seat.my-seat .oval-stack').getByText('1,125').waitFor();
  await first.page.locator('#rebuy-requests-dialog [data-close-rebuy]').click();
  await first.page.locator('#manage-table > summary').click();
  await guestPage.locator('#manage-table > summary').click();
  await first.page.locator('#start-hand').click();
  await first.page.locator('#all-in-guard').waitFor();
  await first.page.locator('#table-rail > summary').click();
  assert.equal(await first.page.locator('#hand-log').isVisible(), true, 'one tap opens hand activity');
  assert.equal(await first.page.locator('.workspace-players').count(), 0, 'seat cards replace the duplicate players list');
  await first.page.locator('#table-settings').click();
  await first.page.locator('#quick-tonight').click();
  await first.page.locator('#tonight-dialog').waitFor({ state: 'visible' });
  await first.page.locator('#tonight-dialog [data-close-tonight]').first().click();
  await first.page.locator('#manage-table > summary').click();
  const active = first.page.locator('#all-in-guard');
  assert.equal(await active.isEnabled(), true, 'host is first to act in a heads-up hand');
  await first.page.locator('#toggle-raise').click();
  await first.page.locator('#raise-form').waitFor();
  await first.page.locator('[data-quick="pot"]').click();
  const amount = Number(await first.page.locator('#raise-amount').inputValue());
  assert.ok(amount >= 10, 'quick bet updates amount');
  await capture(first.page, 'raise-360x740.png');
  await first.page.locator('#close-raise').click();
  await active.click();
  assert.match(await first.page.locator('#dialog-title').innerText(), /Go all-in/);
  assert.match(await first.page.locator('#dialog-form').innerText(), /full stack/);
  await first.page.locator('#dialog-close').click();
  assert.equal(await first.page.locator('#seat-dialog').evaluate(el => el.open), false);
  await active.click();
  await first.page.locator('#dialog-form button[type=submit]').click();
  await first.page.locator('#seat-dialog').waitFor({ state: 'hidden' });
  await first.page.locator('#table-settings').click();
  await first.page.locator('#undo').click();
  assert.match(await first.page.locator('#dialog-title').innerText(), /Undo last action/);
  await first.page.locator('#dialog-close').click();
  await first.page.locator('#manage-table > summary').click();

  const ten = await createTable(browser, url, 360, 740, 'Host ten');
  for (let i = 2; i <= 10; i++) await socketPlayer(url, ten.code, `Player ${i}`, sockets);
  await ten.page.locator('.oval-seat').nth(9).waitFor();
  await ten.page.locator('#table-settings').click();
  await ten.page.locator('#kick-form button[type=submit]').click();
  assert.match(await ten.page.locator('#dialog-title').innerText(), /Remove Player 2/);
  await ten.page.locator('#dialog-close').click();
  await ten.page.locator('#manage-table > summary').click();
  await ten.page.locator('#table-rail').evaluate(el => { el.open = false; });
  await ten.page.locator('#start-hand').click();
  await ten.page.locator('.turn-label').waitFor();
  for (const [width, height] of [[360, 740], [390, 844], [768, 1024]]) {
    await ten.page.setViewportSize({ width, height });
    await ten.page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const layout = await ten.page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      seats: [...document.querySelectorAll('.oval-seat')].map(el => el.getBoundingClientRect().width),
      statuses: [...document.querySelectorAll('.oval-status')].map(el => getComputedStyle(el).fontSize) }));
    assert.ok(layout.scroll <= layout.viewport, `${width}: horizontal overflow ${layout.scroll}`);
    assert.equal(layout.seats.length, 10);
    if (width < 700) assert.ok(Math.min(...layout.seats) >= 140, `${width}: seats too narrow ${Math.min(...layout.seats)}`);
    assert.ok(layout.statuses.every(value => parseFloat(value) >= 12), `${width}: seat status below 12px`);
    await capture(ten.page, `table-${width}x${height}.png`);
  }
  await ten.page.setViewportSize({ width: 390, height: 844 });
  await ten.page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  assert.equal(await ten.page.locator('#table-rail').evaluate(el => el.open), false, 'tablet rail closes when moving to phone layout');
  await ten.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bottomSeat = await ten.page.evaluate(() => ({ seat: Math.max(...[...document.querySelectorAll('.table-stage .oval-seat')].map(el => el.getBoundingClientRect().bottom)),
    dock: document.querySelector('.dock').getBoundingClientRect().top }));
  assert.ok(bottomSeat.seat <= bottomSeat.dock - 4, `last mobile seat scrolls clear of action dock ${JSON.stringify(bottomSeat)}`);
  await ten.page.setViewportSize({ width: 360, height: 740 });
  await ten.page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await ten.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(await ten.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% text has no horizontal overflow');
  await capture(ten.page, 'table-large-text-360x740.png');
  await ten.context.close();
  await first.context.close();
  await guestContext.close();
});
