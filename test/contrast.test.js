import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('all theme color tokens meet text, button, border and focus contrast thresholds', () => {
  const output = execFileSync(process.execPath, ['scripts/check-contrast.js'], { encoding: 'utf8' });
  assert.match(output, /Contrast checks passed for 5 themes\./);
});
