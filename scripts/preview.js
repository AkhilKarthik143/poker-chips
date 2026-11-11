import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express from 'express';
import { SqliteStore } from '../src/store/sqlite.js';
import { LeagueStore } from '../src/league-store.js';
import { FriendsStore } from '../src/friends-store.js';
import { defaultAvatarV2, THIRTY_DAYS } from '../src/identity.js';
import { hashSecret } from '../src/auth.js';
import { createServer } from '../src/server.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.TABLEMATE_PREVIEW_PORT || 3102);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port.');
const store = new SqliteStore(join(root, 'data', 'tablemate-preview.db'));
const leagueStore = new LeagueStore(store.db);
const friendsStore = new FriendsStore(store.db);
const demoEmail = 'alex@preview.tablemate.test';

async function seed() {
  if (store.db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count) return;
  const now = Date.now();
  const people = [
    { name: 'Alex', username: 'alex', hair: 'pixie', email: demoEmail },
    { name: 'Sam', username: 'sam', hair: 'afro', email: 'sam@preview.tablemate.test' },
    { name: 'Jules', username: 'jules', hair: 'braids', email: 'jules@preview.tablemate.test' },
    { name: 'Maya', username: 'maya', hair: 'mohawk', email: 'maya@preview.tablemate.test' }
  ];
  for (const person of people) {
    const account = await store.createAccount(randomUUID(), person.email, person.name, now - 60 * 86_400_000);
    person.account = await store.updateProfile(account.id, { username: person.username,
      avatar: { ...defaultAvatarV2(account.id), hair: person.hair, hat: 'none' } }, now - 60 * 86_400_000, THIRTY_DAYS);
    person.account = person.account.account;
  }
  const settings = { startingStack: 1000, smallBlind: 5, bigBlind: 10, blindMinutes: 0, centsPer1000Chips: 0 };
  const leagueId = randomUUID();
  leagueStore.create({ id: leagueId, name: 'Friday Night', inviteCode: 'FRDAYABC', settings,
    account: people[0].account, memberId: randomUUID(), time: now - 40 * 86_400_000 });
  for (const person of people.slice(1)) {
    const member = leagueStore.join(leagueId, person.account, randomUUID(), now - 40 * 86_400_000);
    if (person.username === 'sam') leagueStore.setRole(leagueId, member.id, 'co');
  }
  const seasonId = randomUUID();
  leagueStore.createSeason(leagueId, seasonId, 'Fall Sessions',
    { type: 'points', table: [10, 7, 5, 3], participation: 1, dropWorst: 0, minNightsPct: 0 }, now - 35 * 86_400_000);
  leagueStore.activateSeason(leagueId, seasonId, now - 35 * 86_400_000);
  const nights = [
    [350, -100, -150, -100],
    [-200, 450, -150, -100],
    [150, -250, 400, -300],
    [-50, 150, -250, 150]
  ];
  for (const [index, nets] of nights.entries()) {
    const nightId = randomUUID();
    const startedAt = now - (28 - index * 7) * 86_400_000;
    await store.saveNight({ nightId, roomCode: ['ACDFGHJK', 'BCDGHJKL', 'CDEGHJKL', 'DEFGHJKL'][index],
      groupId: null, leagueId, seasonId, startedAt, updatedAt: startedAt + 4 * 3_600_000,
      endedAt: startedAt + 4 * 3_600_000, hands: 35 + index * 4, settings, settlement: [],
      players: people.map((person, seat) => ({ id: randomUUID(), name: person.name, accountId: person.account.id,
        claimHash: randomBytes(32).toString('hex'), buyIn: 1000, cashOut: 1000 + nets[seat], net: nets[seat],
        handsPlayed: 35 + index * 4, handsWon: 4 + ((index + seat) % 6), vpipHands: 11 + seat * 2,
        pfrHands: 5 + seat, raises: 4 + seat, calls: 6 + seat, checks: 8 + seat, folds: 12 + seat,
        allIns: seat === index ? 1 : 0, showdowns: 4 + seat, showdownWins: 1 + (seat % 3) })) });
    leagueStore.finalizeNight(nightId);
  }
  await store.createPreset(people[0].account.id, randomUUID(), { name: 'Friday fast', startingStack: 1200,
    smallBlind: 10, bigBlind: 20, blindMinutes: 15, centsPer1000Chips: 0,
    rebuyPolicy: { mode: 'auto', cap: 1200, maxPerPlayer: 2 } }, now - 20 * 86_400_000);
  friendsStore.change(people[0].account.id, people[1].account.id, 'send', now - 3 * 86_400_000);
  friendsStore.change(people[1].account.id, people[0].account.id, 'accept', now - 2 * 86_400_000);
  friendsStore.change(people[2].account.id, people[0].account.id, 'send', now - 86_400_000);
}

await seed();
const server = createServer({ store, devLogin: false, previewMode: true, googleClientId: null,
  mailer: { enabled: true, local: true, async send() {} },
  vapid: { publicKey: null, privateKey: null, subject: null } });
server.app.use('/preview', express.static(join(root, 'preview'), { index: 'index.html' }));
let accountCreates = 0;
let accountCreateWindow = Date.now();
let signIns = 0;
let signInWindow = Date.now();
server.app.post(['/preview/demo-login', '/preview/fresh-account'], async (req, res) => {
  const origin = req.get('Origin');
  const host = req.get('Host');
  if (!origin || ![`http://${host}`, `https://${host}`].includes(origin) || req.get('Sec-Fetch-Site') === 'cross-site') {
    res.status(403).json({ error: 'Open the preview website first.' }); return;
  }
  if (Date.now() - signInWindow >= 3_600_000) { signInWindow = Date.now(); signIns = 0; }
  if (signIns >= 120) { res.status(429).json({ error: 'Preview sign-in limit reached. Try again later.' }); return; }
  signIns++;
  if (req.path === '/preview/fresh-account') {
    if (Date.now() - accountCreateWindow >= 3_600_000) { accountCreateWindow = Date.now(); accountCreates = 0; }
    if (accountCreates >= 25) { res.status(429).json({ error: 'Preview account limit reached. Try again later.' }); return; }
    accountCreates++;
  }
  try {
    const account = req.path === '/preview/fresh-account'
      ? await store.createAccount(randomUUID(), `preview-${randomBytes(10).toString('hex')}@example.test`, 'Player', Date.now())
      : await store.getAccountByEmail(demoEmail);
    if (!account) { res.status(503).json({ error: 'Demo account is unavailable.' }); return; }
    const token = randomBytes(32).toString('hex');
    await store.saveSession(hashSecret(token), account.id, Date.now() + 30 * 86_400_000);
    res.setHeader('Set-Cookie', `tm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${origin.startsWith('https://') ? '; Secure' : ''}`);
    res.json({ ok: true, onboarding: req.path === '/preview/fresh-account' });
  } catch { res.status(503).json({ error: 'Preview sign-in is temporarily unavailable.' }); }
});
await server.listen(port, '127.0.0.1');
process.stdout.write(`Tablemate preview: http://localhost:${port}/preview/\n`);
const stop = async () => { await server.close(); process.exit(0); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
