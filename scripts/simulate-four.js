/** Scripted four-player service check: two all-ins, all streets, side pot, exact payout. */
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createServer } from '../src/server.js';
const service = createServer();
const address = await service.listen();
const sockets = [];
let latest;
async function send(socket, event, payload = {}) {
  const reply = await new Promise((resolve, reject) => socket.timeout(3000).emit(event, { ...(!['create', 'join'].includes(event) ? { revision: latest?.revision, token: socket.token } : {}), ...payload }, (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(reply.ok, true, reply.error);
  if (reply.state) latest = reply.state;
  if (reply.token) socket.token = reply.token;
  return reply;
}
try {
  for (let i = 0; i < 4; i++) {
    const socket = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    await send(socket, i ? 'join' : 'create', i ? { name: `Seat ${i}`, code: latest.roomCode } : { name: 'Seat 0', settings: { startingStack: 50, smallBlind: 5, bigBlind: 10 } });
  }
  const ids = latest.players.map(p => p.id);
  for (let i = 1; i < 4; i++) await send(sockets[0], 'rebuy', { playerId: ids[i], amount: i === 1 ? 50 : 150 });
  assert.deepEqual(latest.players.map(p => p.stack), [50, 100, 200, 200]);
  await send(sockets[0], 'start-hand');
  for (const type of ['call', 'all-in', 'all-in', 'call', 'call']) {
    await send(sockets[ids.indexOf(latest.turn)], 'action', { type });
    assert.equal(latest.players.reduce((sum, p) => sum + p.stack + p.contributed, 0), 550);
  }
  const streets = new Set(['preflop']);
  while (latest.turn) {
    streets.add(latest.street);
    await send(sockets[ids.indexOf(latest.turn)], 'action', { type: 'check' });
    assert.equal(latest.players.reduce((sum, p) => sum + p.stack + p.contributed, 0), 550);
  }
  assert.deepEqual([...streets], ['preflop', 'flop', 'turn', 'river']);
  assert.deepEqual(latest.pots.map(p => p.amount), [200, 150]);
  await send(sockets[0], 'showdown-pick', { potId: 0, winnerIds: [ids[0]] });
  await send(sockets[0], 'showdown-pick', { potId: 1, winnerIds: [ids[1]] });
  assert.deepEqual(latest.players.map(p => p.stack), [200, 150, 100, 100]);
  assert.equal(latest.players.reduce((sum, p) => sum + p.stack, 0), 550);
  process.stdout.write('PASS: four players, two all-ins, every street, pots 200 + 150; final stacks 200/150/100/100; 550 chips conserved.\n');
} finally {
  sockets.forEach(socket => socket.disconnect());
  await service.close();
}
