import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { PREF_ENUMS, DEFAULT_PREFS, MAX_PREFS_BYTES, validatePrefs } from '../src/prefs-schema.js';

const source = readFileSync(new URL('../public/prefs.js', import.meta.url), 'utf8');
function client(saved = {}, serverSettings = null) {
  const values = new Map(Object.entries(saved));
  const calls = [];
  const root = { dataset: {} };
  const listeners = new Map();
  const document = { documentElement: root,
    querySelector: () => null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    dispatchEvent: () => {} };
  const context = { window: { Tablemate: { resolveTheme: theme => theme, themeColors: {} }, Alerts: { configure: () => {}, setPreference: () => {} } },
    document, localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    fetch: async (path, options) => { calls.push({ path, options });
      if (path === '/api/config') return { json: async () => ({ accounts: true }) };
      if (path === '/api/me/settings' && !options) return { ok: true, json: async () => ({ settings: serverSettings }) };
      return { ok: true, json: async () => ({}) };
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    setTimeout: () => 0, clearTimeout: () => {}, structuredClone, Event: class Event {} };
  runInNewContext(source, context);
  return { api: context.window.TablematePrefs, values, calls, listeners, root };
}

test('server and classic client share closed settings vocabulary and limits', () => {
  const { api } = client();
  for (const [key, ids] of Object.entries(PREF_ENUMS)) assert.deepEqual([...api.enums[key]], ids);
  assert.equal(api.maxBytes, MAX_PREFS_BYTES);
  assert.deepEqual(JSON.parse(JSON.stringify(api.defaults)), DEFAULT_PREFS);
  assert.equal(validatePrefs(DEFAULT_PREFS), true);
  for (const invalid of [
    { ...DEFAULT_PREFS, unknown: true }, { ...DEFAULT_PREFS, theme: 'javascript:alert(1)' },
    { ...DEFAULT_PREFS, sound: { on: 'true', pack: 'classic' } },
    { ...DEFAULT_PREFS, vibration: { on: true, yourTurn: 'blast', win: 'off' } },
    { ...DEFAULT_PREFS, note: '<script>' }, { ...DEFAULT_PREFS, note: 'x'.repeat(25) },
    { ...DEFAULT_PREFS, note: '\u0000' }, { ...DEFAULT_PREFS, note: 'é'.repeat(1024) }
  ]) assert.equal(validatePrefs(invalid), false);
  assert.equal(api.valid({ ...DEFAULT_PREFS, unknown: true }), false);
});

test('old theme and alert keys migrate once; signed-in server value wins', async () => {
  const migrated = client({ 'tablemate-theme-v1': '{"theme":"royal-flush"}',
    'tablemate-alerts-v1': '{"sound":false,"vibration":false,"keepScreenOn":false}' },
  { ...DEFAULT_PREFS, theme: 'miami-vice' });
  assert.equal(migrated.api.read().theme, 'royal-flush');
  assert.equal(migrated.api.read().sound.on, false);
  await migrated.api.sync();
  assert.equal(migrated.api.get().theme, 'miami-vice');
  assert.equal(migrated.root.dataset.theme, 'miami-vice');
  assert.equal(migrated.calls.some(call => call.options?.method === 'PUT'), false);
  const empty = client({ 'tablemate-prefs-v1': JSON.stringify({ ...DEFAULT_PREFS, theme: 'retro-arcade' }) });
  await empty.api.sync();
  assert.equal(empty.calls.find(call => call.options?.method === 'PUT')?.path, '/api/me/settings');
});

test('settings API validates session, origin and payload, and disappears without accounts', async t => {
  const noDb = createServer();
  const noDbAddress = await noDb.listen();
  t.after(() => noDb.close());
  const noDbUrl = `http://127.0.0.1:${noDbAddress.port}`;
  assert.equal((await fetch(noDbUrl + '/api/me/settings')).status, 404);
  const sent = [];
  const store = new SqliteStore(':memory:');
  const server = createServer({ store, mailer: { enabled: true, send: async (_email, link) => sent.push(link) } });
  const address = await server.listen();
  t.after(() => server.close());
  const url = `http://127.0.0.1:${address.port}`;
  const put = (settings, cookie, origin) => fetch(url + '/api/me/settings', { method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(settings) });
  assert.equal((await put(DEFAULT_PREFS)).status, 401);
  await fetch(url + '/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"alex@example.com"}' });
  const token = new URL(sent[0]).searchParams.get('token');
  const verified = await fetch(url + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  const cookie = verified.headers.get('set-cookie');
  assert.equal((await put(DEFAULT_PREFS, cookie, 'https://foreign.example')).status, 403);
  assert.equal((await put({ ...DEFAULT_PREFS, theme: 'rogue' }, cookie)).status, 400);
  assert.equal((await put({ ...DEFAULT_PREFS, theme: 'retro-arcade' }, cookie)).status, 200);
  assert.equal((await (await fetch(url + '/api/me/settings', { headers: { Cookie: cookie } })).json()).settings.theme, 'retro-arcade');
});
