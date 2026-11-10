import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { AVATAR_PARTS } from '../src/avatar-parts.js';
import { avatarForAccount, defaultAvatar, defaultAvatarV2, validAvatar } from '../src/identity.js';

test('v2 manifest enums agree in server, browser and Unity; generated files are current', () => {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../public/avatar-parts.js', import.meta.url), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.TablemateAvatarParts)), AVATAR_PARTS);
  const cs = readFileSync(new URL('../unity/AvatarCreator/Assets/Scripts/AvatarParts.cs', import.meta.url), 'utf8');
  for (const [slot, ids] of Object.entries(AVATAR_PARTS.parts)) {
    const name = slot[0].toUpperCase() + slot.slice(1);
    const match = cs.match(new RegExp(`string\\[\\] ${name} = \\{ ([^}]+) \\};`));
    assert.ok(match, name);
    assert.deepEqual([...match[1].matchAll(/"([^"]+)"/g)].map(found => found[1]), ids);
  }
  execFileSync(process.execPath, ['scripts/gen-avatar-enums.js', '--check'], { cwd: new URL('..', import.meta.url) });
});

test('v1 and v2 specs form a strict union and defaults are deterministic', () => {
  const v1 = defaultAvatar('account-id'); const v2 = defaultAvatarV2('account-id');
  assert.equal(validAvatar(v1), true); assert.equal(validAvatar(v2), true);
  assert.deepEqual(defaultAvatarV2('account-id'), v2);
  assert.deepEqual(avatarForAccount({ id: 'account-id', avatar_json: null }), v2);
  assert.deepEqual(avatarForAccount({ id: 'account-id', avatar_json: JSON.stringify(v1) }), v1);
  assert.deepEqual(avatarForAccount({ id: 'account-id', avatar_json: JSON.stringify(v2) }), v2);
  for (const invalid of [
    { ...v2, v: 3 }, { ...v2, hair: 'not-a-part' }, { ...v2, bg: '__proto__' },
    { ...v2, surprise: 'value' }, { ...v2, hairColor: '#ff0000' },
    { ...v2, extra: 'x'.repeat(600) }, { ...v1, v: 1 }
  ]) assert.equal(validAvatar(invalid), false);
});
