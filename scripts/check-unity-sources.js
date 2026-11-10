import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const project = join(root, 'unity/AvatarCreator');
const manifest = JSON.parse(await readFile(join(root, 'avatar-art/manifest.json'), 'utf8'));
const dirs = ['Assets/Scripts', 'Assets/Editor'];
const required = ['AvatarParts.cs', 'AvatarSpec.cs', 'Catalog.cs', 'LayerCompositor.cs',
  'IdleAnimator.cs', 'CreatorUI.cs', 'Bootstrap.cs', 'WebBridge.cs',
  'LayerImportPostprocessor.cs', 'BuildScript.cs'];
const seen = new Set();
for (const dir of dirs) for (const name of await readdir(join(project, dir))) {
  if (!name.endsWith('.cs')) continue;
  seen.add(name);
  const source = await readFile(join(project, dir, name), 'utf8');
  assert.match(source, /^using [\w.]+;/m, `${name} needs using directives`);
  const clean = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
  const pairs = new Map([['{', '}'], ['(', ')'], ['[', ']']]); const stack = [];
  for (const char of clean) {
    if (pairs.has(char)) stack.push(pairs.get(char));
    else if ([...pairs.values()].includes(char)) assert.equal(stack.pop(), char, `${name} has unbalanced delimiters`);
  }
  assert.equal(stack.length, 0, `${name} has unclosed delimiters`);
  assert.equal((source.match(/^\s*#if\b/gm) || []).length, (source.match(/^\s*#endif\b/gm) || []).length,
    `${name} has unmatched conditional compilation`);
  assert.doesNotMatch(source, /guid:\s*[a-f0-9]{32}/i, `${name} must not require authored meta GUIDs`);
}
for (const name of required) assert.ok(seen.has(name), `${name} is missing`);
for (const slot of manifest.slots) for (const part of slot.parts) {
  const path = join(project, 'Assets/Resources/AvatarLayers', slot.slot, `${part.id}.png`);
  assert.equal((await stat(path)).size > 0, true, `${path} missing`);
}
const version = await readFile(join(project, 'ProjectSettings/ProjectVersion.txt'), 'utf8');
assert.match(version, /m_EditorVersion: 6000\.3\./);
execFileSync(process.execPath, ['scripts/gen-avatar-enums.js', '--check'], { cwd: root });
process.stdout.write(`Unity source structure checked: ${seen.size} C# files and ${manifest.slots.reduce((n, slot) => n + slot.parts.length, 0)} Resources sprites.\n`);
