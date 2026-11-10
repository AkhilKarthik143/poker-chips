import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { BUILTIN_PRESETS, MAX_PRESETS, validPreset } from '../src/preset-schema.js';

const client = { window: {} };
runInNewContext(readFileSync(new URL('../public/presets.js', import.meta.url), 'utf8'), client);

test('built-in presets share one vocabulary and create payload shape', () => {
  assert.equal(MAX_PRESETS, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(client.window.TablematePresets.builtins)), BUILTIN_PRESETS);
  for (const preset of BUILTIN_PRESETS) {
    assert.equal(validPreset(preset), true);
    const payload = client.window.TablematePresets.createPayload(preset);
    assert.deepEqual(Object.keys(payload).sort(), ['rebuyPolicy', 'settings']);
    assert.deepEqual(Object.keys(payload.settings).sort(), ['bigBlind', 'blindMinutes', 'centsPer1000Chips', 'smallBlind', 'startingStack']);
    assert.deepEqual(JSON.parse(JSON.stringify({ ...payload.settings, name: preset.name, rebuyPolicy: payload.rebuyPolicy })), preset);
  }
  assert.equal(validPreset({ ...BUILTIN_PRESETS[0], bigBlind: 11 }), false);
  assert.equal(validPreset({ ...BUILTIN_PRESETS[0], name: '<img>' }), false);
  assert.equal(validPreset({ ...BUILTIN_PRESETS[0], extra: 1 }), false);
});

test('saved presets enforce session, ownership, validation and cap', async t => {
  const sent = [];
  const store = new SqliteStore(':memory:');
  const server = createServer({ store, mailer: { enabled: true, send: async (_email, link) => sent.push(link) } });
  const address = await server.listen();
  t.after(() => server.close());
  const url = `http://127.0.0.1:${address.port}`;
  const api = (path, method = 'GET', cookie, body) => fetch(url + path, { method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await api('/api/me/presets')).status, 401);
  const signup = async email => {
    await api('/api/auth/request', 'POST', null, { email });
    const link = sent.at(-1);
    const result = await api('/api/auth/verify', 'POST', null, { token: new URL(link).searchParams.get('token') });
    return result.headers.get('set-cookie');
  };
  const owner = await signup('owner@example.com');
  const stranger = await signup('stranger@example.com');
  const path = '/api/me/presets';
  assert.equal((await api(path, 'POST', owner, { ...BUILTIN_PRESETS[0], smallBlind: 7 })).status, 400);
  const ids = [];
  for (let index = 0; index < MAX_PRESETS; index++) {
    const created = await api(path, 'POST', owner, { ...BUILTIN_PRESETS[0], name: `Preset ${index}` });
    assert.equal(created.status, 201);
    ids.push((await created.json()).preset.id);
  }
  assert.equal((await api(path, 'POST', owner, BUILTIN_PRESETS[0])).status, 409);
  assert.equal((await (await api(path, 'GET', owner)).json()).presets.length, MAX_PRESETS);
  assert.equal((await api(`${path}/${ids[0]}`, 'PATCH', stranger, { position: 1 })).status, 404);
  assert.equal((await api(`${path}/${ids[0]}`, 'DELETE', stranger)).status, 404);
  const renamed = await api(`${path}/${ids[0]}`, 'PATCH', owner, { preset: { ...BUILTIN_PRESETS[1], name: 'Fast night' } });
  assert.equal((await renamed.json()).preset.name, 'Fast night');
  assert.equal((await api(`${path}/${ids[0]}`, 'DELETE', owner)).status, 200);
  assert.equal((await (await api(path, 'GET', owner)).json()).presets.length, MAX_PRESETS - 1);
});

test('saved preset endpoint is absent in guest mode', async t => {
  const server = createServer();
  const address = await server.listen();
  t.after(() => server.close());
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/me/presets`)).status, 404);
});
