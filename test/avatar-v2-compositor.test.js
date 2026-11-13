import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { AVATAR_PARTS } from '../src/avatar-parts.js';
import { defaultAvatarV2 } from '../src/identity.js';

function browserAvatar() {
  const window = { TablemateAvatarParts: AVATAR_PARTS };
  const context = { window, document: {} };
  vm.runInNewContext(readFileSync(new URL('../public/avatar-v2.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(readFileSync(new URL('../public/avatar.js', import.meta.url), 'utf8'), context);
  return window;
}

test('v2 compositor key is order-independent and layers follow manifest z-order', () => {
  const window = browserAvatar(); const spec = defaultAvatarV2('test');
  assert.equal(window.AvatarV2.specKey(spec), window.AvatarV2.specKey(Object.fromEntries(Object.entries(spec).reverse())));
  const layers = window.AvatarV2.layersFor(spec);
  assert.deepEqual(Array.from(layers, layer => layer.slot), AVATAR_PARTS.layers.map(layer => layer.slot));
  assert.deepEqual(Array.from(layers, layer => layer.zOrder), AVATAR_PARTS.layers.map(layer => layer.zOrder));
  assert.equal(layers.find(layer => layer.slot === 'body').tint, AVATAR_PARTS.skinTones[spec.skin]);
  assert.equal(layers.find(layer => layer.slot === 'hat').id, spec.hat);
  assert.equal(layers.find(layer => layer.slot === 'brows').id, 'none', 'saved avatars without brows keep their old appearance');
  assert.equal(layers.find(layer => layer.slot === 'body').id, 'base', 'saved avatars without face keep their old shape');
  assert.equal(layers.find(layer => layer.slot === 'nose').id, 'none', 'saved avatars without nose keep their old appearance');
  assert.equal(window.AvatarV2.layersFor({ ...spec, brows: 'raised' }).find(layer => layer.slot === 'brows').id, 'raised');
});

test('avatar dispatch uses the canvas compositor for v2 and leaves v1 builder intact', () => {
  const window = browserAvatar(); const spec = defaultAvatarV2('test');
  window.AvatarV2 = { render: () => ({ kind: 'canvas' }) };
  assert.equal(window.TablemateAvatar.valid(spec), true);
  assert.equal(window.TablemateAvatar.valid({ ...spec, brows: 'raised' }), true);
  assert.equal(window.TablemateAvatar.valid({ ...spec, brows: 'remote.png' }), false);
  assert.equal(window.TablemateAvatar.renderAvatar(spec, 64, 'Alex').kind, 'canvas');
  assert.equal(window.TablemateAvatar.valid({ ...spec, hat: 'remote.png' }), false);
  assert.equal(window.TablemateAvatar.defaults.icon, 'chip');
});
