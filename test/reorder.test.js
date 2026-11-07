import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const browser = {};
runInNewContext(readFileSync(new URL('../public/helpers.js', import.meta.url), 'utf8'), { globalThis: browser });
const { moveItem, reconcileOrder } = browser.Tablemate;

test('moveItem inserts a player at the requested seat without mutating the draft', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual([...moveItem(order, 0, 3)], ['b', 'c', 'd', 'a']);
  assert.deepEqual([...moveItem(order, 3, 1)], ['a', 'd', 'b', 'c']);
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);
});

test('moveItem safely ignores an unchanged or out-of-range move', () => {
  assert.deepEqual([...moveItem(['a', 'b'], 0, 0)], ['a', 'b']);
  assert.deepEqual([...moveItem(['a', 'b'], 0, 3)], ['a', 'b']);
});

test('reconcileOrder keeps the draft order, removes departed players and appends arrivals', () => {
  assert.deepEqual([...reconcileOrder(['c', 'a', 'b'], ['a', 'c', 'd'])], ['c', 'a', 'd']);
});
