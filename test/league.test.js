import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, validateScoring, recordsFromResults } from '../src/league.js';

const members = [
  { memberId: 'a', displayName: 'Alex' }, { memberId: 'b', displayName: 'Blair' },
  { memberId: 'c', displayName: 'Casey' }
];
const results = [
  { nightId: 'one', endedAt: 1, memberId: 'a', displayName: 'Alex', rank: 1, net: 60, buyIn: 100 },
  { nightId: 'one', endedAt: 1, memberId: 'b', displayName: 'Blair', rank: 2, net: -20, buyIn: 100 },
  { nightId: 'one', endedAt: 1, memberId: 'c', displayName: 'Casey', rank: 3, net: -40, buyIn: 100 },
  { nightId: 'two', endedAt: 2, memberId: 'a', displayName: 'Alex', rank: 2, net: -50, buyIn: 100 },
  { nightId: 'two', endedAt: 2, memberId: 'b', displayName: 'Blair', rank: 1, net: 50, buyIn: 100 }
];

test('scoring rules validate strictly and freeze integer hundredth point calculations', () => {
  assert.throws(() => validateScoring({ type: 'roi', dropWorst: 1 }), /Invalid/);
  assert.throws(() => validateScoring({ type: 'points', table: [] }), /Invalid/);
  assert.throws(() => validateScoring({ type: 'net', arbitrary: 1 }), /Invalid/);
  const points = computeStandings({ scoring: { type: 'points', table: [10, 7, 5], participation: 1 } }, results, members);
  assert.deepEqual(points.map(row => [row.memberId, row.score, row.nights]), [['b', 1700, 2], ['a', 1700, 2], ['c', 500, 1]]);
  assert.equal(points[0].delta, 1);
  assert.equal(points[1].delta, -1);
  const dropped = computeStandings({ scoring: { type: 'points', table: [10, 7, 5], dropWorst: 1 } }, results, members);
  assert.deepEqual(dropped.map(row => row.score), [1000, 1000, 500]);
  assert.equal(computeStandings({ scoring: { type: 'net' } }, results, members)[0].memberId, 'b');
  assert.equal(computeStandings({ scoring: { type: 'capped_net', capMultiple: 1 } }, results, members)[0].memberId, 'b');
  assert.equal(computeStandings({ scoring: { type: 'roi' } }, results, members)[0].score, 1500);
});

test('points ties average occupied places, qualification and records ignore voided nights', () => {
  const tie = [
    { nightId: 'tie', endedAt: 1, memberId: 'a', displayName: 'Alex', rank: 1, net: 10, buyIn: 100 },
    { nightId: 'tie', endedAt: 1, memberId: 'b', displayName: 'Blair', rank: 1, net: 10, buyIn: 100 },
    { nightId: 'tie', endedAt: 1, memberId: 'c', displayName: 'Casey', rank: 3, net: -20, buyIn: 100 }
  ];
  const rows = computeStandings({ scoring: { type: 'points', table: [10, 7, 5] } }, tie, members);
  assert.deepEqual(rows.map(row => row.score), [850, 850, 500]);
  const qualified = computeStandings({ scoring: { type: 'points', table: [10, 7, 5], minNightsPct: 100 } }, results, members);
  assert.equal(qualified.at(-1).qualified, false);
  const records = recordsFromResults([...results, { ...tie[0], nightId: 'void', counts: false }], members);
  assert.equal(records.biggestNight.net, 60);
  assert.equal(records.longestStreak.longestStreak, 1);
});
