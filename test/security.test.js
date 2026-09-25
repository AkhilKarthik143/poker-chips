import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createServer } from '../src/server.js';
const entry = new Set(['create', 'join', 'rejoin', 'table-preview']);
async function setup(t, options = {}) {
  const server = createServer(options); const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`; const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await server.close(); });
  async function client(extra = {}) {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, ...extra }); clients.push(s);
    s.on('state', state => { s.state = state; });
    await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); }); return s;
  }
  return { server, client, url };
}
async function raw(s, event, payload) {
  const reply = await new Promise((resolve, reject) => s.timeout(2000).emit(event, payload, (err, reply) => err ? reject(err) : resolve(reply)));
  if (reply.ok) { if (reply.state) s.state = reply.state; if (reply.token) s.token = reply.token; }
  return reply;
}
const send = (s, event, payload = {}) => raw(s, event, { ...(!entry.has(event) ? { token: s.token, revision: s.state?.revision } : {}), ...payload });
async function ok(s, event, payload) { const r = await send(s, event, payload); assert.equal(r.ok, true, r.error); return r; }

test('unique normalized names, validation, separate rooms, reserved disconnect and reuse after removal', async t => {
  const { client, server } = await setup(t); const a = await client(); const b = await client(); const c = await client();
  const h = await ok(a, 'create', { name: ' Alex ' });
  for (const name of ['Alex', 'alex', ' ALEX ']) assert.equal((await send(b, 'join', { code: h.roomCode, name })).error, 'Name already taken in this room');
  for (const name of ['', '  ', 'A\u0000B', 'A\nB', 'x'.repeat(21), '<script>']) assert.equal((await send(b, 'join', { code: h.roomCode, name })).ok, false);
  await ok(c, 'create', { name: 'Alex' }); const g = await ok(b, 'join', { code: h.roomCode, name: 'Jordan' });
  const disconnected = new Promise(r => server.io.sockets.sockets.get(b.id).once('disconnect', r)); b.disconnect(); await disconnected;
  const d = await client(); assert.equal((await send(d, 'join', { code: h.roomCode, name: 'Jordan' })).ok, false);
  await ok(d, 'rejoin', { code: h.roomCode, playerId: g.playerId, token: g.token }); d.token = g.token;
  assert.equal(d.state.players.find(p => p.id === g.playerId).name, 'Jordan'); await ok(d, 'leave');
  await ok(d, 'join', { code: h.roomCode, name: ' jordan ' });
});

test('each event rejects malformed shape and unexpected keys atomically', async t => {
  let time = 0; const { client, server } = await setup(t, { now: () => time }); const s = await client();
  const h = await ok(s, 'create', { name: 'Host' }); const before = structuredClone(server.rooms.get(h.roomCode).game);
  const events = ['create','join','rejoin','table-preview','start-hand','action','showdown-pick','host-settings','host:reorderSeats','undo','sit-out','rebuy','host-fold','leave','kick'];
  for (const event of events) for (const value of [null, [], 'bad', 2, {}, { unexpected: true }]) { time += 1001; assert.equal((await raw(s,event,value)).ok,false,`${event}/${JSON.stringify(value)}`); }
  for (const settings of [[], 'oops', {extra:true}, {startingStack:'100'}, {smallBlind:-1}, {bigBlind:1e20}]) {time+=1001;assert.equal((await send(s,'host-settings',{settings})).ok,false);}
  for (const amount of [-1,1e20,'100',null,Infinity,NaN]) {time+=1001;assert.equal((await send(s,'rebuy',{playerId:h.playerId,amount})).ok,false);}
  assert.deepEqual(server.rooms.get(h.roomCode).game,before);
});

test('every mutation requires own token and host authorization, replay is atomic', async t => {
  const { client, server } = await setup(t); const a=await client(), b=await client();const h=await ok(a,'create',{name:'Host'});const g=await ok(b,'join',{name:'Guest',code:h.roomCode});
  a.state=g.state;
  assert.equal((await raw(a,'sit-out',{revision:a.state.revision,value:true})).ok,false);
  assert.equal((await send(a,'sit-out',{token:g.token,value:true})).ok,false);
  for(const event of ['start-hand','undo','host-fold']) assert.equal((await send(b,event)).ok,false);
  for(const [event,payload] of [['host-settings',{settings:{bigBlind:20}}],['host:reorderSeats',{order:g.state.seatOrder}],['kick',{playerId:h.playerId}],['rebuy',{playerId:g.playerId,amount:5}],['showdown-pick',{potId:0,winnerIds:[g.playerId]}]]) assert.equal((await send(b,event,payload)).ok,false);
  await ok(a,'start-hand'); const revision=a.state.revision;
  const replies=await Promise.all(Array.from({length:8},()=>send(a,'action',{type:'call',revision})));
  assert.equal(replies.filter(r=>r.ok).length,1);assert.equal(server.rooms.get(h.roomCode).revision,revision+1);
  const c=await client();assert.equal((await send(c,'rejoin',{code:h.roomCode,playerId:h.playerId,token:g.token})).ok,false);
  assert.equal((await send(c,'rejoin',{code:h.roomCode,playerId:h.playerId,token:'0'.repeat(64)})).ok,false);
});

test('entry abuse limits survive new socket connections and reset with time', async t => {
  let time=0;const {client}=await setup(t,{now:()=>time});const a=await client();
  for(let i=0;i<30;i++) await send(a,'table-preview',{code:'ABCDEFGH'});
  const b=await client();assert.match((await send(b,'table-preview',{code:'ABCDEFGH'})).error,/Too many/);
  time=60001;assert.doesNotMatch((await send(b,'table-preview',{code:'ABCDEFGH'})).error,/Too many/);
});

test('room codes have eight letters, malformed identifiers rejected, unexpected errors stay private', async t => {
  const logged=[];const {client,server}=await setup(t,{logError:e=>logged.push(e)});const a=await client();const h=await ok(a,'create',{name:'Host'});
  assert.match(h.roomCode,/^[A-HJ-NP-Z]{8}$/);assert.match(h.token,/^[a-f0-9]{64}$/);
  const b=await client();for(const code of [2,{},'X'.repeat(100),'../../etc/passwd']) assert.equal((await send(b,'table-preview',{code})).error,'Invalid request.');
  const room=server.rooms.get(h.roomCode);const original=room.game;Object.defineProperty(room,'game',{configurable:true,get(){throw new Error('private /server/path secret');}});
  assert.equal((await send(a,'sit-out',{value:true})).error,'Something went wrong. Please try again.');
  Object.defineProperty(room,'game',{configurable:true,writable:true,value:original});assert.equal(logged.length,1);
  assert.equal(JSON.stringify(h.state).includes(h.token),false);assert.equal('history' in h.state,false);
});

test('production origins reject foreign WebSocket handshakes and accept configured origin', async t => {
  const {client,url}=await setup(t,{allowedOrigins:['https://poker-chips-o7n9.onrender.com']});
  await assert.rejects(client({extraHeaders:{Origin:'https://attacker.example'}}));
  await client({extraHeaders:{Origin:'https://poker-chips-o7n9.onrender.com'}});
  const response=await fetch(url+'/healthz');assert.equal(response.status,200);
  assert.equal(response.headers.get('content-security-policy').includes(' ws:'),false);
});

test('settings reject prototype keys, room creation and action floods are bounded', async t => {
  let time=0;const {client,server}=await setup(t,{now:()=>time});const a=await client();const h=await ok(a,'create',{name:'Host'});
  for(const key of ['constructor','__proto__','toString']) {const settings=JSON.parse(`{"${key}":123}`);assert.equal((await send(a,'host-settings',{settings})).error,'Invalid request.');}
  for(let i=0;i<45;i++) {const reply=await send(a,'sit-out',{value:true});if(i>=40) assert.match(reply.error,/Too many/);}
  assert.equal(server.rooms.get(h.roomCode).game.totalChips,1000);
  time=60001;
  for(let i=0;i<12;i++) {const s=await client();await ok(s,'create',{name:'Host'});}
  const extra=await client();assert.match((await send(extra,'create',{name:'Host'})).error,/Too many/);
});

test('development accepts same-origin LAN clients while rejecting foreign origins', async t => {
  const {client}=await setup(t);
  await client({extraHeaders:{Host:'192.168.1.50:3000',Origin:'http://192.168.1.50:3000'}});
  await assert.rejects(client({extraHeaders:{Host:'192.168.1.50:3000',Origin:'http://attacker.example'}}));
});
