import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp as makeTemp, mkdir as makeDir, writeFile as putFile, rm as remove } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import vm from 'node:vm';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { createStore } from '../src/store/index.js';

test('Unity build flag, scoped CSP and asset headers leave the rest of the app unchanged', async t => {
  const root = await makeTemp(join(tmpdir(), 'tablemate-unity-'));
  t.after(() => remove(root, { recursive: true, force: true }));
  await makeDir(join(root, 'Build'));
  await putFile(join(root, 'index.html'), '<!doctype html><title>Creator fixture</title>');
  await putFile(join(root, 'Build', 'avatar.abcdef1234.wasm.gz'), gzipSync(Buffer.from([0, 97, 115, 109])));
  await putFile(join(root, 'Build', 'avatar.data.gz'), gzipSync('data'));
  await putFile(join(root, 'Build', 'avatar.framework.js.gz'), gzipSync('window.fixture=1'));
  await putFile(join(root, 'Build', 'avatar.loader.js'), 'window.fixture=1');
  await putFile(join(root, 'Build', 'avatar.br.wasm.br'), brotliCompressSync(Buffer.from([0, 97, 115, 109])));
  const mailer = { enabled: true, send: async () => {} };
  const enabled = createServer({ store: new SqliteStore(':memory:'), mailer, avatarCreatorRoot: root });
  const disabled = createServer({ store: createStore(''), mailer, avatarCreatorRoot: root });
  const missing = createServer({ store: new SqliteStore(':memory:'), mailer, avatarCreatorRoot: join(root, 'absent') });
  const ports = await Promise.all([enabled.listen(), disabled.listen(), missing.listen()]);
  t.after(async () => { await enabled.close(); await disabled.close(); await missing.close(); });
  const urls = ports.map(item => `http://127.0.0.1:${item.port}`);
  const config = await (await fetch(urls[0] + '/api/config')).json();
  assert.equal(config.avatarCreator, true);
  assert.equal((await (await fetch(urls[1] + '/api/config')).json()).avatarCreator, false);
  assert.equal((await (await fetch(urls[2] + '/api/config')).json()).avatarCreator, false);
  assert.equal((await fetch(urls[1] + '/avatar-creator/index.html')).status, 404);
  assert.equal((await fetch(urls[2] + '/avatar-creator/index.html')).status, 404);
  const base = (await fetch(urls[0] + '/')).headers.get('content-security-policy');
  assert.equal((await fetch(urls[2] + '/')).headers.get('content-security-policy'), base);
  const page = await fetch(urls[0] + '/avatar-creator/index.html');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-security-policy'), base.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"));
  assert.doesNotMatch(page.headers.get('content-security-policy'), /'unsafe-eval'|blob:/);
  const wasm = await fetch(urls[0] + '/avatar-creator/Build/avatar.abcdef1234.wasm.gz');
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal(wasm.headers.get('content-encoding'), 'gzip');
  assert.match(wasm.headers.get('cache-control'), /immutable/);
  const data = await fetch(urls[0] + '/avatar-creator/Build/avatar.data.gz');
  assert.equal(data.headers.get('content-type'), 'application/octet-stream');
  assert.equal(data.headers.get('cache-control'), 'no-cache');
  const framework = await fetch(urls[0] + '/avatar-creator/Build/avatar.framework.js.gz');
  assert.match(framework.headers.get('content-type'), /javascript/);
  const brotli = await fetch(urls[0] + '/avatar-creator/Build/avatar.br.wasm.br');
  assert.equal(brotli.headers.get('content-encoding'), 'br');
  assert.equal(brotli.headers.get('content-type'), 'application/wasm');
});

test('creator return path rejects external, protocol and encoded double-slash destinations', () => {
  const source = readFileSync(new URL('../unity/AvatarCreator/Assets/WebGLTemplates/Tablemate/return-path.js', import.meta.url), 'utf8');
  const context = { window: {}, location: { origin: 'http://127.0.0.1:3101' }, URL };
  vm.runInNewContext(source, context);
  const safe = context.window.TablemateCreatorPath.safeReturnPath;
  assert.equal(safe('/me.html?tab=profile'), '/me.html?tab=profile');
  for (const value of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/%2Fevil.com', '/\\evil.com', null])
    assert.equal(safe(value), '/me.html');
});

test('creator redirects signed-out visitors and reports a failed profile save', async () => {
  const source = readFileSync(new URL('../unity/AvatarCreator/Assets/WebGLTemplates/Tablemate/loader.js', import.meta.url), 'utf8');
  const elements = { '#creator-build': { dataset: {} }, '#creator-loading': {}, '#creator-error': {},
    '#creator-progress': {}, '#simple-builder': {} };
  const locations = [];
  const location = { origin: 'http://127.0.0.1:3101', search: '?return=%2Fwelcome.html',
    assign: path => locations.push(path) };
  const window = { TablemateCreatorPath: { safeReturnPath: value => value || '/me.html' } };
  const fetch = async path => path === '/api/me'
    ? { status: 401, ok: false }
    : { status: 503, ok: false, json: async () => ({ error: 'Save unavailable.' }) };
  const document = { querySelector: selector => elements[selector] };
  vm.runInNewContext(source, { window, document, fetch, location, URLSearchParams });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(locations, ['/login.html']);
  assert.equal(elements['#simple-builder'].href, '/welcome.html');
  await assert.rejects(window.TablemateAvatar.save(JSON.stringify({ v: 2 })), /Save unavailable/);
});
