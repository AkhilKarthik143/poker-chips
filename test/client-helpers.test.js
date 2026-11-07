import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const sandbox = {};
runInNewContext(readFileSync(new URL('../public/helpers.js', import.meta.url), 'utf8'), { globalThis: sandbox });
const helpers = sandbox.Tablemate;

test('classic client helpers load without browser APIs and share one namespace', () => {
  assert.deepEqual(Object.keys(helpers).sort(), ['alertTransition', 'dedupeAlert', 'loadPrefs', 'moveItem', 'reconcileOrder', 'resolveTheme', 'savePrefs'].sort());
  assert.deepEqual([...helpers.moveItem(['a', 'b', 'c'], 0, 2)], ['b', 'c', 'a']);
  assert.deepEqual([...helpers.reconcileOrder(['c', 'a', 'a', 'gone'], ['a', 'b', 'c'])], ['c', 'a', 'b']);
});

test('alert transition announces a newly received turn only once and ignores stale revisions', () => {
  const waiting = { roomCode: 'TABLEAAA', revision: 4, turn: 'b', street: 'preflop' };
  const acting = { ...waiting, revision: 5, turn: 'a' };
  assert.equal(helpers.alertTransition(waiting, acting, 'a', true).alert, 'yourTurn');
  assert.equal(helpers.alertTransition(acting, { ...acting, revision: 6 }, 'a', true).alert, null);
  assert.equal(helpers.alertTransition(acting, { ...waiting, revision: 3, turn: 'a' }, 'a', true).alert, null);
  assert.equal(helpers.alertTransition(waiting, acting, 'a', false).alert, null);
});

test('win alerts require a live transition, a positive award and one alert per hand', () => {
  const before = { roomCode: 'TABLEAAA', revision: 4, handNumber: 8, street: 'showdown' };
  const completed = { ...before, revision: 5, street: 'complete', lastResult: { awards: [{ id: 'a', amount: 25 }] } };
  const first = helpers.alertTransition(before, completed, 'a', true);
  assert.equal(first.alert, 'win');
  assert.equal(helpers.alertTransition(completed, completed, 'a', true, first.seenHands).alert, null);
  assert.equal(helpers.alertTransition(null, completed, 'a', true).alert, null);
  assert.equal(helpers.alertTransition(before, { ...completed, lastResult: { awards: [{ id: 'a', amount: 0 }] } }, 'a', true).alert, null);
  assert.equal(helpers.dedupeAlert('same', ['same']).fresh, false);
});

test('preference storage merges defaults and tolerates malformed or unavailable storage', () => {
  const values = new Map([['prefs', '{"sound":false}']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual({ ...helpers.loadPrefs(storage, 'prefs', { sound: true, vibration: true }) }, { sound: false, vibration: true });
  assert.equal(helpers.savePrefs(storage, 'prefs', { sound: true }), true);
  assert.deepEqual({ ...helpers.loadPrefs(storage, 'prefs', {}) }, { sound: true });
  assert.deepEqual({ ...helpers.loadPrefs({ getItem: () => '{bad' }, 'bad', { sound: true }) }, { sound: true });
  assert.equal(helpers.savePrefs({ setItem: () => { throw Error('blocked'); } }, 'bad', {}), false);
});

test('theme resolution applies a safe default and resolves system preference', () => {
  assert.equal(helpers.resolveTheme('unrecognized'), 'felt');
  assert.equal(helpers.resolveTheme('burgundy'), 'burgundy');
  assert.equal(helpers.resolveTheme('system', true), 'midnight');
  assert.equal(helpers.resolveTheme('system', false), 'felt');
});
