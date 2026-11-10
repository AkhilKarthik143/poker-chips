import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import * as game from '../src/game.js';
import { createServer } from '../src/server.js';
import { DEFAULT_REBUY_POLICY, validRebuyPolicy } from '../src/rebuy-policy.js';

const ask = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));

test('rebuy policy is closed, defaults to host and never enters game settings', () => {
  assert.deepEqual(DEFAULT_REBUY_POLICY, { mode: 'host' });
  for (const policy of [{ mode: 'auto', cap: 0 }, { mode: 'auto', cap: 100, maxPerPlayer: 21 },
    { mode: 'host', cap: 100 }, { mode: 'other' }, { mode: 'auto', cap: 100, arbitrary: true }]) {
    assert.equal(validRebuyPolicy(policy), false);
  }
  assert.equal(validRebuyPolicy({ mode: 'auto', cap: 500, maxPerPlayer: 0 }), true);
});

test('auto rebuys enforce cap, per-player limit and mid-hand deferral', async t => {
  const server = createServer();const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;const sockets = [];
  const open = async () => { const socket = connect(url, { transports: ['websocket'], forceNew: true });sockets.push(socket);
    await new Promise(resolve => socket.once('connect', resolve));return socket; };
  t.after(async () => { sockets.forEach(socket => socket.disconnect());await server.close(); });
  const host = await open();
  const created = await ask(host, 'create', { name: 'Host', settings: {}, rebuyPolicy: { mode: 'auto', cap: 600, maxPerPlayer: 1 } });
  assert.equal(created.ok, true);
  const guest = await open();
  const joined = await ask(guest, 'join', { name: 'Guest', code: created.roomCode });
  let revision = joined.state.revision;
  assert.equal(joined.state.rebuyPolicy.cap, 600);
  assert.equal(Object.hasOwn(joined.state.settings, 'rebuyPolicy'), false);
  assert.equal((await ask(guest, 'host:rebuyPolicy', { token: joined.token, mode: 'host' })).ok, false);
  const firstResult = new Promise(resolve => guest.once('rebuy-result', resolve));
  const first = await ask(guest, 'rebuy:request', { token: joined.token, amount: 500 });
  assert.equal(first.ok, true);
  assert.deepEqual(await firstResult, { type: 'approved', amount: 500 });
  const room = server.rooms.get(created.roomCode);
  assert.equal(room.revision, revision + 1);revision = room.revision;
  assert.equal(room.game.players.find(player => player.id === joined.playerId).stack, 1500);
  assert.equal(room.autoRebuys.get(joined.playerId), 1);
  assert.equal(room.rebuyRequests.size, 0);
  game.assertConservation(room.game);
  const second = await ask(guest, 'rebuy:request', { token: joined.token, amount: 500 });
  assert.equal(second.ok, true);
  assert.equal(room.rebuyRequests.size, 1, 'per-player auto limit leaves a host request');
  assert.equal(room.revision, revision);
  const manual = await ask(host, 'rebuy:approve', { token: created.token, revision, playerId: joined.playerId });
  assert.equal(manual.ok, true);
  revision = manual.state.revision;
  assert.equal(room.autoRebuys.get(joined.playerId), 1, 'manual approval does not consume auto allowance');
  const changed = await ask(host, 'host:rebuyPolicy', { token: created.token, mode: 'auto', cap: 600, maxPerPlayer: 2 });
  assert.equal(changed.ok, true);assert.equal(changed.state.revision, revision);
  const tooLarge = await ask(guest, 'rebuy:request', { token: joined.token, amount: 601 });
  assert.equal(tooLarge.ok, true);assert.equal(room.rebuyRequests.size, 1);assert.equal(room.revision, revision);
  const denied = await ask(host, 'rebuy:deny', { token: created.token, playerId: joined.playerId });
  assert.equal(denied.ok, true);
  const started = await ask(host, 'start-hand', { token: created.token, revision });
  assert.equal(started.ok, true);revision = started.state.revision;
  const pending = await ask(guest, 'rebuy:request', { token: joined.token, amount: 400 });
  assert.equal(pending.ok, true);assert.equal(room.rebuyRequests.size, 1);assert.equal(room.revision, revision);
  const turnToken = started.state.turn === created.playerId ? created.token : joined.token;
  const turnSocket = started.state.turn === created.playerId ? host : guest;
  const completed = await ask(turnSocket, 'action', { token: turnToken, revision, type: 'fold' });
  assert.equal(completed.ok, true);assert.equal(completed.state.street, 'complete');
  assert.equal(room.rebuyRequests.size, 0);
  assert.equal(room.autoRebuys.get(joined.playerId), 2);
  assert.equal(room.game.players.find(player => player.id === joined.playerId).buyIn, 2400);
  game.assertConservation(room.game);
  const undo = await ask(host, 'undo', { token: created.token, revision: room.revision });
  assert.equal(undo.ok, false);
  assert.equal(room.rebuyRequests.size, 0);
  assert.equal((await ask(host, 'host:rebuyPolicy', { token: created.token, mode: 'host' })).state.rebuyPolicy.mode, 'host');
  assert.equal((await ask(guest, 'rebuy:request', { token: joined.token, amount: 100 })).ok, true);
  const kicked = await ask(host, 'kick', { token: created.token, revision: room.revision, playerId: joined.playerId });
  assert.equal(kicked.ok, true);assert.equal(room.rebuyRequests.size, 0);assert.equal(room.autoRebuys.has(joined.playerId), false);
});
