import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
const webPush = createRequire(import.meta.url)('web-push');
import * as game from './game.js';
import { RequestError, requireValue, validatePayload, entryEvents, normalizedName, validName } from './validation.js';
import { createStore } from './store/index.js';
import { createMailer } from './mail.js';
import { createAuth, normalizeEmail } from './auth.js';
import { aggregateStats, paginateNights } from './stats.js';
import { LeagueStore } from './league-store.js';
import { validateScoring, computeStandings, recordsFromResults } from './league.js';
import { DEFAULT_PREFS, PREF_ENUMS, normalizePrefs, validatePrefs } from './prefs-schema.js';
import { MAX_PRESETS, normalizePreset, validPreset } from './preset-schema.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const safeTokenEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hashToken = value => createHash('sha256').update(value).digest('hex');

export function createServer({ now = Date.now, idleMs = SIX_HOURS, cleanupIntervalMs = 60_000, allowedOrigins = process.env.NODE_ENV === 'production' ? [process.env.RENDER_EXTERNAL_URL || 'https://poker-chips-o7n9.onrender.com'] : null, trustProxy = process.env.RENDER === 'true', logError = error => process.stderr.write(`${error.stack}\n`), pushTransport = webPush, vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT }, store = createStore(), mailer = createMailer() } = {}) {
  const app = express();
  const httpServer = createHttpServer(app);
  const originAllowed = (origin, requestHost) => allowedOrigins ? allowedOrigins.includes(origin)
    : !origin || origin === `http://${requestHost}` || origin === `https://${requestHost}`;
  const accountsEnabled = store.enabled && mailer.enabled;
  const auth = accountsEnabled ? createAuth({ store, mailer, now }) : null;
  const leagueStore = accountsEnabled ? new LeagueStore(store.db) : null;
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
  const liveByLeague = new Map();
  function persist(room, finalize = false) {
    if (!store.enabled || room.game.handNumber === 0) return;
    try {
      if (finalize && !room.endedAt) room.endedAt = now();
      const players = [...room.game.players.map(p => ({ ...p, cashOut: p.stack })), ...room.game.departed].map(p => ({
        id: p.id, name: p.name, accountId: room.accounts.get(p.id) ?? null,
        claimHash: room.tokenHashes.get(p.id), buyIn: p.buyIn, cashOut: p.cashOut,
        net: p.cashOut - p.buyIn, handsPlayed: p.handsPlayed, handsWon: p.handsWon,
        ...Object.fromEntries(game.STAT_FIELDS.map(field => [field, p[field] ?? 0]))
      }));
      const snapshot = { nightId: room.nightId, roomCode: room.code, groupId: null,
        leagueId: room.leagueId, seasonId: room.seasonId,
        startedAt: room.startedAt, updatedAt: now(), endedAt: room.endedAt ?? null,
        hands: room.game.handNumber, settings: room.game.settings,
        settlement: game.settlement(room.game), players };
      Promise.resolve().then(async () => {
        await store.saveNight(snapshot);
        if (snapshot.endedAt && room.leagueId) leagueStore.finalizeNight(room.nightId);
      }).catch(logError);
    } catch (error) { logError(error); }
  }
  let pushEnabled = false;
  if (vapid.publicKey && vapid.privateKey && vapid.subject) {
    try { pushTransport.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey); pushEnabled = true; }
    catch (error) { logError(error); }
  }
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json({ accounts: accountsEnabled }));
  app.use('/api', express.json({ limit: '4kb' }));
  const authLimits = new Map();
  function apiOrigin(req, res, next) {
    if (req.get('Sec-Fetch-Site') === 'cross-site' || !originAllowed(req.get('Origin'), req.get('Host'))) {
      res.status(403).json({ error: 'Origin not allowed.' }); return;
    }
    next();
  }
  function requireAccount(req, res, next) {
    if (!accountsEnabled) { res.sendStatus(404); return; }
    auth.accountFromCookie(req.headers.cookie).then(account => {
      if (!account) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
      req.account = account; next();
    }).catch(error => { logError(error); res.sendStatus(503); });
  }
  function allowLinkRequest(req, email) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = trustProxy && typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : req.ip;
    const keys = [`ip:${ip}`, `email:${email}`];
    for (const key of keys) {
      const bucket = authLimits.get(key);
      if (bucket && now() - bucket.start < 3_600_000 && bucket.count >= (key.startsWith('ip:') ? 10 : 3)) return false;
    }
    for (const key of keys) {
      const bucket = authLimits.get(key);
      if (!bucket || now() - bucket.start >= 3_600_000) authLimits.set(key, { start: now(), count: 1 });
      else bucket.count++;
    }
    return true;
  }
  app.use('/api/auth', (req, res, next) => { if (!accountsEnabled) res.sendStatus(404); else next(); });
  app.post('/api/auth/request', apiOrigin, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (email && allowLinkRequest(req, email)) {
      try {
        const origin = req.get('Origin') || `${req.protocol}://${req.get('Host')}`;
        await auth.request(email, origin);
      } catch (error) { logError(error); }
    }
    res.json({ message: 'If that address can receive mail, a sign-in link is on its way.' });
  });
  app.post('/api/auth/verify', apiOrigin, async (req, res) => {
    const verified = await auth.verify(req.body?.token);
    if (!verified) { res.status(400).json({ error: 'This link has expired or was already used.' }); return; }
    res.setHeader('Set-Cookie', `tm_session=${verified.sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ displayName: verified.account.display_name });
  });
  app.post('/api/auth/logout', apiOrigin, async (req, res) => {
    await auth.logout(req.headers.cookie);
    res.setHeader('Set-Cookie', 'tm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/me', requireAccount, (req, res) => res.json({ displayName: req.account.display_name, email: req.account.email }));
  app.patch('/api/me', apiOrigin, requireAccount, async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !validName(req.body.displayName)) {
      res.status(400).json({ error: 'Display name must be 1–20 safe characters.' }); return;
    }
    const account = await store.updateAccount(req.account.id, normalizedName(req.body.displayName));
    res.json({ displayName: account.display_name });
  });
  const settingsLimits = new Map();
  app.get('/api/me/settings', requireAccount, async (req, res) => res.json({ settings: await store.getSettings(req.account.id) }));
  for (const method of ['put', 'patch']) app[method]('/api/me/settings', apiOrigin, requireAccount, async (req, res) => {
    const key = req.account.id;
    const bucket = settingsLimits.get(key);
    if (bucket && now() - bucket.start < 60_000 && bucket.count >= 60) { res.status(429).json({ error: 'Too many settings updates.' }); return; }
    const previous = method === 'patch' ? await store.getSettings(key) : null;
    const candidate = previous ? { ...previous, ...req.body } : req.body;
    if (!validatePrefs(candidate)) { res.status(400).json({ error: 'Invalid personal settings.' }); return; }
    if (!bucket || now() - bucket.start >= 60_000) settingsLimits.set(key, { start: now(), count: 1 });
    else bucket.count++;
    const settings = await store.saveSettings(key, normalizePrefs(candidate), now());
    res.json({ settings });
  });
  app.get('/api/me/presets', requireAccount, async (req, res) => res.json({ presets: await store.listPresets(req.account.id) }));
  app.post('/api/me/presets', apiOrigin, requireAccount, async (req, res) => {
    if (!validPreset(req.body)) { res.status(400).json({ error: 'Invalid table preset.' }); return; }
    const preset = await store.createPreset(req.account.id, randomUUID(), normalizePreset(req.body), now());
    if (!preset) { res.status(409).json({ error: `You can save up to ${MAX_PRESETS} presets.` }); return; }
    res.status(201).json({ preset });
  });
  app.patch('/api/me/presets/:id', apiOrigin, requireAccount, async (req, res) => {
    if (!req.body || Object.keys(req.body).length === 0 || Object.keys(req.body).some(key => !['preset', 'position'].includes(key))
      || (req.body.preset !== undefined && !validPreset(req.body.preset))
      || (req.body.position !== undefined && (!Number.isSafeInteger(req.body.position) || req.body.position < 0 || req.body.position >= MAX_PRESETS))) {
      res.status(400).json({ error: 'Invalid table preset update.' }); return;
    }
    const preset = await store.updatePreset(req.account.id, req.params.id, req.body.preset ? normalizePreset(req.body.preset) : null, req.body.position);
    if (!preset) { res.sendStatus(404); return; }
    res.json({ preset });
  });
  app.delete('/api/me/presets/:id', apiOrigin, requireAccount, async (req, res) => {
    if (!await store.deletePreset(req.account.id, req.params.id)) { res.sendStatus(404); return; }
    res.json({ ok: true });
  });
  app.post('/api/nights/claim', apiOrigin, requireAccount, async (req, res) => {
    const claims = req.body?.claims;
    if (!Array.isArray(claims) || claims.length > 20 || claims.some(claim =>
      !claim || Object.keys(claim).length !== 2 || typeof claim.nightId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(claim.nightId) || typeof claim.token !== 'string' || !/^[a-f0-9]{64}$/.test(claim.token))) {
      res.status(400).json({ error: 'Invalid night claims.' }); return;
    }
    let claimed = 0;
    for (const claim of claims) claimed += await store.claimNight(claim.nightId, hashToken(claim.token), req.account.id);
    res.json({ claimed, skipped: claims.length - claimed });
  });
  app.get('/api/me/stats', requireAccount, async (req, res) => {
    const rows = await store.listAccountNights(req.account.id);
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1) { res.status(400).json({ error: 'Invalid page.' }); return; }
    let running = 0;
    const trend = [...rows].reverse().map(row => ({ endedAt: row.ended_at, net: (running += row.net) }));
    res.json({ lifetime: aggregateStats(rows), trend, ...paginateNights(rows, page) });
  });
  app.get('/api/me/export', requireAccount, async (req, res) => {
    res.json(await store.exportAccount(req.account.id));
  });
  app.delete('/api/me', apiOrigin, requireAccount, async (req, res) => {
    if (req.body?.confirm !== 'DELETE' || Object.keys(req.body).length !== 1) {
      res.status(400).json({ error: 'Confirm account deletion with DELETE.' }); return;
    }
    await store.deleteAccount(req.account.id);
    for (const room of rooms.values()) {
      for (const [playerId, accountId] of room.accounts) if (accountId === req.account.id) room.accounts.delete(playerId);
    }
    res.setHeader('Set-Cookie', 'tm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ deleted: true });
  });
  const leagueIdValid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
  const newInvite = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const publicLeague = league => ({ id: league.id, name: league.name, inviteCode: league.invite_code,
    tableSettings: JSON.parse(league.table_settings_json), members: leagueStore.roster(league.id) });
  function requireLeague(req, res, next) {
    if (!leagueIdValid(req.params.id)) { res.sendStatus(404); return; }
    const league = leagueStore.get(req.params.id);
    const member = league && leagueStore.member(league.id, req.account.id);
    if (!member) { res.sendStatus(404); return; }
    req.league = league; req.leagueMember = member; next();
  }
  const role = (...roles) => (req, res, next) => {
    if (!roles.includes(req.leagueMember.role)) { res.status(403).json({ error: 'League role cannot do that.' }); return; }
    next();
  };
  function tableSettings(input) {
    const allowed = ['startingStack', 'smallBlind', 'bigBlind', 'blindMinutes', 'centsPer1000Chips'];
    requireValue(input && typeof input === 'object' && !Array.isArray(input) &&
      Object.keys(input).every(key => allowed.includes(key)), 'Invalid table settings.');
    return game.createTable(input).settings;
  }
  app.use('/api/leagues', requireAccount);
  app.post('/api/leagues', apiOrigin, (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !validName(req.body.name)) {
      res.status(400).json({ error: 'Invalid league name.' }); return;
    }
    let inviteCode;
    do { inviteCode = newInvite(); } while (leagueStore.byInvite(inviteCode));
    const league = leagueStore.create({ id: randomUUID(), name: normalizedName(req.body.name), inviteCode,
      settings: game.createTable().settings, account: req.account, memberId: randomUUID(), time: now() });
    res.status(201).json(publicLeague(league));
  });
  app.get('/api/leagues', (req, res) => res.json({ leagues: leagueStore.mine(req.account.id) }));
  app.post('/api/leagues/join', apiOrigin, (req, res) => {
    const code = typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.toUpperCase() : null;
    if (!code || !/^[A-HJ-NP-Z]{8}$/.test(code) || Object.keys(req.body).length !== 1) {
      res.status(400).json({ error: 'Invalid invite code.' }); return;
    }
    const league = leagueStore.byInvite(code);
    if (!league) { res.sendStatus(404); return; }
    leagueStore.join(league.id, req.account, randomUUID(), now());
    res.json(publicLeague(league));
  });
  app.get('/api/leagues/:id', requireLeague, (req, res) => res.json({ ...publicLeague(req.league), myRole: req.leagueMember.role }));
  app.patch('/api/leagues/:id', apiOrigin, requireLeague, role('commissioner'), (req, res) => {
    const body = req.body || {};
    if (Object.keys(body).some(key => !['name', 'tableSettings'].includes(key)) ||
      (body.name !== undefined && !validName(body.name))) { res.status(400).json({ error: 'Invalid league update.' }); return; }
    const settings = body.tableSettings === undefined ? JSON.parse(req.league.table_settings_json) : tableSettings(body.tableSettings);
    res.json(publicLeague(leagueStore.update(req.league.id, body.name ? normalizedName(body.name) : req.league.name, settings)));
  });
  app.post('/api/leagues/:id/leave', apiOrigin, requireLeague, (req, res) => {
    leagueStore.leave(req.leagueMember, now()); res.json({ left: true });
  });
  app.post('/api/leagues/:id/invite/rotate', apiOrigin, requireLeague, role('commissioner', 'co'), (req, res) => {
    let code; do { code = newInvite(); } while (leagueStore.byInvite(code));
    leagueStore.rotate(req.league.id, code); res.json({ inviteCode: code });
  });
  app.patch('/api/leagues/:id/members/:memberId', apiOrigin, requireLeague, role('commissioner'), (req, res) => {
    if (!['co', 'member'].includes(req.body?.role) || Object.keys(req.body).length !== 1) { res.status(400).json({ error: 'Invalid role.' }); return; }
    leagueStore.setRole(req.league.id, req.params.memberId, req.body.role); res.json({ members: leagueStore.roster(req.league.id) });
  });
  app.delete('/api/leagues/:id/members/:memberId', apiOrigin, requireLeague, role('commissioner', 'co'), (req, res) => {
    leagueStore.remove(req.league.id, req.params.memberId, now()); res.json({ members: leagueStore.roster(req.league.id) });
  });
  app.post('/api/leagues/:id/transfer', apiOrigin, requireLeague, role('commissioner'), (req, res) => {
    requireValue(leagueIdValid(req.body?.memberId) && Object.keys(req.body).length === 1, 'Invalid member.');
    leagueStore.transfer(req.league.id, req.leagueMember.id, req.body?.memberId); res.json({ members: leagueStore.roster(req.league.id) });
  });
  app.get('/api/leagues/:id/live', requireLeague, (req, res) => res.json({ roomCode: liveByLeague.get(req.league.id) ?? null }));
  app.get('/api/leagues/:id/seasons', requireLeague, (req, res) => res.json({ seasons: leagueStore.seasons(req.league.id).map(season => ({
    id: season.id, name: season.name, status: season.status, startsAt: season.starts_at, endsAt: season.ends_at,
    scoring: JSON.parse(season.scoring_json), championMemberId: season.champion_member_id })) }));
  app.post('/api/leagues/:id/seasons', apiOrigin, requireLeague, role('commissioner'), (req, res) => {
    if (!validName(req.body?.name) || Object.keys(req.body).some(key => !['name', 'scoring'].includes(key))) {
      res.status(400).json({ error: 'Invalid season.' }); return;
    }
    const scoring = validateScoring(req.body.scoring);
    const season = leagueStore.createSeason(req.league.id, randomUUID(), normalizedName(req.body.name), scoring, now());
    res.status(201).json({ id: season.id, status: season.status, scoring });
  });
  app.patch('/api/leagues/:id/seasons/:sid', apiOrigin, requireLeague, role('commissioner'), (req, res) => {
    const prior = leagueStore.season(req.league.id, req.params.sid);
    if (!prior) { res.sendStatus(404); return; }
    if (Object.keys(req.body || {}).some(key => !['name', 'scoring'].includes(key)) ||
      (req.body?.name !== undefined && !validName(req.body.name))) { res.status(400).json({ error: 'Invalid season update.' }); return; }
    const scoring = req.body?.scoring ? validateScoring(req.body.scoring) : JSON.parse(prior.scoring_json);
    const season = leagueStore.updateSeason(req.league.id, prior.id, req.body?.name ? normalizedName(req.body.name) : prior.name, scoring);
    res.json({ id: season.id, status: season.status, scoring });
  });
  app.post('/api/leagues/:id/seasons/:sid/activate', apiOrigin, requireLeague, role('commissioner'), (req, res) => {
    const season = leagueStore.activateSeason(req.league.id, req.params.sid, now()); res.json({ id: season.id, status: season.status });
  });
  app.post('/api/leagues/:id/seasons/:sid/close', apiOrigin, requireLeague, role('commissioner'), (req, res) => {
    const season = leagueStore.season(req.league.id, req.params.sid);
    if (!season) { res.sendStatus(404); return; }
    const standings = computeStandings({ scoring: JSON.parse(season.scoring_json) }, leagueStore.results(req.league.id, season.id), leagueStore.roster(req.league.id));
    const champion = standings.find(row => row.qualified && row.nights > 0);
    const closed = leagueStore.closeSeason(req.league.id, season.id, champion?.memberId ?? null, now());
    res.json({ id: closed.id, status: closed.status, championMemberId: closed.champion_member_id });
  });
  app.get('/api/leagues/:id/seasons/:sid/standings', requireLeague, (req, res) => {
    const season = leagueStore.season(req.league.id, req.params.sid);
    if (!season) { res.sendStatus(404); return; }
    res.json({ season: { id: season.id, name: season.name, status: season.status,
      scoring: JSON.parse(season.scoring_json), championMemberId: season.champion_member_id },
    standings: computeStandings({ scoring: JSON.parse(season.scoring_json) }, leagueStore.results(req.league.id, season.id), leagueStore.roster(req.league.id)) });
  });
  app.get('/api/leagues/:id/nights', requireLeague, (req, res) => res.json({ nights: leagueStore.nights(req.league.id, req.query.season || null) }));
  app.get('/api/leagues/:id/audit', requireLeague, (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ entries: leagueStore.audit(req.league.id, 50, (page - 1) * 50), page });
  });
  app.get('/api/leagues/:id/records', requireLeague, (req, res) => res.json(recordsFromResults(leagueStore.results(req.league.id), leagueStore.roster(req.league.id))));
  for (const action of ['void', 'restore']) app.post(`/api/leagues/:id/nights/:nightId/${action}`, apiOrigin, requireLeague, role('commissioner', 'co'), (req, res) => {
    const reason = req.body?.reason;
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 200 || /[<>\p{Cc}\p{Cf}]/u.test(reason) || Object.keys(req.body).length !== 1) {
      res.status(400).json({ error: 'A reason of 3–200 safe characters is required.' }); return;
    }
    leagueStore.reviewNight(req.league.id, req.params.nightId, action === 'restore', req.leagueMember.id, reason.trim(), now(), randomUUID());
    res.json({ counts: action === 'restore' });
  });
  app.use((error, _req, res, _next) => {
    if (error instanceof RequestError) { res.status(400).json({ error: error.message }); return; }
    logError(error); res.status(500).json({ error: 'Something went wrong.' });
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  function view(room, id) {
    const state = structuredClone(room.game);
    delete state.history;
    const handInProgress = game.isPlaying(room.game);
    return { ...state, roomCode: room.code, nightId: room.nightId, hostId: room.hostId, playerId: id, revision: room.revision,
      signedIn: room.accounts.has(id),
      cosmetics: Object.fromEntries(room.cosmetics),
      canUndo: room.game.history.length > 0, serverTime: now(),
      settlement: structuredClone(room.lastSettlement || game.settlement(room.game)),
      settlementNote: handInProgress ? 'Hand in progress. Showing totals from before this hand.' : '',
      push: { enabled: pushEnabled, publicKey: pushEnabled ? vapid.publicKey : '', subscribed: room.pushSubscriptions.has(id) },
      rebuyRequests: [...room.rebuyRequests].filter(([playerId]) => room.hostId === id || playerId === id).map(([playerId, request]) => ({
        id: playerId, name: room.game.players.find(player => player.id === playerId)?.name || 'Player', amount: request.amount, at: request.at
      })),
      players: state.players.map(p => ({ ...p, connected: room.connections.has(p.id) })),
      // Side pots are finalized once, when the hand reaches showdown. Do not
      // expose recalculated layers after every street; that makes one hand look
      // like it is creating new pots each round.
      pots: state.street === 'showdown' || state.street === 'complete' ? state.pots : [],
      legal: game.legalActions(room.game, id) };
  }
  function broadcast(room) {
    room.game.log.forEach(item => { if (item.timestamp === undefined) item.timestamp = now(); });
    if (!game.isPlaying(room.game)) room.lastSettlement = game.settlement(room.game);
    for (const [id, socketId] of room.connections) io.sockets.sockets.get(socketId)?.emit('state', view(room, id));
  }
  function sendTurnPush(room, previousTurn) {
    const playerId = room.game.turn;
    if (!pushEnabled || !playerId || playerId === previousTurn) return;
    const subscription = room.pushSubscriptions.get(playerId);
    if (!subscription || (room.connections.has(playerId) && room.presence.get(playerId) !== true)) return;
    const payload = JSON.stringify({ body: `Your turn at table ${room.code}`, tag: `tablemate-${room.code}` });
    Promise.resolve().then(() => pushTransport.sendNotification(subscription, payload, { TTL: 60, urgency: 'high' })).catch(error => {
      if (error.statusCode === 404 || error.statusCode === 410) {
        if (room.pushSubscriptions.get(playerId) === subscription) room.pushSubscriptions.delete(playerId);
      } else logError(error);
    });
  }
  function bind(socket, room, id) {
    if (socket.data.accountId && !room.accounts.has(id) && ![...room.accounts.values()].includes(socket.data.accountId)) {
      room.accounts.set(id, socket.data.accountId);
    }
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
    room.presence.set(id, false);
    socket.data.identity = { code: room.code, id };
    room.lastActive = now();
  }
  function seedCosmetics(socket, room, id) {
    const preferred = socket.data.accountId ? socket.data.prefs || DEFAULT_PREFS : null;
    const taken = new Set([...room.cosmetics.values()].map(value => value.color));
    const start = preferred ? PREF_ENUMS.seatColor.indexOf(preferred.defaultSeatColor) : (room.game.players.length - 1) % PREF_ENUMS.seatColor.length;
    const color = [...PREF_ENUMS.seatColor.slice(start), ...PREF_ENUMS.seatColor.slice(0, start)].find(candidate => !taken.has(candidate));
    requireValue(color, 'Every seat color is taken.');
    const avatar = preferred?.defaultAvatar || PREF_ENUMS.avatar[(room.game.players.length - 1) % PREF_ENUMS.avatar.length];
    room.cosmetics.set(id, { avatar, color, note: preferred?.note || '' });
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
    room.rebuyRequests.delete(id);
    room.cosmetics.delete(id);
    room.pushSubscriptions.delete(id);
    room.presence.delete(id);
  }
  function sweep() {
    for (const [key, bucket] of attempts) if (now() - bucket.start >= 60_000) attempts.delete(key);
    for (const [code, room] of rooms) {
      if (now() - room.lastActive >= idleMs) {
        persist(room, true);
        for (const id of [...room.connections.keys()]) detach(room, id, 'Room expired after six hours of inactivity.');
        if (room.leagueId) liveByLeague.delete(room.leagueId);
        rooms.delete(code);
      }
    }
  }
  const cleanup = setInterval(sweep, cleanupIntervalMs);
  cleanup.unref();

  io.use(async (socket, next) => {
    if (accountsEnabled) {
      try {
        socket.data.accountId = (await auth.accountFromCookie(socket.handshake.headers.cookie))?.id ?? null;
        if (socket.data.accountId) socket.data.prefs = await store.getSettings(socket.data.accountId);
      }
      catch (error) { logError(error); socket.data.accountId = null; }
    }
    next();
  });

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
      let league = null;
      let leagueSettings = null;
      if (payload.leagueId) {
        requireValue(accountsEnabled && socket.data.accountId, 'Sign in to start a league table.');
        league = leagueStore.get(payload.leagueId);
        requireValue(league && ['commissioner', 'co'].includes(leagueStore.member(league.id, socket.data.accountId)?.role), 'Only league commissioners and co-commissioners can start a league table.');
        const existingCode = liveByLeague.get(league.id);
        if (existingCode && rooms.has(existingCode)) return { roomCode: existingCode, existing: true };
        leagueSettings = JSON.parse(league.table_settings_json);
      }
      const id = randomUUID();
      const state = game.addPlayer(game.createTable(leagueSettings || payload.settings), id, payload.name);
      let code;
      do { code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (rooms.has(code));
      const token = randomBytes(32).toString('hex');
      const room = { code, nightId: randomUUID(), startedAt: now(), endedAt: null, hostId: id, game: state,
        leagueId: league?.id ?? null, seasonId: league ? leagueStore.activeSeason(league.id)?.id ?? null : null,
        tokens: new Map([[id, token]]), tokenHashes: new Map([[id, hashToken(token)]]), accounts: new Map(),
        connections: new Map(), rebuyRequests: new Map(), cosmetics: new Map(), pushSubscriptions: new Map(), presence: new Map(),
        lastActive: now(), revision: 0, lastSettlement: null };
      rooms.set(code, room); if (league) liveByLeague.set(league.id, code);
      seedCosmetics(socket, room, id); bind(socket, room, id); broadcast(room);
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
      room.tokens.set(id, token); room.tokenHashes.set(id, hashToken(token)); room.revision++;
      seedCosmetics(socket, room, id); bind(socket, room, id); broadcast(room);
      return { token, playerId: id, roomCode: room.code, state: view(room, id) };
    });
    on('rejoin', payload => {
      requireValue(!socket.data.identity, 'Already seated on this connection.');
      const room = rooms.get(payload.code.toUpperCase());
      requireValue(room, 'Room no longer exists. Create a new table.');
      requireValue(safeTokenEqual(room.tokens.get(payload.playerId), payload.token), 'Seat token is invalid.');
      if (!room.cosmetics.has(payload.playerId)) seedCosmetics(socket, room, payload.playerId);
      bind(socket, room, payload.playerId); broadcast(room);
      return { playerId: payload.playerId, roomCode: room.code, state: view(room, payload.playerId) };
    });
    function mutate(event, fn, hostOnly = false) {
      on(event, payload => {
        const { room, id } = member(socket, payload);
        if (hostOnly) host(room, id);
        requireValue(payload.revision === room.revision, 'Table changed. Please try again.');
        const previousTurn = room.game.turn;
        const nextState = fn(room, id, payload);
        room.game = nextState; room.revision++; room.lastActive = now();
        if (nextState.street === 'complete' && !game.isPlaying(nextState)) persist(room);
        broadcast(room);
        sendTurnPush(room, previousTurn);
        return { state: view(room, id) };
      });
    }
    mutate('start-hand', room => game.startHand(room.game, now()), true);
    mutate('action', (room, id, payload) => game.act(room.game, id, { type: payload.type, amount: payload.amount }));
    mutate('showdown-pick', (room, _id, payload) => game.pickWinners(room.game, payload.potId, payload.winnerIds), true);
    mutate('host-settings', (room, _id, payload) => game.configure(room.game, payload.settings), true);
    mutate('host:reorderSeats', (room, _id, payload) => game.reorderSeats(room.game, payload.order), true);
    on('seat:cosmetics', payload => {
      const { room, id } = member(socket, payload);
      requireValue(Object.keys(payload).some(key => ['avatar', 'color', 'note'].includes(key)), 'Choose a seat style first.');
      const next = { ...room.cosmetics.get(id), ...Object.fromEntries(['avatar', 'color', 'note'].filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]])) };
      requireValue(![...room.cosmetics].some(([otherId, value]) => otherId !== id && value.color === next.color), 'That seat color is already in use.');
      room.cosmetics.set(id, next); room.lastActive = now(); broadcast(room);
      return { state: view(room, id) };
    });
    on('host:endNight', payload => {
      const { room, id } = member(socket, payload); host(room, id);
      requireValue(payload.revision === undefined || payload.revision === room.revision, 'Table changed. Please try again.');
      requireValue(!game.isPlaying(room.game) && room.game.handNumber > 0, 'Finish a hand before ending the night.');
      persist(room, true);
      return {};
    });
    mutate('undo', room => game.undo(room.game), true);
    mutate('sit-out', (room, id, payload) => game.setSitOut(room.game, id, payload.value));
    mutate('donate', (room, id, payload) => game.donate(room.game, id, payload.recipientId, payload.amount));
    mutate('rebuy', (room, _id, payload) => game.rebuy(room.game, payload.playerId, payload.amount, { source: 'host', timestamp: now() }), true);
    on('push:subscribe', payload => {
      const { room, id } = member(socket, payload);
      requireValue(pushEnabled, 'Turn notifications are not configured on this server.');
      room.pushSubscriptions.set(id, payload.subscription); room.lastActive = now();
      return {};
    });
    on('push:unsubscribe', payload => {
      const { room, id } = member(socket, payload);
      room.pushSubscriptions.delete(id); room.lastActive = now();
      return {};
    });
    on('presence', payload => {
      const { room, id } = member(socket, payload);
      room.presence.set(id, payload.hidden); room.lastActive = now();
      return {};
    });
    on('rebuy:request', payload => {
      const { room, id } = member(socket, payload);
      requireValue(!room.rebuyRequests.has(id), 'You already have a pending rebuy request.');
      const amount = payload.amount ?? room.game.settings.startingStack;
      room.rebuyRequests.set(id, { amount, at: now() }); room.lastActive = now();
      broadcast(room);
      return {};
    });
    on('rebuy:cancel', payload => {
      const { room, id } = member(socket, payload);
      requireValue(room.rebuyRequests.has(id), 'There is no pending rebuy request to cancel.');
      room.rebuyRequests.delete(id); room.lastActive = now(); broadcast(room);
      return {};
    });
    on('rebuy:deny', payload => {
      const { room, id } = member(socket, payload); host(room, id);
      const request = room.rebuyRequests.get(payload.playerId);
      requireValue(request, 'That rebuy request is no longer pending.');
      room.rebuyRequests.delete(payload.playerId); room.lastActive = now();
      const target = io.sockets.sockets.get(room.connections.get(payload.playerId));
      target?.emit('rebuy-result', { type: 'denied' });
      broadcast(room);
      return {};
    });
    mutate('rebuy:approve', (room, _id, payload) => {
      const requested = room.rebuyRequests.get(payload.playerId);
      requireValue(requested, 'That rebuy request is no longer pending.');
      const amount = payload.amount ?? requested.amount;
      const nextState = game.rebuy(room.game, payload.playerId, amount, { source: 'request', timestamp: now() });
      room.rebuyRequests.delete(payload.playerId); room.lastActive = now();
      const target = io.sockets.sockets.get(room.connections.get(payload.playerId));
      target?.emit('rebuy-result', { type: 'approved', amount });
      return nextState;
    }, true);
    mutate('host-fold', room => {
      requireValue(room.game.turn && !room.connections.has(room.game.turn), 'Only the disconnected current player can be folded by the host.');
      return game.act(room.game, room.game.turn, { type: 'fold' });
    }, true);
    on('leave', payload => {
      const { room, id } = member(socket, payload);
      requireValue(payload.revision === room.revision, 'Table changed. Please try again.');
      room.game = game.removePlayer(room.game, id);
      detach(room, id, 'You left the table.'); room.revision++; room.lastActive = now();
      if (!room.game.players.length) { persist(room, true); if (room.leagueId) liveByLeague.delete(room.leagueId); rooms.delete(room.code); }
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
    close: () => new Promise(resolve => { clearInterval(cleanup); io.close(async () => { await store.close?.(); resolve(); }); }) };
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
