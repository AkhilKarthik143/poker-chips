import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/game.js';
import {createServer} from '../src/server.js';
import {io} from 'socket.io-client';
const table=()=>game.addPlayer(game.addPlayer(game.createTable(),'a','Alex'),'b','Blair');
test('donations transfer existing chips atomically and clear undo history',()=>{
 const before=table();before.history=[{}];const after=game.donate(before,'a','b',125);
 assert.deepEqual(after.players.map(p=>p.stack),[875,1125]);assert.equal(after.totalChips,2000);assert.deepEqual(after.history,[]);assert.match(after.log.at(-1).text,/Alex donated 125 chips to Blair/);assert.equal(before.players[0].stack,1000);
 assert.deepEqual(game.donate(before,'a','b',1000).players.map(p=>p.stack),[0,2000]);
 for(const [to,amount] of [['a',10],['missing',10],['b',0],['b',-1],['b',1001],['b',1.5],['b',Infinity],['b','5']])assert.throws(()=>game.donate(before,'a',to,amount));
 for(const street of ['preflop','flop','turn','river','showdown'])assert.throws(()=>game.donate({...before,street},'a','b',5),/between hands/);
 assert.equal(game.donate({...before,street:'complete'},'a','b',5).players[0].stack,995);
});
test('non-host can donate only own chips; broadcast, replay and mid-hand checks',async t=>{
 const server=createServer();const addr=await server.listen();const clients=[];t.after(async()=>{clients.forEach(s=>s.disconnect());await server.close();});
 async function client(){const s=io(`http://127.0.0.1:${addr.port}`,{transports:['websocket']});clients.push(s);await new Promise(r=>s.on('connect',r));return s;}
 const send=(s,event,payload)=>new Promise((resolve,reject)=>s.timeout(1000).emit(event,payload,(err,r)=>err?reject(err):resolve(r)));
 const a=await client(),b=await client();const host=await send(a,'create',{name:'Alex'});const guest=await send(b,'join',{code:host.roomCode,name:'Blair'});
 const payload={token:guest.token,revision:guest.state.revision,recipientId:host.playerId,amount:100};
 for(const extra of [{token:host.token},{senderId:host.playerId},{amount:-1},{amount:'100'},{recipientId:guest.playerId}])assert.equal((await send(b,'donate',{...payload,...extra})).ok,false);
 const broadcast=new Promise(r=>a.once('state',r));const result=await send(b,'donate',payload);assert.equal(result.ok,true,result.error);assert.deepEqual((await broadcast).players.map(p=>p.stack),[1100,900]);assert.equal((await send(b,'donate',payload)).ok,false);
 const started=await send(a,'start-hand',{token:host.token,revision:result.state.revision});assert.equal(started.ok,true);
 const denied=await send(b,'donate',{...payload,revision:started.state.revision});assert.equal(denied.ok,false);assert.match(denied.error,/between hands/);
});
