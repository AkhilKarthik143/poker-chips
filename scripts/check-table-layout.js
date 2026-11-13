/* global document, window, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { hashSecret } from '../src/auth.js';
import { DEFAULT_PRIVACY } from '../src/identity.js';

const shots = new URL('../artifacts/qa/table-layout/', import.meta.url).pathname;
await mkdir(shots, { recursive: true });
const store = new SqliteStore(':memory:');
const now = Date.now();
const hostToken = 'a'.repeat(64); const peerToken = 'b'.repeat(64);
for (const [id, token, color, username, publicUsername] of [
  ['layout-host', hostToken, '#a94f8d', 'verylongtablename', true],
  ['layout-peer', peerToken, '#3c82ad', 'secondlongusername', false]
]) {
  await store.createAccount(id, `${id}@example.test`, id, now);
  await store.updateProfile(id, { username, privacy: { ...DEFAULT_PRIVACY, showUsernameAtTables: publicUsername } }, now, 0);
  const image = await sharp({ create: { width: 280, height: 240, channels: 3, background: color } }).webp().toBuffer();
  await store.setAvatarPhoto(id, id === 'layout-host' ? 'a'.repeat(32) : 'b'.repeat(32), image, now);
  await store.saveSession(hashSecret(token), id, now + 3_600_000);
}
const server = createServer({ store });
const { port } = await server.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
const sockets = [];
const sizes = [[320, 700], [360, 740], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [844, 390]];
const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
async function settle(page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}
async function inspect(page, label, width, height, takeShot = false) {
  await page.setViewportSize({ width, height }); await settle(page);
  const data = await page.evaluate(() => {
    const rect = node => node.getBoundingClientRect().toJSON();
    const stage = document.querySelector('.table-stage');
    const board = stage.querySelector('.pot-board');
    const header = document.querySelector('.table-heading');
    const dock = document.querySelector('.dock');
    const map = stage.querySelector('.seat-order-guide');
    const seats = [...stage.querySelectorAll('.oval-seat')];
    return { stage: rect(stage), board: rect(board), header: rect(header),
      headerButtons: [...header.querySelectorAll('button')].map(rect),
      shortcutsInHeader: header.contains(document.querySelector('.table-quick-nav')),
      resultInBoard: !document.querySelector('.result') || board.contains(document.querySelector('.result')),
      seats: seats.map(seat => ({ rect: rect(seat),
      avatars: [...seat.querySelectorAll('.seat-avatar-frame img,.seat-avatar-frame canvas,.seat-avatar-frame svg')].map(rect),
      photosLoaded: [...seat.querySelectorAll('.seat-avatar-frame img')].every(image => image.complete && image.naturalWidth > 0),
      roles: [...seat.querySelectorAll('.seat-roles span')].map(rect),
      status: rect(seat.querySelector('.oval-status')), nameCount: seat.querySelectorAll('.oval-name strong').length,
      name: seat.querySelector('.oval-name strong').textContent,
      visibleName: seat.querySelector('.oval-name strong').scrollHeight <= seat.querySelector('.oval-name strong').clientHeight + 1 })),
      boardAbove: stage.classList.contains('board-above') || stage.classList.contains('waiting-stage'),
      compact: stage.classList.contains('compact-seating'),
      map: { visible: getComputedStyle(map).display !== 'none', rect: rect(map),
        nodes: [...map.querySelectorAll('[data-seat-map-index]')].map(node => Number(node.dataset.seatMapIndex)),
        own: map.querySelectorAll('.is-you').length, acting: map.querySelectorAll('.is-acting').length },
      dock: rect(dock),
      scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth,
      waitingCopy: board.textContent.replace(/\s+/g, ' ') };
  });
  assert.ok(data.scrollWidth <= data.viewportWidth + 1, `${label} ${width}: horizontal overflow`);
  assert.equal(data.shortcutsInHeader, true, `${label} ${width}: table shortcuts are outside header`);
  assert.equal(data.resultInBoard, true, `${label} ${width}: result is detached from status board`);
  for (const [index, button] of data.headerButtons.entries()) {
    assert.ok(button.left >= data.header.left - 1 && button.right <= data.header.right + 1 &&
      button.top >= data.header.top - 1 && button.bottom <= data.header.bottom + 1,
    `${label} ${width}: header button ${index + 1} escapes header`);
    for (const other of data.headerButtons.slice(index + 1))
      assert.equal(intersects(button, other), false, `${label} ${width}: header buttons overlap`);
  }
  assert.ok(data.header.bottom < data.stage.top, `${label} ${width}: header overlaps table`);
  assert.ok(data.board.left >= data.stage.left - 1 && data.board.right <= data.stage.right + 1,
    `${label} ${width}: board outside stage`);
  assert.equal(intersects(data.board, data.dock), false, `${label} ${width}: board covered by action dock ${JSON.stringify({board:data.board,dock:data.dock})}`);
  assert.deepEqual(data.map.nodes, data.seats.map((_, index) => index + 1), `${label} ${width}: seat map order differs from cards`);
  assert.equal(data.map.own, 1, `${label} ${width}: seat map needs one local marker`);
  assert.equal(data.map.visible, width < 700 && !data.compact, `${label} ${width}: seat map visibility`);
  if (data.map.visible) {
    assert.equal(intersects(data.board, data.map.rect), false, `${label} ${width}: seat map overlaps board`);
    for (const seat of data.seats) assert.equal(intersects(data.map.rect, seat.rect), false, `${label} ${width}: seat map overlaps card`);
  }
  for (const [index, seat] of data.seats.entries()) {
    assert.equal(seat.photosLoaded, true, `${label} ${width}: seat ${index + 1} photo failed to load`);
    assert.equal(seat.nameCount, 1, `${label} ${width}: seat ${index + 1} has duplicate names`);
    assert.equal(seat.visibleName, true, `${label} ${width}: seat ${index + 1} name clipped`);
    assert.ok(seat.rect.left >= data.stage.left - 2 && seat.rect.right <= data.stage.right + 2,
      `${label} ${width}: seat ${index + 1} outside stage horizontally`);
    assert.ok(seat.rect.top >= data.stage.top - 2 && seat.rect.bottom <= data.stage.bottom + 2,
      `${label} ${width}: seat ${index + 1} outside stage vertically`);
    assert.equal(intersects(data.board, seat.rect), false, `${label} ${width}: board overlaps seat ${index + 1}`);
    for (const element of [...seat.avatars, ...seat.roles, seat.status]) {
      assert.ok(element.left >= seat.rect.left - 1 && element.right <= seat.rect.right + 1 &&
        element.top >= seat.rect.top - 1 && element.bottom <= seat.rect.bottom + 1,
      `${label} ${width}: avatar, badge or status escapes seat ${index + 1}`);
    }
    for (const other of data.seats.slice(index + 1))
      assert.equal(intersects(seat.rect, other.rect), false, `${label} ${width}: seats collide`);
  }
  if (data.compact) assert.ok(data.stage.height < 600, `${label} ${width}: waiting stage wastes space`);
  if (takeShot) await page.screenshot({ path: `${shots}${label}-${width}x${height}.png`, fullPage: true, animations: 'disabled' });
  return data;
}
async function inspectRaise(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.locator('#toggle-raise').click();
  await settle(page);
  const data = await page.evaluate(() => {
    const rect = node => node.getBoundingClientRect().toJSON();
    const form = document.querySelector('#raise-form');
    return { form: rect(form), header: rect(form.querySelector('.raise-sheet-header')),
      amount: rect(form.querySelector('#raise-amount')), stepper: rect(form.querySelector('.amount-stepper')),
      buttons: [...form.querySelectorAll('.quick-bets button')].map(rect),
      submit: rect(form.querySelector('.raise-submit')),
      dock: rect(document.querySelector('.dock')) };
  });
  assert.ok(data.form.left >= 0 && data.form.right <= width + 1, `raise ${width}: sheet outside viewport`);
  assert.ok(data.form.top >= 0 && data.form.bottom <= (height <= 500 ? height : data.dock.top + 2),
    `raise ${width}: sheet overlaps dock or viewport edge ${JSON.stringify({form:data.form,dock:data.dock})}`);
  assert.ok(data.form.width <= 580, `raise ${width}: sheet too wide`);
  assert.ok(data.amount.width >= (width >= 700 ? 280 : 100), `raise ${width}: amount input cramped`);
  assert.ok(data.header.bottom < data.stepper.top, `raise ${width}: header overlaps amount`);
  for (const button of data.buttons) {
    assert.ok(button.width >= 48, `raise ${width}: quick bet too narrow`);
    assert.ok(button.left >= data.form.left && button.right <= data.form.right, `raise ${width}: quick bet escapes`);
  }
  assert.ok(data.submit.top >= data.buttons[0].bottom, `raise ${width}: submit overlaps quick bets`);
  const initial = Number(await page.locator('#raise-amount').inputValue());
  await page.locator('[data-raise-step="1"]').click();
  assert.ok(Number(await page.locator('#raise-amount').inputValue()) > initial, `raise ${width}: stepper did not increase amount`);
  await page.locator('[data-quick="min"]').click();
  assert.equal(Number(await page.locator('#raise-amount').inputValue()), initial, `raise ${width}: Min did not reset amount`);
  await page.screenshot({ path: `${shots}raise-${width}x${height}.png`, fullPage: true, animations: 'disabled' });
  await page.locator('#close-raise').click();
}
async function joinSocket(code, name, token = null) {
  const socket = io(base, { transports: ['websocket'], forceNew: true,
    ...(token ? { extraHeaders: { Cookie: `tm_session=${token}` } } : {}) });
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const result = await new Promise(resolve => socket.emit('join', { code, name }, resolve));
  assert.equal(result.ok, true, `${result.error} (${code}, ${name})`);
  const seat = { socket, token: result.token, state: result.state };
  socket.on('state', state => { seat.state = state; });
  return seat;
}
async function waitRevision(seat, revision) {
  if (seat.state.revision > revision) return;
  await new Promise(resolve => {
    const updated = state => {
      if (state.revision <= revision) return;
      seat.socket.off('state', updated);
      resolve();
    };
    seat.socket.on('state', updated);
  });
}
async function act(seat, type) {
  const result = await new Promise(resolve => seat.socket.emit('action',
    { token: seat.token, revision: seat.state.revision, type }, resolve));
  assert.equal(result.ok, true, result.error);
  seat.state = result.state;
}
async function createTable() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ name: 'tm_session', value: hostToken, domain: '127.0.0.1', path: '/' }]);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#name').fill('Long custom host name');
  await page.locator('#starting-stack').fill('999999999');
  await page.locator('#entry-submit').click();
  await page.locator('.oval-seat').waitFor();
  const code = (await page.locator('#copy-code strong').innerText()).trim();
  return { context, page, code, errors };
}
try {
  const table = await createTable();
  for (const count of [1, 2, 3, 4, 6, 8, 10]) {
    if (count === 2) await joinSocket(table.code, 'Second long name', peerToken);
    if (count > 2) {
      const current = await table.page.locator('.oval-seat').count();
      for (let index = current; index < count; index++) await joinSocket(table.code, `Guest Player ${index + 1}`);
    }
    await table.page.locator('.oval-seat').nth(count - 1).waitFor();
    for (const [width, height] of sizes) await inspect(table.page, `waiting-${count}`, width, height,
      [320, 390, 1280].includes(width) && [1, 2, 10].includes(count));
  }
  await table.page.setViewportSize({ width: 1280, height: 800 });
  await table.page.locator('#start-hand').click();
  await table.page.locator('.live-stage').waitFor();
  for (const [width, height] of sizes) await inspect(table.page, 'active-10', width, height, [320, 390, 1280].includes(width));
  for (const theme of ['felt', 'midnight', 'burgundy', 'graphite', 'daylight', 'miami-vice', 'royal-flush', 'retro-arcade', 'system']) {
    await table.page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const [width, height] of [[390, 844], [1280, 800]])
      await inspect(table.page, `active-10-${theme}`, width, height, ['felt', 'miami-vice', 'royal-flush', 'retro-arcade'].includes(theme));
  }
  await table.page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  for (const [width, height] of [[360, 740], [1280, 800]])
    await inspect(table.page, 'active-10-large-text', width, height);
  await table.page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  assert.deepEqual(table.errors, [], 'table page errors');
  await table.context.close();

  const two = await createTable();
  const peer = await joinSocket(two.code, 'Second long name', peerToken);
  await two.page.locator('.oval-seat').nth(1).waitFor();
  await two.page.locator('#start-hand').click();
  await two.page.locator('.live-stage').waitFor();
  for (const [width, height] of sizes) await inspect(two.page, 'active-2', width, height, [320, 390, 1280].includes(width));
  for (const [width, height] of [[2392, 696], [1280, 800], [768, 1024], [844, 390], [390, 844], [320, 700]])
    await inspectRaise(two.page, width, height);
  for (let turn = 0; turn < 12 && peer.state.street !== 'showdown'; turn++) {
    const revision = peer.state.revision;
    if (peer.state.turn === peer.state.playerId) await act(peer, peer.state.legal.canCheck ? 'check' : 'call');
    else {
      await two.page.locator('[data-action="check"]:not([disabled]),[data-action="call"]:not([disabled])').first().click();
      await waitRevision(peer, revision);
    }
  }
  assert.equal(peer.state.street, 'showdown', 'two-player hand reaches showdown');
  await two.page.locator('.showdown').waitFor();
  for (const [width, height] of sizes) await inspect(two.page, 'showdown-2', width, height, [390, 1280].includes(width));
  await two.page.locator('.winner-form input[name="winner"]').first().check();
  await two.page.locator('.winner-form button[type="submit"]').click();
  await two.page.locator('.result').waitFor();
  for (const [width, height] of sizes) await inspect(two.page, 'complete-2', width, height, [390, 1280].includes(width));
  assert.deepEqual(two.errors, [], 'two-player table page errors');
  await two.context.close();

  const three = await createTable();
  const guests = [await joinSocket(three.code, 'Second player'), await joinSocket(three.code, 'Third player')];
  await three.page.locator('.oval-seat').nth(2).waitFor();
  await three.page.locator('#start-hand').click();
  await three.page.locator('.live-stage').waitFor();
  for (let turn = 0; turn < 15 && guests[0].state.street !== 'complete'; turn++) {
    const current = guests[0].state;
    if (current.street === 'showdown') {
      await three.page.locator('.winner-form input[name="winner"]').first().check();
      await three.page.locator('.winner-form button[type="submit"]').click();
      await waitRevision(guests[0], current.revision);
      continue;
    }
    const guest = guests.find(item => item.state.playerId === current.turn);
    if (guest) await act(guest, guest.state.legal.toCall > 0 ? 'fold' : 'check');
    else if (await three.page.locator('[data-action="fold"]:not([disabled])').count())
      await three.page.locator('[data-action="fold"]:not([disabled])').click();
    else await three.page.locator('[data-action="check"]:not([disabled])').click();
    await waitRevision(guests[0], current.revision);
  }
  assert.equal(guests[0].state.street, 'complete', 'three-player hand completes');
  await three.page.locator('.complete-stage').waitFor();
  for (const [width, height] of sizes)
    await inspect(three.page, 'complete-3', width, height, [390, 1280].includes(width));
  assert.deepEqual(three.errors, [], 'three-player table page errors');
  await three.context.close();
  process.stdout.write(`Table layout passed: waiting 1/2/3/4/6/8/10, active 2/10, showdown and complete 2/3 across ${sizes.length} viewports; screenshots in ${shots}\n`);
} finally {
  sockets.forEach(socket => socket.disconnect());
  await browser.close(); await server.close();
}
