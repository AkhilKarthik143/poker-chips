import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { OAuth2Client } from 'google-auth-library';
const webPush = createRequire(import.meta.url)('web-push');
import * as game from './game.js';
import { RequestError, requireValue, validatePayload, entryEvents, normalizedName, validName } from './validation.js';
import { createStore } from './store/index.js';
import { createMailer } from './mail.js';
import { createAuth, normalizeEmail, parseSessionCookie } from './auth.js';
import { aggregateStats, paginateNights } from './stats.js';
import { LeagueStore } from './league-store.js';
import { validateScoring, computeStandings, recordsFromResults } from './league.js';
import { DEFAULT_PREFS, PREF_ENUMS, normalizePrefs, validatePrefs } from './prefs-schema.js';
import { MAX_PRESETS, normalizePreset, validPreset } from './preset-schema.js';
import { normalizeRebuyPolicy, validRebuyPolicy } from './rebuy-policy.js';
import { THIRTY_DAYS, usernameError, validAvatar, validPrivacy, avatarForAccount, privacyForAccount, defaultAvatarV2 } from './identity.js';
import { AVATAR_PHOTO_MIME, MAX_AVATAR_PHOTO_BYTES, processAvatarPhoto } from './avatar-photo.js';
import { hasUnityBuild, unityStatic } from './static-unity.js';
import { FriendError, FriendsStore } from './friends-store.js';
import { safeInviteReturn, validFriendShareId, validLeagueInvite } from './invites.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const safeTokenEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hashToken = value => createHash('sha256').update(value).digest('hex');

export function createServer({ now = Date.now, idleMs = SIX_HOURS, cleanupIntervalMs = 60_000, allowedOrigins = process.env.NODE_ENV === 'production' ? [process.env.RENDER_EXTERNAL_URL || 'https://poker-chips-o7n9.onrender.com'] : null, trustProxy = process.env.RENDER === 'true', devLogin = process.env.TABLEMATE_DEV_LOGIN === '1', previewMode = false, googleClientId = process.env.GOOGLE_CLIENT_ID, verifyGoogleIdToken = null, logError = error => process.stderr.write(`${error.stack}\n`), pushTransport = webPush, vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT }, store = createStore(), mailer = createMailer(), avatarCreatorRoot = fileURLToPath(new URL('../public/avatar-creator/', import.meta.url)) } = {}) {
  const app = express();
  const httpServer = createHttpServer(app);
  const originAllowed = (origin, requestHost) => allowedOrigins ? allowedOrigins.includes(origin)
    : !origin || origin === `http://${requestHost}` || origin === `https://${requestHost}`;
  const emailEnabled = store.enabled && mailer.enabled;
  const googleEnabled = store.enabled && typeof googleClientId === 'string' && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(googleClientId);
  const accountsEnabled = emailEnabled || googleEnabled;
  const avatarCreator = accountsEnabled && hasUnityBuild(avatarCreatorRoot);
  const auth = accountsEnabled ? createAuth({ store, mailer, now }) : null;
  const activeSession = accountsEnabled ? store.db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND account_id = ? AND expires_at > ?') : null;
  const googleClient = googleEnabled && !verifyGoogleIdToken ? new OAuth2Client(googleClientId) : null;
  const leagueStore = accountsEnabled ? new LeagueStore(store.db) : null;
  const friendsStore = accountsEnabled ? new FriendsStore(store.db) : null;
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
  const signedInSeat = async (room, id, socket) => {
    const accountId = room.accounts.get(id);
    return Boolean(accountId && socket?.data.accountId === accountId && socket.data.sessionHash &&
      await activeSession.get(socket.data.sessionHash, accountId, now()));
  };
  async function roomAccess(room, id, socket, signedIn = null) {
    if (!room.leagueId) {
      const host = room.hostId === id;
      return { manage: host, owner: host };
    }
    const accountId = room.accounts.get(id);
    if (!(signedIn ?? await signedInSeat(room, id, socket)) || !await leagueStore.get(room.leagueId)) {
      return { manage: false, owner: false };
    }
    const role = (await leagueStore.member(room.leagueId, accountId))?.role;
    return { manage: role === 'commissioner' || role === 'co', owner: role === 'commissioner' };
  }
  async function requireRoomAccess(room, id, socket, permission) {
    requireValue((await roomAccess(room, id, socket))[permission], permission === 'owner'
      ? 'Only the league commissioner or table host can do that.'
      : 'Only the table host or a league commissioner or co-commissioner can do that.');
  }
  async function broadcastLeague(leagueId) {
    const room = rooms.get(liveByLeague.get(leagueId));
    if (room) await broadcast(room);
  }
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
      const pending = (room.persistChain || Promise.resolve()).then(async () => {
        await store.saveNight(snapshot);
        if (snapshot.endedAt && room.leagueId) await leagueStore.finalizeNight(room.nightId);
        return true;
      }).catch(error => { logError(error); return false; });
      room.persistChain = pending;
      return pending;
    } catch (error) { logError(error); return Promise.resolve(false); }
  }
  let pushEnabled = false;
  if (vapid.publicKey && vapid.privateKey && vapid.subject) {
    try { pushTransport.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey); pushEnabled = true; }
    catch (error) { logError(error); }
  }
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    const googleSources = googleEnabled && _req.path === '/login.html';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Send only the site origin to Google Identity Services, as Google recommends.
    res.setHeader('Referrer-Policy', _req.path === '/invite.html' ? 'no-referrer'
      : googleSources ? 'strict-origin-when-cross-origin' : 'same-origin');
    if (_req.path === '/invite.html' || _req.path.startsWith('/api/invites/')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'no-store');
    }
    // Google Identity Services injects button styles; keep its CSP allowance on the sign-in page only.
    res.setHeader('Content-Security-Policy', googleSources
      ? "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
      : "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/api/config', async (_req, res) => {
    try {
      if (accountsEnabled) await store.ping();
      res.json({ accounts: accountsEnabled, email: emailEnabled && !previewMode,
        ...(previewMode ? { preview: true } : {}),
        googleClientId: googleEnabled ? googleClientId : null, avatarCreator });
    } catch (error) {
      logError(error);
      res.status(503).json({ accounts: false, email: false, googleClientId: null, avatarCreator: false });
    }
  });
  app.use('/api', express.json({ limit: '4kb' }));
  const authLimits = new Map();
  function apiOrigin(req, res, next) {
    // Browsers omit Origin on same-origin GETs. Fetch metadata identifies those
    // reads without relaxing the Origin requirement for writes.
    const host = req.get('Host');
    const implicitOrigin = req.method === 'GET' && req.get('Sec-Fetch-Site') === 'same-origin'
      ? allowedOrigins?.find(origin => origin === `https://${host}` || origin === `http://${host}`) : undefined;
    if (req.get('Sec-Fetch-Site') === 'cross-site' || !originAllowed(req.get('Origin') || implicitOrigin, host)) {
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
  function optionalAccount(req, res, next) {
    if (!accountsEnabled) { res.status(503).json({ error: 'Accounts are unavailable.' }); return; }
    auth.accountFromCookie(req.headers.cookie).then(account => { req.account = account; next(); })
      .catch(error => { logError(error); res.status(503).json({ error: 'Accounts are unavailable.' }); });
  }
  const publicOrigin = allowedOrigins?.[0] || process.env.TABLEMATE_PUBLIC_ORIGIN || null;
  const shareUrl = path => ({ path, url: publicOrigin ? new URL(path, publicOrigin).href : null });
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
    if (!emailEnabled || previewMode) { res.sendStatus(404); return; }
    const email = normalizeEmail(req.body?.email);
    let devLink;
    if (email && allowLinkRequest(req, email)) {
      try {
        const origin = allowedOrigins?.[0] || process.env.TABLEMATE_PUBLIC_ORIGIN || req.get('Origin') || `${req.protocol}://${req.get('Host')}`;
        const link = await auth.request(email, origin, safeInviteReturn(req.body?.returnTo));
        if (devLogin && process.env.NODE_ENV !== 'production' && mailer.local === true &&
          ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) devLink = link;
      } catch (error) { logError(error); }
    }
    res.json({ message: 'If that address can receive mail, a sign-in link is on its way.', ...(devLink ? { devLink } : {}) });
  });
  app.post('/api/auth/verify', apiOrigin, async (req, res) => {
    if (!emailEnabled || previewMode) { res.sendStatus(404); return; }
    const verified = await auth.verify(req.body?.token);
    if (!verified) { res.status(400).json({ error: 'This link has expired or was already used.' }); return; }
    res.setHeader('Set-Cookie', `tm_session=${verified.sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ displayName: verified.account.display_name, onboarding: verified.isNew });
  });
  app.post('/api/auth/google', apiOrigin, async (req, res) => {
    if (!googleEnabled) { res.sendStatus(404); return; }
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || credential.length > 3500 || credential.split('.').length !== 3) {
      res.status(400).json({ error: 'Invalid Google credential.' }); return;
    }
    try {
      const payload = verifyGoogleIdToken ? await verifyGoogleIdToken(credential, googleClientId)
        : (await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId })).getPayload();
      const existed = await store.getAccountByEmail(normalizeEmail(payload?.email));
      const verified = await auth.google(payload);
      if (verified?.needsEmail) { res.status(409).json({ error: emailEnabled
        ? 'Use the email link to access the existing account for this address.'
        : 'This address belongs to another account. Use its existing sign-in method.' }); return; }
      if (!verified) { res.status(401).json({ error: 'Google did not verify this account.' }); return; }
      res.setHeader('Set-Cookie', `tm_session=${verified.sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      res.json({ displayName: verified.account.display_name, onboarding: !existed });
    } catch (error) {
      logError(error);
      res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
    }
  });
  app.post('/api/auth/logout', apiOrigin, async (req, res) => {
    const token = parseSessionCookie(req.headers.cookie);
    const sessionHash = token ? hashToken(token) : null;
    await auth.logout(req.headers.cookie);
    if (sessionHash) {
      for (const room of rooms.values()) {
        let changed = false;
        for (const [playerId, socketId] of room.connections) if (io.sockets.sockets.get(socketId)?.data.sessionHash === sessionHash) {
          room.identities.delete(playerId); changed = true;
        }
        if (changed) (await broadcast(room));
      }
    }
    res.setHeader('Set-Cookie', 'tm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  const selfProfile = account => ({ displayName: account.display_name, email: account.email,
    username: account.username, avatar: avatarForAccount(account), privacy: privacyForAccount(account),
    usernameChangeAvailableAt: account.username_changed_at === null ? null : account.username_changed_at + THIRTY_DAYS });
  const tableIdentity = account => {
    const privacy = privacyForAccount(account);
    return { ...(privacy.showAvatarAtTables ? { avatar: avatarForAccount(account) } : {}),
      ...(privacy.showUsernameAtTables && account.username ? { username: account.username } : {}) };
  };
  const syncSeatIdentity = async (accountId, account) => {
    for (const room of rooms.values()) {
      let changed = false;
      for (const [playerId, seatedAccountId] of room.accounts) if (seatedAccountId === accountId) {
        const socket = io.sockets.sockets.get(room.connections.get(playerId));
        if ((await signedInSeat(room, playerId, socket))) room.identities.set(playerId, tableIdentity(account));
        else room.identities.delete(playerId);
        changed = true;
      }
      if (changed) (await broadcast(room));
    }
  };
  app.get('/api/me', requireAccount, (req, res) => res.json(selfProfile(req.account)));
  const friendSearchLimits = new Map();
  const friendSendLimits = new Map();
  function friendLimit(map, req, max) {
    const key = hashToken(parseSessionCookie(req.headers.cookie));
    const bucket = map.get(key);
    if (!bucket || now() - bucket.start >= 60_000) { map.set(key, { start: now(), count: 1 }); return true; }
    bucket.count++;
    return bucket.count <= max;
  }
  const friendFailure = (res, error) => {
    if (error instanceof FriendError) res.status(error.status).json({ error: error.message });
    else { logError(error); res.status(503).json({ error: 'Friends are temporarily unavailable.' }); }
  };
  app.get('/api/friends', requireAccount, async (req, res) => res.json({ ...(await friendsStore.list(req.account.id)),
    notifications: (await friendsStore.notifications(req.account.id)), unread: (await friendsStore.unread(req.account.id)) }));
  app.get('/api/friends/summary', requireAccount, async (req, res) => res.json({ unread: (await friendsStore.unread(req.account.id)) }));
  app.get('/api/friends/search', apiOrigin, requireAccount, async (req, res) => {
    if (!friendLimit(friendSearchLimits, req, 30)) { res.status(429).json({ error: 'Too many searches. Try again soon.' }); return; }
    const query = req.query.q;
    if (typeof query !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{1,19}$/.test(query)) {
      res.status(400).json({ error: 'Enter at least two username characters.' }); return;
    }
    res.json({ users: (await friendsStore.search(req.account.id, query)) });
  });
  app.get('/api/invites/me', requireAccount, async (req, res) => {
    if (!req.account.username) { res.status(409).json({ error: 'Finish setting up a username before sharing your profile.' }); return; }
    const shareId = await store.friendShareId(req.account.id);
    res.json({ ...shareUrl(`/invite.html?friend=${shareId}`),
      displayName: req.account.display_name, username: req.account.username,
      avatar: avatarForAccount(req.account) });
  });
  app.get('/api/invites/friend/:shareId', optionalAccount, async (req, res) => {
    if (!validFriendShareId(req.params.shareId)) { res.status(404).json({ error: 'Profile unavailable.' }); return; }
    const target = await friendsStore.byShareId(req.params.shareId);
    if (!target?.username) { res.status(404).json({ error: 'Profile unavailable.' }); return; }
    const status = req.account ? await friendsStore.status(req.account.id, target.id) : 'sign-in';
    if (status === 'unavailable') { res.status(404).json({ error: 'Profile unavailable.' }); return; }
    const visible = status === 'self' || privacyForAccount(target).profileVisibility !== 'private';
    res.json({ displayName: visible ? target.display_name : 'Tablemate player',
      username: visible ? target.username : null, avatar: visible ? avatarForAccount(target) : null,
      status, signedIn: Boolean(req.account), needsSetup: Boolean(req.account && !req.account.username) });
  });
  app.post('/api/invites/friend/:shareId/:action', apiOrigin, requireAccount, async (req, res) => {
    if (!validFriendShareId(req.params.shareId) || !['send', 'accept', 'decline'].includes(req.params.action) ||
      !req.body || Object.keys(req.body).length) { res.status(400).json({ error: 'Invalid friend action.' }); return; }
    const target = await friendsStore.byShareId(req.params.shareId);
    if (!target?.username) { res.status(404).json({ error: 'Profile unavailable.' }); return; }
    const status = await friendsStore.status(req.account.id, target.id);
    if (status === 'unavailable') { res.status(404).json({ error: 'Profile unavailable.' }); return; }
    if (req.params.action === 'send' && status !== 'not-friends') {
      res.status(409).json({ error: 'Friend request state changed. Refresh and try again.' }); return;
    }
    if (req.params.action === 'send' && !friendLimit(friendSendLimits, req, 10)) {
      res.status(429).json({ error: 'Too many friend requests. Try again soon.' }); return;
    }
    try { res.json(await friendsStore.change(req.account.id, target.id, req.params.action, now(), { strictSend: true })); }
    catch (error) { friendFailure(res, error); }
  });
  app.post('/api/friends/notifications/read', apiOrigin, requireAccount, async (req, res) => {
    if (!req.body || Object.keys(req.body).length) { res.status(400).json({ error: 'Invalid request.' }); return; }
    (await friendsStore.markRead(req.account.id, now())); res.json({ unread: 0 });
  });
  app.get('/api/friends/invite/:code', requireAccount, (req, res) => {
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room || room.closing) { res.status(404).json({ error: 'This table is no longer open.' }); return; }
    if (room.game.players.length >= 10) { res.status(409).json({ error: 'This table is full.' }); return; }
    const ownSeat = room.game.players.find(player => room.accounts.get(player.id) === req.account.id);
    if (!ownSeat) { res.status(403).json({ error: 'Join this table with your account first.' }); return; }
    res.json({ code: room.code });
  });
  app.post('/api/friends/:username/:action', apiOrigin, requireAccount, async (req, res) => {
    if (!req.body || Object.keys(req.body).length || usernameError(req.params.username) ||
      !['send', 'accept', 'decline', 'cancel', 'remove', 'block', 'unblock'].includes(req.params.action)) {
      res.status(400).json({ error: 'Invalid friend action.' }); return;
    }
    if (req.params.action === 'send' && !friendLimit(friendSendLimits, req, 10)) {
      res.status(429).json({ error: 'Too many friend requests. Try again soon.' }); return;
    }
    const target = (await friendsStore.byUsername(req.params.username));
    if (!target) { res.status(404).json({ error: 'User not found.' }); return; }
    try { res.json((await friendsStore.change(req.account.id, target.id, req.params.action, now()))); }
    catch (error) { friendFailure(res, error); }
  });
  function friendSeat(req, res) {
    const room = rooms.get(String(req.params.code).toUpperCase());
    const targetSeat = room?.game.players.find(player => player.id === req.params.seatId);
    if (!targetSeat || !room.accounts.has(targetSeat.id) || !room.identities.has(targetSeat.id)) {
      res.status(404).json({ error: 'Account seat not found.' }); return null;
    }
    const mySeat = room.game.players.find(player => room.accounts.get(player.id) === req.account.id);
    if (!mySeat) { res.status(403).json({ error: 'Join this table with your account first.' }); return null; }
    const targetId = room.accounts.get(targetSeat.id);
    if (targetId === req.account.id) { res.status(400).json({ error: 'This is your seat.' }); return null; }
    return targetId;
  }
  app.get('/api/friends/table/:code/:seatId', requireAccount, async (req, res) => {
    const targetId = friendSeat(req, res);
    if (!targetId) return;
    const peer = (await friendsStore.peer(req.account.id, targetId, { table: true }));
    if (!peer) { res.status(404).json({ error: 'Account seat not found.' }); return; }
    res.json(peer);
  });
  app.post('/api/friends/table/:code/:seatId/request', apiOrigin, requireAccount, async (req, res) => {
    if (!req.body || Object.keys(req.body).length) { res.status(400).json({ error: 'Invalid friend action.' }); return; }
    if (!friendLimit(friendSendLimits, req, 10)) { res.status(429).json({ error: 'Too many friend requests. Try again soon.' }); return; }
    const targetId = friendSeat(req, res);
    if (!targetId || !(await friendsStore.peer(req.account.id, targetId, { table: true }))) {
      if (targetId) res.status(404).json({ error: 'Account seat not found.' }); return;
    }
    try { res.json((await friendsStore.change(req.account.id, targetId, 'send', now()))); }
    catch (error) { friendFailure(res, error); }
  });
  const usernameLimits = new Map();
  app.get('/api/username/check', apiOrigin, requireAccount, async (req, res) => {
    const session = hashToken(parseSessionCookie(req.headers.cookie));
    const bucket = usernameLimits.get(session);
    if (bucket && now() - bucket.start < 60_000 && bucket.count >= 30) { res.status(429).json({ error: 'Too many username checks.' }); return; }
    if (!bucket || now() - bucket.start >= 60_000) usernameLimits.set(session, { start: now(), count: 1 });
    else bucket.count++;
    const reason = usernameError(req.query.u) || (await store.usernameAvailability(req.account.id, req.query.u, now(), THIRTY_DAYS));
    res.json({ available: !reason, reason });
  });
  const suggestionLimits = new Map();
  app.get('/api/username/suggestions', apiOrigin, requireAccount, async (req, res) => {
    const key = req.account.id; const bucket = suggestionLimits.get(key);
    if (bucket && now() - bucket.start < 60_000 && bucket.count >= 5) { res.status(429).json({ error: 'Try suggestions again later.' }); return; }
    if (!bucket || now() - bucket.start >= 60_000) suggestionLimits.set(key, { start: now(), count: 1 }); else bucket.count++;
    const stem = req.account.display_name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[^a-z]+/, '').slice(0, 14) || 'player';
    const choices = new Set();
    for (let tries = 0; tries < 60 && choices.size < 3; tries++) {
      const suffix = Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[randomInt(36)]).join('');
      const candidate = `${stem}${suffix}`;
      if (!usernameError(candidate) && !(await store.usernameAvailability(req.account.id, candidate, now(), THIRTY_DAYS))) choices.add(candidate);
    }
    res.json({ suggestions: [...choices] });
  });
  app.post('/api/me/onboarding/skip', apiOrigin, requireAccount, async (req, res) => {
    if (!req.body || Object.keys(req.body).length) { res.status(400).json({ error: 'Invalid skip request.' }); return; }
    if (req.account.username) {
      const result = req.account.avatar_json ? { account: req.account }
        : await store.updateProfile(req.account.id, { avatar: defaultAvatarV2(req.account.id) }, now(), THIRTY_DAYS);
      res.json(selfProfile(result.account)); return;
    }
    for (let tries = 0; tries < 100; tries++) {
      const suffix = Array.from({ length: 5 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[randomInt(36)]).join('');
      const candidate = `player${suffix}`;
      const result = await store.updateProfile(req.account.id, { username: candidate, avatar: defaultAvatarV2(req.account.id) }, now(), THIRTY_DAYS);
      if (!result.reason) { res.json(selfProfile(result.account)); return; }
      if (result.reason === 'cooldown') { res.status(409).json({ error: 'Choose your current username.' }); return; }
    }
    res.status(503).json({ error: 'Could not assign a username. Try again.' });
  });
  const profileLimits = new Map();
  app.put('/api/me/profile', apiOrigin, requireAccount, async (req, res) => {
    const session = hashToken(parseSessionCookie(req.headers.cookie));
    const bucket = profileLimits.get(session);
    if (bucket && now() - bucket.start < 60_000 && bucket.count >= 30) { res.status(429).json({ error: 'Too many profile updates.' }); return; }
    if (!bucket || now() - bucket.start >= 60_000) profileLimits.set(session, { start: now(), count: 1 }); else bucket.count++;
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length ||
      Object.keys(body).some(key => !['username', 'displayName', 'avatar', 'privacy'].includes(key)) ||
      (body.username !== undefined && usernameError(body.username)) ||
      (body.displayName !== undefined && !validName(body.displayName)) ||
      (body.avatar !== undefined && !validAvatar(body.avatar)) ||
      (body.privacy !== undefined && !validPrivacy(body.privacy))) {
      res.status(400).json({ error: 'Invalid profile update.' }); return;
    }
    const patch = { ...body, ...(body.displayName !== undefined ? { displayName: normalizedName(body.displayName) } : {}) };
    const result = await store.updateProfile(req.account.id, patch, now(), THIRTY_DAYS);
    if (result.reason) { res.status(409).json({ error: result.reason }); return; }
    (await syncSeatIdentity(req.account.id, result.account));
    res.json(selfProfile(result.account));
  });
  const photoUploadLimits = new Map();
  app.post('/api/me/avatar-photo', apiOrigin, requireAccount, (req, res, next) => {
    const mime = req.get('Content-Type')?.split(';')[0].toLowerCase();
    if (!Object.hasOwn(AVATAR_PHOTO_MIME, mime || '')) { res.status(415).json({ error: 'Choose a JPEG, PNG or WebP photo.' }); return; }
    if (Number(req.get('Content-Length')) > MAX_AVATAR_PHOTO_BYTES) { res.status(413).json({ error: 'Photo must be 8 MB or smaller.' }); return; }
    const bucket = photoUploadLimits.get(req.account.id);
    if (bucket && now() - bucket.start < 60_000 && bucket.count >= 6) { res.status(429).json({ error: 'Too many photo uploads. Try again in a minute.' }); return; }
    if (!bucket || now() - bucket.start >= 60_000) photoUploadLimits.set(req.account.id, { start: now(), count: 1 }); else bucket.count++;
    next();
  }, express.raw({ type: () => true, limit: MAX_AVATAR_PHOTO_BYTES }), async (req, res) => {
    try {
      const image = await processAvatarPhoto(req.body, req.get('Content-Type').split(';')[0].toLowerCase());
      const account = await store.setAvatarPhoto(req.account.id, randomBytes(16).toString('hex'), image, now());
      (await syncSeatIdentity(req.account.id, account));
      res.json(selfProfile(account));
    } catch (error) {
      if (error.message === 'Choose a valid JPEG, PNG or WebP photo.') { res.status(400).json({ error: error.message }); return; }
      throw error;
    }
  });
  app.delete('/api/me/avatar-photo', apiOrigin, requireAccount, async (req, res) => {
    if (avatarForAccount(req.account).v !== 3) { res.status(409).json({ error: 'No photo avatar to remove.' }); return; }
    const result = await store.updateProfile(req.account.id, { avatar: defaultAvatarV2(req.account.id) }, now(), THIRTY_DAYS);
    (await syncSeatIdentity(req.account.id, result.account));
    res.json(selfProfile(result.account));
  });
  app.get('/avatar-photos/:key.webp', async (req, res) => {
    if (!accountsEnabled || !/^[0-9a-f]{32}$/.test(req.params.key)) { res.sendStatus(404); return; }
    const image = await (await store.getAvatarPhoto?.(req.params.key));
    if (!image) { res.sendStatus(404); return; }
    res.set('Cache-Control', 'private, no-store');
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    res.type('webp').send(image);
  });
  const hiddenProfile = res => res.status(404).json({ error: 'Profile not found.' });
  app.get('/api/u/:username', requireAccount, async (req, res) => {
    if (usernameError(req.params.username)) { hiddenProfile(res); return; }
    const target = await store.profileByUsername(req.params.username);
    if (!target) { hiddenProfile(res); return; }
    const sharedLeagues = (await store.sharedLeagues(req.account.id, target.id));
    if (target.id !== req.account.id && (privacyForAccount(target).profileVisibility !== 'leagues' || !sharedLeagues.length)) {
      hiddenProfile(res); return;
    }
    res.json({ displayName: target.display_name, username: target.username, avatar: avatarForAccount(target),
      memberSince: new Date(target.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), sharedLeagues });
  });
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
    const candidate = previous && validatePrefs(req.body) ? { ...previous, ...req.body,
      ...(req.body.sound ? { sound: { ...previous.sound, ...req.body.sound } } : {}),
      ...(req.body.vibration ? { vibration: { ...previous.vibration, ...req.body.vibration } } : {}) } : req.body;
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
    const currentRows = await store.listCurrentAccountNights(req.account.id);
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1) { res.status(400).json({ error: 'Invalid page.' }); return; }
    let running = 0;
    const trend = [...rows].reverse().map(row => ({ endedAt: row.ended_at, net: (running += row.net) }));
    const currentNight = currentRows.length ? {
      nightId: currentRows[0].night_id,
      roomCode: currentRows[0].room_code,
      startedAt: currentRows[0].started_at,
      updatedAt: currentRows[0].updated_at,
      provisional: true,
      stats: aggregateStats(currentRows),
    } : null;
    res.json({ lifetime: aggregateStats(rows), currentNight, refreshedAt: now(), trend, ...paginateNights(rows, page) });
  });
  app.get('/api/me/export', requireAccount, async (req, res) => {
    res.json(await store.exportAccount(req.account.id));
  });
  app.delete('/api/me', apiOrigin, requireAccount, async (req, res) => {
    if (req.body?.confirm !== 'DELETE' || Object.keys(req.body).length !== 1) {
      res.status(400).json({ error: 'Confirm account deletion with DELETE.' }); return;
    }
    await store.deleteAccount(req.account.id, now());
    for (const room of rooms.values()) {
      let changed = false;
      for (const [playerId, accountId] of room.accounts) {
        if (accountId === req.account.id) { room.accounts.delete(playerId); room.identities.delete(playerId); changed = true; }
      }
      if (changed) (await broadcast(room));
    }
    res.setHeader('Set-Cookie', 'tm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ deleted: true });
  });
  const leagueIdValid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
  const newInvite = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const publicLeague = async (league, canInvite = false) => ({ id: league.id, name: league.name,
    ...(canInvite ? { inviteCode: league.invite_code } : {}),
    tableSettings: JSON.parse(league.table_settings_json), members: (await leagueStore.roster(league.id)) });
  async function requireLeague(req, res, next) {
    if (!leagueIdValid(req.params.id)) { res.sendStatus(404); return; }
    const league = (await leagueStore.get(req.params.id));
    const member = league && (await leagueStore.member(league.id, req.account.id));
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
  app.get('/api/invites/league/:code', optionalAccount, async (req, res) => {
    const code = req.params.code;
    if (!validLeagueInvite(code)) { res.status(404).json({ error: 'Invitation unavailable.' }); return; }
    const league = await leagueStore.byInvite(code);
    if (!league) { res.status(404).json({ error: 'Invitation unavailable.' }); return; }
    const member = req.account ? await leagueStore.member(league.id, req.account.id) : null;
    res.json({ name: league.name, signedIn: Boolean(req.account), needsSetup: Boolean(req.account && !req.account.username), alreadyMember: Boolean(member),
      ...(member ? { leaguePath: `/league.html?id=${encodeURIComponent(league.id)}` } : {}) });
  });
  app.post('/api/invites/league/:code/join', apiOrigin, requireAccount, async (req, res) => {
    if (!validLeagueInvite(req.params.code) || !req.body || Object.keys(req.body).length) {
      res.status(400).json({ error: 'Invalid invitation.' }); return;
    }
    try {
      const joined = await leagueStore.joinByInvite(req.params.code, req.account, randomUUID(), now());
      if (!joined) { res.status(404).json({ error: 'Invitation unavailable.' }); return; }
      res.json({ alreadyMember: joined.alreadyMember,
        leaguePath: `/league.html?id=${encodeURIComponent(joined.league.id)}` });
    } catch (error) {
      if (error instanceof RequestError) res.status(409).json({ error: error.message });
      else { logError(error); res.status(503).json({ error: 'League is temporarily unavailable.' }); }
    }
  });
  app.use('/api/leagues', requireAccount);
  app.post('/api/leagues', apiOrigin, async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !validName(req.body.name)) {
      res.status(400).json({ error: 'Invalid league name.' }); return;
    }
    let inviteCode;
    do { inviteCode = newInvite(); } while ((await leagueStore.byInvite(inviteCode)));
    const league = (await leagueStore.create({ id: randomUUID(), name: normalizedName(req.body.name), inviteCode,
      settings: game.createTable().settings, account: req.account, memberId: randomUUID(), time: now() }));
    res.status(201).json((await publicLeague(league, true)));
  });
  app.get('/api/leagues', async (req, res) => res.json({ leagues: (await leagueStore.mine(req.account.id)) }));
  app.post('/api/leagues/join', apiOrigin, async (req, res) => {
    const code = typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.toUpperCase() : null;
    if (!code || !/^[A-HJ-NP-Z]{8}$/.test(code) || Object.keys(req.body).length !== 1) {
      res.status(400).json({ error: 'Invalid invite code.' }); return;
    }
    const joined = await leagueStore.joinByInvite(code, req.account, randomUUID(), now());
    if (!joined) { res.sendStatus(404); return; }
    res.json((await publicLeague(joined.league, ['commissioner', 'co'].includes((await leagueStore.member(joined.league.id, req.account.id)).role))));
  });
  app.get('/api/leagues/:id', requireLeague, async (req, res) => res.json({
    ...(await publicLeague(req.league, ['commissioner', 'co'].includes(req.leagueMember.role))), myRole: req.leagueMember.role }));
  app.get('/api/leagues/:id/invite', requireLeague, role('commissioner', 'co'), (req, res) => res.json({
    name: req.league.name, inviteCode: req.league.invite_code,
    ...shareUrl(`/invite.html?league=${req.league.invite_code}`) }));
  app.patch('/api/leagues/:id', apiOrigin, requireLeague, role('commissioner'), async (req, res) => {
    const body = req.body || {};
    if (Object.keys(body).some(key => !['name', 'tableSettings'].includes(key)) ||
      (body.name !== undefined && !validName(body.name))) { res.status(400).json({ error: 'Invalid league update.' }); return; }
    const settings = body.tableSettings === undefined ? JSON.parse(req.league.table_settings_json) : tableSettings(body.tableSettings);
    res.json((await publicLeague((await leagueStore.update(req.league.id, body.name ? normalizedName(body.name) : req.league.name, settings)), true)));
  });
  app.post('/api/leagues/:id/leave', apiOrigin, requireLeague, async (req, res) => {
    (await leagueStore.leave(req.leagueMember, now())); (await broadcastLeague(req.league.id)); res.json({ left: true });
  });
  app.post('/api/leagues/:id/invite/rotate', apiOrigin, requireLeague, role('commissioner', 'co'), async (req, res) => {
    let code; do { code = newInvite(); } while ((await leagueStore.byInvite(code)));
    (await leagueStore.rotate(req.league.id, code)); res.json({ inviteCode: code });
  });
  app.patch('/api/leagues/:id/members/:memberId', apiOrigin, requireLeague, role('commissioner'), async (req, res) => {
    if (!['co', 'member'].includes(req.body?.role) || Object.keys(req.body).length !== 1) { res.status(400).json({ error: 'Invalid role.' }); return; }
    (await leagueStore.setRole(req.league.id, req.params.memberId, req.body.role)); (await broadcastLeague(req.league.id));
    res.json({ members: (await leagueStore.roster(req.league.id)) });
  });
  app.delete('/api/leagues/:id/members/:memberId', apiOrigin, requireLeague, role('commissioner', 'co'), async (req, res) => {
    (await leagueStore.remove(req.league.id, req.params.memberId, now())); (await broadcastLeague(req.league.id));
    res.json({ members: (await leagueStore.roster(req.league.id)) });
  });
  app.post('/api/leagues/:id/transfer', apiOrigin, requireLeague, role('commissioner'), async (req, res) => {
    requireValue(leagueIdValid(req.body?.memberId) && Object.keys(req.body).length === 1, 'Invalid member.');
    (await leagueStore.transfer(req.league.id, req.leagueMember.id, req.body?.memberId)); (await broadcastLeague(req.league.id));
    res.json({ members: (await leagueStore.roster(req.league.id)) });
  });
  app.get('/api/leagues/:id/live', requireLeague, (req, res) => res.json({ roomCode: liveByLeague.get(req.league.id) ?? null }));
  app.get('/api/leagues/:id/seasons', requireLeague, async (req, res) => res.json({ seasons: (await leagueStore.seasons(req.league.id)).map(season => ({
    id: season.id, name: season.name, status: season.status, startsAt: season.starts_at, endsAt: season.ends_at,
    scoring: JSON.parse(season.scoring_json), championMemberId: season.champion_member_id })) }));
  app.post('/api/leagues/:id/seasons', apiOrigin, requireLeague, role('commissioner'), async (req, res) => {
    if (!validName(req.body?.name) || Object.keys(req.body).some(key => !['name', 'scoring'].includes(key))) {
      res.status(400).json({ error: 'Invalid season.' }); return;
    }
    const scoring = validateScoring(req.body.scoring);
    const season = (await leagueStore.createSeason(req.league.id, randomUUID(), normalizedName(req.body.name), scoring, now()));
    res.status(201).json({ id: season.id, status: season.status, scoring });
  });
  app.patch('/api/leagues/:id/seasons/:sid', apiOrigin, requireLeague, role('commissioner'), async (req, res) => {
    const prior = (await leagueStore.season(req.league.id, req.params.sid));
    if (!prior) { res.sendStatus(404); return; }
    if (Object.keys(req.body || {}).some(key => !['name', 'scoring'].includes(key)) ||
      (req.body?.name !== undefined && !validName(req.body.name))) { res.status(400).json({ error: 'Invalid season update.' }); return; }
    const scoring = req.body?.scoring ? validateScoring(req.body.scoring) : JSON.parse(prior.scoring_json);
    const season = (await leagueStore.updateSeason(req.league.id, prior.id, req.body?.name ? normalizedName(req.body.name) : prior.name, scoring));
    res.json({ id: season.id, status: season.status, scoring });
  });
  app.post('/api/leagues/:id/seasons/:sid/activate', apiOrigin, requireLeague, role('commissioner'), async (req, res) => {
    const season = (await leagueStore.activateSeason(req.league.id, req.params.sid, now())); res.json({ id: season.id, status: season.status });
  });
  app.post('/api/leagues/:id/seasons/:sid/close', apiOrigin, requireLeague, role('commissioner'), async (req, res) => {
    const season = (await leagueStore.season(req.league.id, req.params.sid));
    if (!season) { res.sendStatus(404); return; }
    const standings = computeStandings({ scoring: JSON.parse(season.scoring_json) }, (await leagueStore.results(req.league.id, season.id)), (await leagueStore.roster(req.league.id)));
    const champion = standings.find(row => row.qualified && row.nights > 0);
    const closed = (await leagueStore.closeSeason(req.league.id, season.id, champion?.memberId ?? null, now()));
    res.json({ id: closed.id, status: closed.status, championMemberId: closed.champion_member_id });
  });
  app.get('/api/leagues/:id/seasons/:sid/standings', requireLeague, async (req, res) => {
    const season = (await leagueStore.season(req.league.id, req.params.sid));
    if (!season) { res.sendStatus(404); return; }
    res.json({ season: { id: season.id, name: season.name, status: season.status,
      scoring: JSON.parse(season.scoring_json), championMemberId: season.champion_member_id },
    standings: computeStandings({ scoring: JSON.parse(season.scoring_json) }, (await leagueStore.results(req.league.id, season.id)), (await leagueStore.roster(req.league.id))) });
  });
  app.get('/api/leagues/:id/nights', requireLeague, async (req, res) => res.json({ nights: (await leagueStore.nights(req.league.id, req.query.season || null)) }));
  app.get('/api/leagues/:id/audit', requireLeague, async (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) { res.status(400).json({ error: 'Invalid audit page.' }); return; }
    res.json({ entries: (await leagueStore.audit(req.league.id, 50, (page - 1) * 50)), page });
  });
  app.get('/api/leagues/:id/records', requireLeague, async (req, res) => res.json(recordsFromResults((await leagueStore.results(req.league.id)), (await leagueStore.roster(req.league.id)))));
  for (const action of ['void', 'restore']) app.post(`/api/leagues/:id/nights/:nightId/${action}`, apiOrigin, requireLeague, role('commissioner', 'co'), async (req, res) => {
    const reason = req.body?.reason;
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 200 || /[<>\p{Cc}\p{Cf}]/u.test(reason) || Object.keys(req.body).length !== 1) {
      res.status(400).json({ error: 'A reason of 3–200 safe characters is required.' }); return;
    }
    (await leagueStore.reviewNight(req.league.id, req.params.nightId, action === 'restore', req.leagueMember.id, reason.trim(), now(), randomUUID()));
    res.json({ counts: action === 'restore' });
  });
  app.use('/avatar-creator', unityStatic(avatarCreatorRoot, avatarCreator));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') { res.status(413).json({ error: 'Upload or request is too large.' }); return; }
    if (error instanceof RequestError) { res.status(400).json({ error: error.message }); return; }
    logError(error); res.status(500).json({ error: 'Something went wrong.' });
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  async function view(room, id) {
    const state = structuredClone(room.game);
    const revision = room.revision;
    delete state.history;
    const handInProgress = game.isPlaying(room.game);
    const socket = io.sockets.sockets.get(room.connections.get(id));
    const signedIn = await signedInSeat(room, id, socket);
    const permissions = await roomAccess(room, id, socket, signedIn);
    return { ...state, roomCode: room.code, nightId: room.nightId, leagueTable: Boolean(room.leagueId),
      hostId: room.hostId, playerId: id, revision,
      signedIn,
      permissions,
      cosmetics: Object.fromEntries(room.cosmetics),
      identities: Object.fromEntries(room.identities),
      socialSeats: signedIn ? state.players.filter(player =>
        room.accounts.has(player.id) && room.identities.has(player.id) &&
        room.accounts.get(player.id) !== room.accounts.get(id) &&
        io.sockets.sockets.get(room.connections.get(player.id))?.data.accountProfile?.username).map(player => player.id) : [],
      rebuyPolicy: room.rebuyPolicy,
      canUndo: permissions.owner && room.game.history.length > 0, serverTime: now(),
      settlement: structuredClone(room.lastSettlement || game.settlement(room.game)),
      settlementNote: handInProgress ? 'Hand in progress. Showing totals from before this hand.' : '',
      push: { enabled: pushEnabled, publicKey: pushEnabled ? vapid.publicKey : '', subscribed: room.pushSubscriptions.has(id) },
      rebuyRequests: [...room.rebuyRequests].filter(([playerId]) => permissions.manage || playerId === id).map(([playerId, request]) => ({
        id: playerId, name: room.game.players.find(player => player.id === playerId)?.name || 'Player', amount: request.amount, at: request.at
      })),
      players: state.players.map(p => ({ ...p, connected: room.connections.has(p.id) })),
      // Side pots are finalized once, when the hand reaches showdown. Do not
      // expose recalculated layers after every street; that makes one hand look
      // like it is creating new pots each round.
      pots: state.street === 'showdown' || state.street === 'complete' ? state.pots : [],
      legal: game.legalActions(room.game, id) };
  }
  async function broadcast(room) {
    room.game.log.forEach(item => { if (item.timestamp === undefined) item.timestamp = now(); });
    if (!game.isPlaying(room.game)) room.lastSettlement = game.settlement(room.game);
    const states = await Promise.all([...room.connections].map(async ([id, socketId]) => [socketId, await view(room, id)]));
    for (const [socketId, state] of states) io.sockets.sockets.get(socketId)?.emit('state', state);
  }
  function autoEligible(room, id, amount) {
    return room.rebuyPolicy.mode === 'auto' && amount <= room.rebuyPolicy.cap
      && (room.autoRebuys.get(id) || 0) < room.rebuyPolicy.maxPerPlayer
      && room.game.players.some(player => player.id === id);
  }
  function approveAuto(room, id, amount) {
    room.game = game.rebuy(room.game, id, amount, { source: 'request', timestamp: now() });
    room.autoRebuys.set(id, (room.autoRebuys.get(id) || 0) + 1);
    room.rebuyRequests.delete(id); room.revision++;
    io.sockets.sockets.get(room.connections.get(id))?.emit('rebuy-result', { type: 'approved', amount });
  }
  function processAutoRebuys(room) {
    if (game.isPlaying(room.game)) return;
    for (const [id, request] of room.rebuyRequests) {
      if (!autoEligible(room, id, request.amount)) continue;
      try { approveAuto(room, id, request.amount); }
      catch (error) { if (!(error instanceof RequestError)) logError(error); }
    }
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
  async function bind(socket, room, id) {
    if (socket.data.accountId && socket.data.sessionHash && (await activeSession.get(socket.data.sessionHash, socket.data.accountId, now())) &&
      !room.accounts.has(id) && ![...room.accounts.values()].includes(socket.data.accountId)) {
      room.accounts.set(id, socket.data.accountId);
    }
    if (room.accounts.get(id) === socket.data.accountId && socket.data.accountProfile && socket.data.sessionHash &&
      (await activeSession.get(socket.data.sessionHash, socket.data.accountId, now()))) room.identities.set(id, tableIdentity(socket.data.accountProfile));
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
    requireValue(!room.closing, 'Night is ending. Please wait.');
    requireValue(safeTokenEqual(room.tokens.get(identity.id), payload.token), 'Seat token is invalid. Rejoin the room to continue.');
    return { room, id: identity.id };
  }
  function detach(room, id, reason) {
    const socket = io.sockets.sockets.get(room.connections.get(id));
    if (socket) {
      socket.data.identity = null;
      socket.emit('removed', { message: reason });
    }
    room.connections.delete(id);
    room.tokens.delete(id);
    room.rebuyRequests.delete(id);
    room.autoRebuys.delete(id);
    room.cosmetics.delete(id);
    room.identities.delete(id);
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
  const roomWork = new Map();
  function scheduleRoom(key, task) {
    const previous = roomWork.get(key) || Promise.resolve();
    const result = previous.then(task);
    const settled = result.then(() => {}, () => {});
    roomWork.set(key, settled);
    settled.then(() => { if (roomWork.get(key) === settled) roomWork.delete(key); });
    return result;
  }

  io.use(async (socket, next) => {
    if (accountsEnabled) {
      try {
        socket.data.accountProfile = await auth.accountFromCookie(socket.handshake.headers.cookie);
        socket.data.accountId = socket.data.accountProfile?.id ?? null;
        socket.data.sessionHash = socket.data.accountId ? hashToken(parseSessionCookie(socket.handshake.headers.cookie)) : null;
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
        const fail = error => {
          const message = error instanceof RequestError ? error.message : 'Something went wrong. Please try again.';
          if (!(error instanceof RequestError)) logError(error);
          socket.emit('request-error', { event, error: message });
          ack({ ok: false, error: message });
        };
        try {
          if (now() - windowStart >= 1000) { windowStart = now(); requests = 0; }
          requireValue(++requests <= 40, 'Too many requests. Try again in a moment.');
          if (entryEvents.has(event)) entryLimit(socket, event);
          validatePayload(event, payload);
          const key = event === 'create' ? payload.leagueId ? `league:${payload.leagueId}` : `socket:${socket.id}`
            : `room:${socket.data.identity?.code || payload.code || socket.id}`;
          scheduleRoom(key, () => fn(payload)).then(value => ack({ ok: true, ...value })).catch(fail);
        } catch (error) { fail(error); }
      });
    }
    on('create', async payload => {
      requireValue(!socket.data.identity, 'Leave your current table first.');
      requireValue(rooms.size < 1000, 'Server is full. Try again later.');
      let league = null;
      let leagueSettings = null;
      if (payload.leagueId) {
        requireValue(accountsEnabled && socket.data.accountId && socket.data.sessionHash &&
          (await activeSession.get(socket.data.sessionHash, socket.data.accountId, now())), 'Sign in to start a league table.');
        league = (await leagueStore.get(payload.leagueId));
        requireValue(league && ['commissioner', 'co'].includes((await leagueStore.member(league.id, socket.data.accountId))?.role), 'Only league commissioners and co-commissioners can start a league table.');
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
        leagueId: league?.id ?? null, seasonId: league ? (await leagueStore.activeSeason(league.id))?.id ?? null : null,
        tokens: new Map([[id, token]]), tokenHashes: new Map([[id, hashToken(token)]]), accounts: new Map(),
        connections: new Map(), rebuyRequests: new Map(), autoRebuys: new Map(), cosmetics: new Map(), identities: new Map(),
        rebuyPolicy: normalizeRebuyPolicy(payload.rebuyPolicy), pushSubscriptions: new Map(), presence: new Map(),
        lastActive: now(), revision: 0, lastSettlement: null };
      rooms.set(code, room); if (league) liveByLeague.set(league.id, code);
      seedCosmetics(socket, room, id); (await bind(socket, room, id)); (await broadcast(room));
      return { token, playerId: id, roomCode: code, state: (await view(room, id)) };
    });
    on('table-preview', payload => {
      const room = rooms.get(payload.code.toUpperCase());
      requireValue(room, 'Room not found. Check the eight-letter code.');
      requireValue(!room.closing, 'Night is ending. Please wait.');
      requireValue(!game.isPlaying(room.game), 'Join between hands.');
      requireValue(room.game.players.length < 10, 'This table has 10 players.');
      return { players: room.game.players.length, ...room.game.settings };
    });
    on('join', async payload => {
      requireValue(!socket.data.identity, 'Leave your current table first.');
      const room = rooms.get(payload.code.toUpperCase());
      requireValue(room, 'Room not found. Check the eight-letter code.');
      requireValue(!room.closing, 'Night is ending. Please wait.');
      requireValue(payload.expectedBuyIn === undefined || payload.expectedBuyIn === room.game.settings.startingStack, 'Buy-in changed. Review the table and confirm again.');
      const id = randomUUID();
      room.game = game.addPlayer(room.game, id, payload.name);
      const token = randomBytes(32).toString('hex');
      room.tokens.set(id, token); room.tokenHashes.set(id, hashToken(token)); room.revision++;
      seedCosmetics(socket, room, id); (await bind(socket, room, id)); (await broadcast(room));
      return { token, playerId: id, roomCode: room.code, state: (await view(room, id)) };
    });
    on('rejoin', async payload => {
      requireValue(!socket.data.identity, 'Already seated on this connection.');
      const room = rooms.get(payload.code.toUpperCase());
      requireValue(room, 'Room no longer exists. Create a new table.');
      requireValue(safeTokenEqual(room.tokens.get(payload.playerId), payload.token), 'Seat token is invalid.');
      if (!room.cosmetics.has(payload.playerId)) seedCosmetics(socket, room, payload.playerId);
      (await bind(socket, room, payload.playerId)); (await broadcast(room));
      return { playerId: payload.playerId, roomCode: room.code, state: (await view(room, payload.playerId)) };
    });
    function mutate(event, fn, permission = null) {
      on(event, async payload => {
        const { room, id } = member(socket, payload);
        if (permission) (await requireRoomAccess(room, id, socket, permission));
        requireValue(payload.revision === room.revision, 'Table changed. Please try again.');
        const previousTurn = room.game.turn;
        const wasPlaying = game.isPlaying(room.game);
        const nextState = fn(room, id, payload);
        room.game = nextState; room.revision++; room.lastActive = now();
        if (wasPlaying && nextState.street === 'complete') processAutoRebuys(room);
        if (room.game.street === 'complete' && !game.isPlaying(room.game)) persist(room);
        (await broadcast(room));
        sendTurnPush(room, previousTurn);
        return { state: (await view(room, id)) };
      });
    }
    mutate('start-hand', room => game.startHand(room.game, now()), 'manage');
    mutate('action', (room, id, payload) => game.act(room.game, id, { type: payload.type, amount: payload.amount }));
    mutate('showdown-pick', (room, _id, payload) => game.pickWinners(room.game, payload.potId, payload.winnerIds), 'manage');
    mutate('host-settings', (room, _id, payload) => game.configure(room.game, payload.settings), 'manage');
    mutate('host:reorderSeats', (room, _id, payload) => game.reorderSeats(room.game, payload.order), 'manage');
    on('seat:cosmetics', async payload => {
      const { room, id } = member(socket, payload);
      requireValue(Object.keys(payload).some(key => ['avatar', 'color', 'note'].includes(key)), 'Choose a seat style first.');
      const next = { ...room.cosmetics.get(id), ...Object.fromEntries(['avatar', 'color', 'note'].filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]])) };
      requireValue(![...room.cosmetics].some(([otherId, value]) => otherId !== id && value.color === next.color), 'That seat color is already in use.');
      room.cosmetics.set(id, next); room.lastActive = now(); (await broadcast(room));
      return { state: (await view(room, id)) };
    });
    on('host:rebuyPolicy', async payload => {
      const { room, id } = member(socket, payload); (await requireRoomAccess(room, id, socket, 'manage'));
      const policy = { mode: payload.mode, ...(payload.cap === undefined ? {} : { cap: payload.cap }),
        ...(payload.maxPerPlayer === undefined ? {} : { maxPerPlayer: payload.maxPerPlayer }) };
      requireValue(validRebuyPolicy(policy), 'Invalid rebuy policy.');
      room.rebuyPolicy = normalizeRebuyPolicy(policy); room.lastActive = now();
      (await broadcast(room));
      return { state: (await view(room, id)) };
    });
    on('host:endNight', async payload => {
      const { room, id } = member(socket, payload); (await requireRoomAccess(room, id, socket, 'manage'));
      requireValue(payload.revision === undefined || payload.revision === room.revision, 'Table changed. Please try again.');
      requireValue(!game.isPlaying(room.game) && room.game.handNumber > 0, 'Finish a hand before ending the night.');
      if (!room.leagueId) {
        requireValue(await persist(room, true), 'Night could not be saved. Try again.');
        return {};
      }
      room.closing = true;
      return persist(room, true).then(saved => {
        if (!saved) {
          room.closing = false; room.endedAt = null;
          throw new RequestError('Night could not be saved. The table is still open; try again.');
        }
        liveByLeague.delete(room.leagueId);
        rooms.delete(room.code);
        for (const playerId of [...room.connections.keys()]) detach(room, playerId, 'League night ended. Open the league to start another table.');
        return {};
      });
    });
    mutate('undo', room => game.undo(room.game), 'owner');
    mutate('sit-out', (room, id, payload) => game.setSitOut(room.game, id, payload.value));
    mutate('donate', (room, id, payload) => game.donate(room.game, id, payload.recipientId, payload.amount));
    mutate('rebuy', (room, _id, payload) => game.rebuy(room.game, payload.playerId, payload.amount, { source: 'host', timestamp: now() }), 'owner');
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
    on('rebuy:request', async payload => {
      const { room, id } = member(socket, payload);
      requireValue(!room.rebuyRequests.has(id), 'You already have a pending rebuy request.');
      const amount = payload.amount ?? room.game.settings.startingStack;
      room.rebuyRequests.set(id, { amount, at: now() }); room.lastActive = now();
      if (!game.isPlaying(room.game) && autoEligible(room, id, amount)) {
        try { approveAuto(room, id, amount); }
        catch (error) { if (!(error instanceof RequestError)) throw error; }
      }
      (await broadcast(room));
      return {};
    });
    on('rebuy:cancel', async payload => {
      const { room, id } = member(socket, payload);
      requireValue(room.rebuyRequests.has(id), 'There is no pending rebuy request to cancel.');
      room.rebuyRequests.delete(id); room.lastActive = now(); (await broadcast(room));
      return {};
    });
    on('rebuy:deny', async payload => {
      const { room, id } = member(socket, payload); (await requireRoomAccess(room, id, socket, 'manage'));
      const request = room.rebuyRequests.get(payload.playerId);
      requireValue(request, 'That rebuy request is no longer pending.');
      room.rebuyRequests.delete(payload.playerId); room.lastActive = now();
      const target = io.sockets.sockets.get(room.connections.get(payload.playerId));
      target?.emit('rebuy-result', { type: 'denied' });
      (await broadcast(room));
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
    }, 'manage');
    mutate('host-fold', room => {
      requireValue(room.game.turn && !room.connections.has(room.game.turn), 'Only the disconnected current player can be folded by the host.');
      return game.act(room.game, room.game.turn, { type: 'fold' });
    }, 'manage');
    on('leave', async payload => {
      const { room, id } = member(socket, payload);
      requireValue(payload.revision === room.revision, 'Table changed. Please try again.');
      room.game = game.removePlayer(room.game, id);
      detach(room, id, 'You left the table.'); room.revision++; room.lastActive = now();
      if (!room.game.players.length) { persist(room, true); if (room.leagueId) liveByLeague.delete(room.leagueId); rooms.delete(room.code); }
      else {
        if (room.hostId === id) room.hostId = room.game.players[0].id;
        (await broadcast(room));
      }
      return {};
    });
    mutate('kick', (room, id, payload) => {
      requireValue(payload.playerId !== id, 'Use Leave table to leave.');
      const state = game.removePlayer(room.game, payload.playerId);
      detach(room, payload.playerId, 'The host removed your seat.');
      return state;
    }, 'owner');
    socket.on('disconnect', async () => {
      const identity = socket.data.identity;
      const room = rooms.get(identity?.code);
      if (room && room.connections.get(identity.id) === socket.id) {
        room.connections.delete(identity.id);
        (await broadcast(room));
      }
    });
  });
  return { app, httpServer, io, rooms, sweep,
    listen: async (port = 0, host = '127.0.0.1') => {
      await store.init();
      return new Promise(resolve => httpServer.listen(port, host, () => resolve(httpServer.address())));
    },
    close: () => new Promise(resolve => { clearInterval(cleanup); io.close(async () => {
      await Promise.allSettled([...rooms.values()].map(room => room.persistChain).filter(Boolean));
      await store.close?.(); resolve();
    }); }) };
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
