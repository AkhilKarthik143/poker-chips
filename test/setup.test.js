import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('package provides the required commands', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  for (const command of ['start', 'dev', 'lint', 'test']) assert.equal(typeof pkg.scripts[command], 'string');
});
