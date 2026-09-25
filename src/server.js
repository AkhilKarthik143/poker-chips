import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import * as game from './game.js';
import { RequestError, requireValue, validatePayload, entryEvents } from './validation.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const safeTokenEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createServer({ now = Date.now, idleMs = SIX_HOURS, cleanupIntervalMs = 60_000, allowedOrigins = process.env.NODE_ENV === 'production' ? [process.env.RENDER_EXTERNAL_URL || 'https://poker-chips-o7n9.onrender.com'] : null, trustProxy = process.env.RENDER === 'true', logError = error => process.stderr.write(`${error.stack}\n`) } = {}) {
  const app = express();
  const httpServer = createHttpServer(app);
  const originAllowed = (origin, requestHost) => allowedOrigins ? allowedOrigins.includes(origin)
    : !origin || origin === `http://${requestHost}` || origin === `https://${requestHost}`;
  const io = new Server(httpServer, { maxHttpBufferSize: 16_384,
    cors: { origin: (origin, cb) => cb(null, allowedOrigins ? allowedOrigins.includes(origin) : true) },
    allowRequest: (req, cb) => {
      let origin = req.headers.origin;
      if (!origin && req.headers['sec-fetch-site'] === 'same-origin') {
        try { origin = new URL(req.headers.referer).origin; } catch { /* Invalid/missing referrer remains denied in production. */ }
      }
      cb(null, originAllowed(origin, req.headers.host));
    } });
  const attempts = new Map();
  function entryLimit(socket, event) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    // Render is the single trusted edge; use its appended hop, never client-prepended entries.
    const ip = trustProxy && typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : socket.handshake.address;
    const key = `${ip}:${event === 'create' ? 'create' : 'join'}`;
    let bucket = attempts.get(key);
    if (!bucket || now() - bucket.start >= 60_000) {
      requireValue(attempts.has(key) || attempts.size < 10_000, 'Too many requests. Try again in a moment.');
      bucket = { start: now(), count: 0 }; attempts.set(key, bucket);
    }
    requireValue(++bucket.count <= (event === 'create' ? 12 : 30), 'Too many requests. Try again in a moment.');
  }
  const rooms = new Map();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  function view(room, id) {
    const state = structuredClone(room.game);
    delete state.history;
    return { ...state, roomCode: room.code, hostId: room.hostId, playerId: id, revision: room.revision,
      canUndo: room.game.history.length > 0, serverTime: now(),
      players: state.players.map(p => ({ ...p, connected: room.connections.has(p.id) })),
      // Side pots are finalized once, when the hand reaches showdown. Do not
      // expose recalculated layers after every street; that makes one hand look
      // like it is creating new pots each round.
      pots: state.street === 'showdown' || state.street === 'complete' ? state.pots : [],
      legal: game.legalActions(room.game, id) };
  }
  function broadcast(room) {
    room.game.log.forEach(item => { if (item.timestamp === undefined) item.timestamp = now(); });
    for (const [id, socketId] of room.connections) io.sockets.sockets.get(socketId)?.emit('state', view(room, id));
  }
  function bind(socket, room, id) {
    const previousId = room.connections.get(id);
    if (previousId && previousId !== socket.id) {
      const previous = io.sockets.sockets.get(previousId);
      if (previous) {
        previous.data.identity = null;
        previous.emit('session-replaced');
        previous.disconnect(true);
      }
    }
    room.connections.set(id, socket.id);
    socket.data.identity = { code: room.code, id };
    room.lastActive = now();
  }
  function member(socket, payload) {
    const identity = socket.data.identity;
    const room = rooms.get(identity?.code);
    requireValue(room && room.connections.get(identity.id) === socket.id, 'Rejoin the room to continue.');
    requireValue(safeTokenEqual(room.tokens.get(identity.id), payload.token), 'Seat token is invalid. Rejoin the room to continue.');
    return { room, id: identity.id };
  }
  function host(room, id) { requireValue(room.hostId === id, 'Only the host can do that.'); }
  function detach(room, id, reason) {
    const socket = io.sockets.sockets.get(room.connections.get(id));
    if (socket) {
      socket.data.identity = null;
      socket.emit('removed', { message: reason });
    }
    room.connections.delete(id);
    room.tokens.delete(id);
  }
  function sweep() {
    for (const [key, bucket] of attempts) if (now() - bucket.start >= 60_000) attempts.delete(key);
    for (const [code, room] of rooms) {
      if (now() - room.lastActive >= idleMs) {
        for (const id of [...room.connections.keys()]) detach(room, id, 'Room expired after six hours of inactivity.');
        rooms.delete(code);
      }
    }
  }
  const cleanup = setInterval(sweep, cleanupIntervalMs);
  cleanup.unref();

  io.on('connection', socket => {
    let windowStart = now();
    let requests = 0;
    function on(event, fn) {
      socket.on(event, (payload, acknowledgement) => {
        const ack = typeof acknowledgement === 'function' ? acknowledgement : () => {};
        try {
          if (now() - windowStart >= 1000) { windowStart = now(); requests = 0; }
          requireValue(++requests <= 40, 'Too many requests. Try again in a moment.');
          if (entryEvents.has(event)) entryLimit(socket, event);
          validatePayload(event, payload);
          const response = fn(payload);
          ack({ ok: true, ...response });
        } catch (error) {
          const message = error instanceof RequestError ? error.message : 'Something went wrong. Please try again.';
          if (!(error instanceof RequestError)) logError(error);
          socket.emit('request-error', { event, error: message });
          ack({ ok: false, error: message });
        }
      });
    }
    on('create', payload => {
      requireValue(!socket.data.identity, 'Leave your current table first.');
      requireValue(rooms.size < 1000, 'Server is full. Try again later.');
      const id = randomUUID();
      const state = game.addPlayer(game.createTable(payload.settings), id, payload.name);
      let code;
      do { code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (rooms.has(code));
      const token = randomBytes(32).toString('hex');
      const room = { code, hostId: id, game: state, tokens: new Map([[id, token]]), connections: new Map(), lastActive: now(), revision: 0 };
      rooms.set(code, room); bind(socket, room, id); broadcast(room);
      return { token, playerId: id, roomCode: code, state: view(room, id) };
    });
    on('table-preview', payload => {
      const room = rooms.get(payload.code.toUpperCase());
      requireValue(room, 'Room not found. Check the eight-letter code.');
      requireValue(!game.isPlaying(room.game), 'Join between hands.');
      requireValue(room.game.players.length < 10, 'This table has 10 players.');
      return { players: room.game.players.length, ...room.game.settings };
    });
    on('join', payload => {
      requireValue(!socket.data.identity, 'Leave your current table first.');
      const room = rooms.get(payload.code.toUpperCase());
      requireValue(room, 'Room not found. Check the eight-letter code.');
      requireValue(payload.expectedBuyIn === undefined || payload.expectedBuyIn === room.game.settings.startingStack, 'Buy-in changed. Review the table and confirm again.');
      const id = randomUUID();
      room.game = game.addPlayer(room.game, id, payload.name);
      const token = randomBytes(32).toString('hex');
      room.tokens.set(id, token); room.revision++;
      bind(socket, room, id); broadcast(room);
      return { token, playerId: id, roomCode: room.code, state: view(room, id) };
    });
    on('rejoin', payload => {
      requireValue(!socket.data.identity, 'Already seated on this connection.');
      const room = rooms.get(payload.code.toUpperCase());
      requireValue(room, 'Room no longer exists. Create a new table.');
      requireValue(safeTokenEqual(room.tokens.get(payload.playerId), payload.token), 'Seat token is invalid.');
      bind(socket, room, payload.playerId); broadcast(room);
      return { playerId: payload.playerId, roomCode: room.code, state: view(room, payload.playerId) };
    });
    function mutate(event, fn, hostOnly = false) {
      on(event, payload => {
        const { room, id } = member(socket, payload);
        if (hostOnly) host(room, id);
        requireValue(payload.revision === room.revision, 'Table changed. Please try again.');
        const nextState = fn(room, id, payload);
        room.game = nextState; room.revision++; room.lastActive = now();
        broadcast(room);
        return { state: view(room, id) };
      });
    }
    mutate('start-hand', room => game.startHand(room.game, now()), true);
    mutate('action', (room, id, payload) => game.act(room.game, id, { type: payload.type, amount: payload.amount }));
    mutate('showdown-pick', (room, _id, payload) => game.pickWinners(room.game, payload.potId, payload.winnerIds), true);
    mutate('host-settings', (room, _id, payload) => game.configure(room.game, payload.settings), true);
    mutate('host:reorderSeats', (room, _id, payload) => game.reorderSeats(room.game, payload.order), true);
    mutate('undo', room => game.undo(room.game), true);
    mutate('sit-out', (room, id, payload) => game.setSitOut(room.game, id, payload.value));
    mutate('rebuy', (room, _id, payload) => game.rebuy(room.game, payload.playerId, payload.amount), true);
    mutate('host-fold', room => {
      requireValue(room.game.turn && !room.connections.has(room.game.turn), 'Only the disconnected current player can be folded by the host.');
      return game.act(room.game, room.game.turn, { type: 'fold' });
    }, true);
    on('leave', payload => {
      const { room, id } = member(socket, payload);
      requireValue(payload.revision === room.revision, 'Table changed. Please try again.');
      room.game = game.removePlayer(room.game, id);
      detach(room, id, 'You left the table.'); room.revision++; room.lastActive = now();
      if (!room.game.players.length) rooms.delete(room.code);
      else {
        if (room.hostId === id) room.hostId = room.game.players[0].id;
        broadcast(room);
      }
      return {};
    });
    mutate('kick', (room, id, payload) => {
      requireValue(payload.playerId !== id, 'Use Leave table to leave.');
      const state = game.removePlayer(room.game, payload.playerId);
      detach(room, payload.playerId, 'The host removed your seat.');
      return state;
    }, true);
    socket.on('disconnect', () => {
      const identity = socket.data.identity;
      const room = rooms.get(identity?.code);
      if (room && room.connections.get(identity.id) === socket.id) {
        room.connections.delete(identity.id);
        broadcast(room);
      }
    });
  });
  return { app, httpServer, io, rooms, sweep,
    listen: (port = 0, host = '127.0.0.1') => new Promise(resolve => httpServer.listen(port, host, () => resolve(httpServer.address()))),
    close: () => new Promise(resolve => { clearInterval(cleanup); io.close(() => resolve()); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  const port = Number(process.env.PORT || 3000);
  await server.listen(port, '0.0.0.0');
  process.stdout.write(`Poker Chips listening on port ${port}\n`);
  const stop = async () => { await server.close(); process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
