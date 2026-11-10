/* global Image, document */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const art = join(root, 'avatar-art');
const publicLayers = join(root, 'public/avatar-layers');
const unityLayers = join(root, 'unity/AvatarCreator/Assets/Resources/AvatarLayers');
const unityManifest = join(root, 'unity/AvatarCreator/Assets/StreamingAssets/manifest.json');
const check = process.argv.includes('--check');
const idPattern = /^[a-z0-9-]+$/;
const slotPattern = /^[a-z][A-Za-z0-9]*$/;
const manifestBytes = await readFile(join(art, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.version, 2);
assert.equal(manifest.size, 256);
assert.ok(Array.isArray(manifest.slots) && manifest.slots.length > 0);
const slots = new Set(); const orders = new Set();
for (const slot of manifest.slots) {
  assert.match(slot.slot, slotPattern);
  assert.ok(!slots.has(slot.slot) && !orders.has(slot.zOrder));
  slots.add(slot.slot); orders.add(slot.zOrder);
  assert.ok(Array.isArray(slot.parts) && slot.parts.length > 0);
  const ids = new Set();
  for (const part of slot.parts) {
    assert.match(part.id, idPattern);
    assert.ok(!ids.has(part.id)); ids.add(part.id);
    assert.equal(part.file, `svg/${slot.slot}/${part.id}.svg`);
    assert.equal(typeof part.tintable, 'boolean');
  }
}
for (const field of ['palette', 'skinTones']) {
  const ids = new Set();
  for (const entry of manifest[field]) {
    assert.match(entry.id, idPattern); assert.match(entry.hex, /^#[0-9a-fA-F]{6}$/);
    assert.ok(!ids.has(entry.id)); ids.add(entry.id);
  }
}
assert.equal(manifest.palette.length, 12);
assert.equal(manifest.skinTones.length, 8);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
let total = 0; let count = 0;
try {
  for (const slot of manifest.slots) for (const part of slot.parts) {
    const source = await readFile(join(art, part.file), 'utf8');
    assert.match(source, /viewBox="0 0 256 256"/);
    assert.doesNotMatch(source, /<script|<image|href=|url\(|<foreignObject/i);
    await page.setContent(`<html><body style="margin:0;width:256px;height:256px">${source}</body></html>`);
    const png = await page.locator('svg').screenshot({ omitBackground: true });
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), 256); assert.equal(png.readUInt32BE(20), 256);
    assert.equal(png[25], 6, `${slot.slot}/${part.id} must be RGBA`);
    assert.ok(png.length < 40 * 1024, `${slot.slot}/${part.id} exceeds 40 KB`);
    total += png.length; count++;
    if (part.tintable) {
      const gray = await page.evaluate(async data => {
        const image = new Image(); image.src = `data:image/png;base64,${data}`;
        await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, 256, 256).data;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] && (pixels[index] !== pixels[index + 1] || pixels[index] !== pixels[index + 2])) return false;
        }
        return true;
      }, png.toString('base64'));
      assert.ok(gray, `${slot.slot}/${part.id} must be grayscale`);
    }
    for (const destination of [publicLayers, unityLayers]) {
      const path = resolve(destination, slot.slot, `${part.id}.png`);
      if (check) assert.deepEqual(await readFile(path), png, `${path} is stale`);
      else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, png); }
    }
  }
  assert.ok(total < 2 * 1024 * 1024, 'avatar PNG catalog exceeds 2 MB');
  if (check) assert.deepEqual(await readFile(unityManifest), manifestBytes);
  else { await mkdir(dirname(unityManifest), { recursive: true }); await writeFile(unityManifest, manifestBytes); }
  process.stdout.write(`${check ? 'Checked' : 'Built'} ${count} avatar layers (${Math.round(total / 1024)} KB).\n`);
} finally { await browser.close(); }
