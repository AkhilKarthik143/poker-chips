import assert from 'node:assert/strict';
import { readdir, readFile, cp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'unity/AvatarCreator/Builds/WebGL');
const destination = join(root, 'public/avatar-creator');
const index = await readFile(join(source, 'index.html'), 'utf8');
assert.doesNotMatch(index, /\{\{\{/i, 'Unity template variables were not resolved');
for (const name of ['loader.js', 'return-path.js', 'style.css'])
  assert.ok((await stat(join(source, name))).size > 0, `${name} is missing`);
const buildFiles = await readdir(join(source, 'Build'));
for (const suffix of ['.loader.js', '.data.gz', '.framework.js.gz', '.wasm.gz'])
  assert.ok(buildFiles.some(file => file.endsWith(suffix)), `Unity output missing ${suffix}`);
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
process.stdout.write(`Installed Unity WebGL build in ${destination}.\n`);
