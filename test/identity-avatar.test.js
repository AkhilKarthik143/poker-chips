import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { AVATAR_ENUMS, avatarForAccount, defaultAvatar, defaultAvatarV2, validAvatar } from '../src/identity.js';

class Node {
  constructor(tag) { this.tag = tag; this.attributes = new Map(); this.children = []; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  append(...children) { this.children.push(...children); }
  get outerHTML() { return `<${this.tag}${[...this.attributes].map(([key, value]) => ` ${key}="${value}"`).join('')}>${this.children.map(child => child.outerHTML).join('')}</${this.tag}>`; }
}
function clientAvatar() {
  const context = { window: {}, document: { createElementNS: (_ns, tag) => new Node(tag) } };
  vm.runInNewContext(readFileSync(new URL('../public/avatar.js', import.meta.url), 'utf8'), context);
  return context.window.TablemateAvatar;
}

test('server and client avatar enums agree; unknown fields and values fail closed', () => {
  const avatar = clientAvatar();
  for (const key of Object.keys(AVATAR_ENUMS)) assert.deepEqual([...avatar.enums[key]], [...AVATAR_ENUMS[key]]);
  const base = defaultAvatar('account-id');
  assert.equal(validAvatar(base), true);
  assert.equal(avatar.valid(base), true);
  assert.equal(validAvatar({ ...base, bg: 'hotpink' }), false);
  assert.equal(validAvatar({ ...base, extra: '<img>' }), false);
  assert.equal(avatar.valid({ ...base, icon: 'unknown' }), false);
  assert.deepEqual(defaultAvatar('account-id'), defaultAvatar('account-id'));
  assert.deepEqual(avatarForAccount({ id: 'account-id', avatar_json: '{"icon":"retired-icon"}' }), defaultAvatarV2('account-id'),
    'an older avatar document falls back to the same deterministic default');
});

test('SVG avatar rendering is deterministic, labeled, and contains only closed classes', () => {
  const avatar = clientAvatar();
  const spec = { shape: 'hex', icon: 'spade', bg: 'c3', accent: 'c10', pattern: 'chevrons', frame: 'double' };
  const first = avatar.renderAvatar(spec, 64, 'Alex').outerHTML;
  assert.equal(first, avatar.renderAvatar(spec, 64, 'Alex').outerHTML);
  assert.match(first, /role="img" aria-label="Avatar of Alex"/);
  assert.match(first, /av-bg-c3/); assert.match(first, /av-accent-c10/);
  assert.match(first, /avatars\.svg#spade/);
  assert.doesNotMatch(first, /style=|fill="var\(|<script/i);
  assert.equal((first.match(/av-frame/g) || []).length >= 2, true);
});
