/* global document, window */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { defaultAvatarV2, validAvatarV2 } from '../src/identity.js';

const base = defaultAvatarV2('contact-sheet');
const choices = [
  ['Classic', { face: 'base', nose: 'none', brows: 'none', hair: 'crop', eyes: 'round', mouth: 'smile', hat: 'none', glasses: 'none' }],
  ['Round & relaxed', { face: 'round', nose: 'button', brows: 'soft', hair: 'waves', eyes: 'sleepy', mouth: 'smirk', hat: 'none' }],
  ['Angular', { face: 'angular', nose: 'soft', brows: 'focused', hair: 'sweep', eyes: 'round', mouth: 'neutral', hat: 'none' }],
  ['Big smile', { face: 'round', nose: 'button', brows: 'raised', hair: 'afro', eyes: 'happy', mouth: 'laugh', hat: 'none' }],
  ['Surprised', { face: 'base', nose: 'soft', brows: 'raised', hair: 'bob', eyes: 'surprised', mouth: 'grin', hat: 'none' }],
  ['Bald & beard', { face: 'angular', nose: 'button', brows: 'focused', hair: 'bald', facialHair: 'beard', eyes: 'round', hat: 'none' }],
  ['Glasses', { face: 'round', nose: 'soft', brows: 'soft', hair: 'pixie', glasses: 'rounds', hat: 'none' }],
  ['Hat & curls', { face: 'base', nose: 'button', brows: 'playful', hair: 'curls', hat: 'beanie', eyes: 'wink' }],
  ['Braids', { face: 'round', nose: 'soft', brows: 'soft', hair: 'braids', eyes: 'happy', hat: 'none' }],
  ['Ponytail', { face: 'angular', nose: 'button', brows: 'focused', hair: 'ponytail', mouth: 'smile', hat: 'none' }],
  ['Jacket', { face: 'base', nose: 'soft', brows: 'raised', hair: 'mohawk', outfit: 'jacket', hat: 'none' }],
  ['Formal', { face: 'round', nose: 'button', brows: 'playful', hair: 'crop', outfit: 'blazer', hat: 'none' }]
].map(([label, changes], index) => [label, { ...base, skin: `s${index % 8 + 1}`, hairColor: `c${index % 12 + 1}`,
  outfitColor: `c${(index + 4) % 12 + 1}`, facialHairColor: `c${index % 12 + 1}`, ...changes }]);
for (const [, spec] of choices) if (!validAvatarV2(spec)) throw new Error(`Invalid contact-sheet spec: ${JSON.stringify(spec)}`);
const server = createServer({ store: new SqliteStore(':memory:') });
const { port } = await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 880 }, deviceScaleFactor: 1 });
  const qaCss = 'body{margin:0;background:#f8f6ed;color:#243047;font:16px system-ui}#avatar-qa-sheet{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:12px;padding:16px;max-width:none!important;width:100%!important;box-sizing:border-box}#avatar-qa-sheet>.qa-card{grid-column:auto!important;min-width:0;width:auto!important;background:#fff;border:2px solid #243047;border-radius:16px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px}#avatar-qa-sheet .qa-card strong{font-size:13px}#avatar-qa-sheet .qa-sizes{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;min-height:48px}';
  await page.route('**/qa-contact-sheet.css', route => route.fulfill({ contentType: 'text/css', body: qaCss }));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(choices => {
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet';
    stylesheet.href = '/qa-contact-sheet.css'; document.head.append(stylesheet);
    const sheet = document.createElement('main'); sheet.id = 'avatar-qa-sheet';
    for (const [label, spec] of choices) {
      const card = document.createElement('section'); card.className = 'qa-card';
      card.append(window.AvatarV2.render(spec, 160, label));
      const name = document.createElement('strong'); name.textContent = label; card.append(name);
      const sizes = document.createElement('div'); sizes.className = 'qa-sizes';
      for (const size of [32, 40, 56, 96]) sizes.append(window.AvatarV2.render(spec, size, label));
      card.append(sizes); sheet.append(card);
    }
    document.body.replaceChildren(sheet);
  }, choices);
  await page.locator('link[href="/qa-contact-sheet.css"]').evaluate(link => new Promise((resolve, reject) => {
    if (link.sheet) resolve(); else { link.addEventListener('load', resolve, { once: true }); link.addEventListener('error', reject, { once: true }); }
  }));
  await page.waitForFunction(() => window.AvatarV2.stats().compositions === 12);
  await mkdir(new URL('../artifacts/qa/', import.meta.url), { recursive: true });
  const path = new URL('../artifacts/qa/avatar-contact-sheet.png', import.meta.url).pathname;
  await page.locator('#avatar-qa-sheet').screenshot({ path });
  process.stdout.write(`Saved 12-character avatar contact sheet: ${path}\n`);
} finally { await browser.close(); await server.close(); }
