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

test('capped net and ROI use buy-ins, and drop-worst retains one counted night', () => {
  const extreme = [
    { nightId: 'one', endedAt: 1, memberId: 'a', displayName: 'Alex', rank: 1, net: 1000, buyIn: 100 },
    { nightId: 'one', endedAt: 1, memberId: 'b', displayName: 'Blair', rank: 2, net: -1000, buyIn: 100 },
    { nightId: 'two', endedAt: 2, memberId: 'a', displayName: 'Alex', rank: 2, net: -50, buyIn: 100 },
    { nightId: 'two', endedAt: 2, memberId: 'b', displayName: 'Blair', rank: 1, net: 50, buyIn: 0 }
  ];
  const capped = computeStandings({ scoring: { type: 'capped_net', capMultiple: 5 } }, extreme, members);
  assert.equal(capped.find(row => row.memberId === 'a').score, 45_000);
  assert.equal(capped.find(row => row.memberId === 'b').score, -50_000, 'zero buy-in caps that night at zero');
  const roi = computeStandings({ scoring: { type: 'roi' } }, extreme, members);
  assert.equal(roi.find(row => row.memberId === 'a').score, 47_500);
  assert.equal(roi.find(row => row.memberId === 'c').score, 0, 'no buy-in has no division error');
  const dropped = computeStandings({ scoring: { type: 'points', table: [10, 7], dropWorst: 3 } }, extreme, members);
  assert.equal(dropped.find(row => row.memberId === 'a').score, 1000, 'at least one night remains');
  assert.throws(() => validateScoring({ type: 'roi', dropWorst: 0 }), /Invalid/);
});

test('all-tied standings use stable name ordering and attendance qualification', () => {
  const tied = [
    { nightId: 'tie', endedAt: 1, memberId: 'c', displayName: 'Casey', rank: 1, net: 0, buyIn: 100 },
    { nightId: 'tie', endedAt: 1, memberId: 'a', displayName: 'Alex', rank: 1, net: 0, buyIn: 100 },
    { nightId: 'tie', endedAt: 1, memberId: 'b', displayName: 'Blair', rank: 1, net: 0, buyIn: 100 }
  ];
  const standings = computeStandings({ scoring: { type: 'points', table: [10, 7, 5], minNightsPct: 100 } }, tied, members);
  assert.deepEqual(standings.map(row => [row.memberId, row.score, row.qualified]),
    [['a', 733, true], ['b', 733, true], ['c', 733, true]]);
  assert.deepEqual(computeStandings({ scoring: { type: 'net', minNightsPct: 60 } }, [], members)
    .map(row => row.qualified), [false, false, false]);
});
