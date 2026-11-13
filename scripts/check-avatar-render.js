/* global document, window */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { defaultAvatarV2 } from '../src/identity.js';

const server = createServer({ store: new SqliteStore(':memory:') });
const { port } = await server.listen();
const browser = await chromium.launch({ headless: true });
const first = defaultAvatarV2('render-check');
const second = { ...first, face: 'round', nose: 'button', hair: first.hair === 'bob' ? 'curls' : 'bob',
  brows: 'raised', eyes: 'surprised', mouth: 'laugh', hat: 'cowboy', outfitColor: 'c6' };
try {
  const page = await browser.newPage({ viewport: { width: 520, height: 320 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(({ first, second }) => {
    const fixture = document.createElement('div'); fixture.id = 'avatar-fixture';
    fixture.append(window.AvatarV2.render(first, 128, 'First'), window.AvatarV2.render(second, 128, 'Second'));
    document.body.replaceChildren(fixture);
  }, { first, second });
  await page.waitForFunction(() => window.AvatarV2.stats().compositions === 2);
  const result = await page.evaluate(first => {
    const canvases = [...document.querySelectorAll('#avatar-fixture canvas')];
    const a = canvases[0].toDataURL(); const b = canvases[1].toDataURL();
    const before = window.AvatarV2.stats().compositions;
    const fixture = document.querySelector('#avatar-fixture');
    fixture.innerHTML = window.AvatarV2.markup(first, 128, 'First again');
    window.AvatarV2.hydrate(fixture);
    return { distinct: a !== b, identical: fixture.querySelector('canvas').toDataURL() === a,
      compositions: window.AvatarV2.stats().compositions - before,
      images: window.AvatarV2.stats().images };
  }, first);
  assert.equal(result.distinct, true); assert.equal(result.identical, true);
  assert.equal(result.compositions, 0); assert.ok(result.images >= 15 && result.images <= 28);
  await mkdir(new URL('../artifacts/qa/', import.meta.url), { recursive: true });
  await page.evaluate(second => {
    const fixture = document.querySelector('#avatar-fixture'); fixture.append(window.AvatarV2.render(second, 128, 'Second'));
  }, second);
  await page.locator('#avatar-fixture').screenshot({ path: new URL('../artifacts/qa/avatar-v2-render.png', import.meta.url).pathname });
  const slow = await browser.newPage();
  await slow.route('**/avatar-layers/outfit/*.png', async route => {
    await new Promise(resolve => setTimeout(resolve, 350)); await route.continue();
  });
  await slow.goto(`http://127.0.0.1:${port}/`);
  const initialPixels = await slow.evaluate(spec => {
    const canvas = window.AvatarV2.render(spec, 64, 'Slow'); document.body.replaceChildren(canvas);
    return canvas.toDataURL();
  }, first);
  await slow.waitForFunction(() => window.AvatarV2.stats().compositions === 1);
  assert.notEqual(await slow.locator('canvas').evaluate(canvas => canvas.toDataURL()), initialPixels,
    'The placeholder should be replaced when a slow layer arrives');

  const broken = await browser.newPage();
  await broken.route('**/avatar-layers/hat/cowboy.png', route => route.abort());
  await broken.goto(`http://127.0.0.1:${port}/`);
  const missingSpec = { ...first, hat: 'cowboy' };
  const placeholder = await broken.evaluate(spec => {
    const canvas = window.AvatarV2.render(spec, 64, 'Missing'); document.body.replaceChildren(canvas);
    return canvas.toDataURL();
  }, missingSpec);
  await broken.waitForFunction(() => window.AvatarV2.stats().specs === 0);
  assert.equal(await broken.locator('canvas').evaluate(canvas => canvas.toDataURL()), placeholder,
    'A failed layer should leave the neutral placeholder');
  await broken.unroute('**/avatar-layers/hat/cowboy.png');
  await broken.evaluate(spec => document.body.replaceChildren(window.AvatarV2.render(spec, 64, 'Recovered')), missingSpec);
  await broken.waitForFunction(() => window.AvatarV2.stats().compositions === 1);
  assert.notEqual(await broken.locator('canvas').evaluate(canvas => canvas.toDataURL()), placeholder,
    'The failed layer should load on retry');
  process.stdout.write(`Avatar compositor: distinct specs, stable cached pixels, slow placeholder, missing-layer fallback and retry; ${result.images} cached layer images.\n`);
} finally { await browser.close(); await server.close(); }
