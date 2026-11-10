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
const second = { ...first, hair: first.hair === 'bob' ? 'curls' : 'bob', hat: 'cowboy', outfitColor: 'c6' };
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
  assert.equal(result.compositions, 0); assert.ok(result.images >= 11 && result.images <= 22);
  await mkdir(new URL('../artifacts/qa/', import.meta.url), { recursive: true });
  await page.evaluate(second => {
    const fixture = document.querySelector('#avatar-fixture'); fixture.append(window.AvatarV2.render(second, 128, 'Second'));
  }, second);
  await page.locator('#avatar-fixture').screenshot({ path: new URL('../artifacts/qa/avatar-v2-render.png', import.meta.url).pathname });
  process.stdout.write(`Avatar compositor: two distinct specs, stable pixels, cached recomposition, ${result.images} cached layer images.\n`);
} finally { await browser.close(); await server.close(); }
