import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateStats, paginateNights } from '../src/stats.js';

test('lifetime stats handle streaks, zero denominators and night ordering', () => {
  const rows = [
    { night_id: 'c', ended_at: 3, room_code: 'CCCCCCCC', net: 50, buy_in: 100, hands_played: 10,
      hands_won: 2, vpip_hands: 3, pfr_hands: 1, raises: 2, calls: 0, showdowns: 2, showdown_wins: 1 },
    { night_id: 'b', ended_at: 2, room_code: 'BBBBBBBB', net: 20, buy_in: 100, hands_played: 0,
      hands_won: 0, vpip_hands: 0, pfr_hands: 0, raises: 0, calls: 0, showdowns: 0, showdown_wins: 0 },
    { night_id: 'a', ended_at: 1, room_code: 'AAAAAAAA', net: -30, buy_in: 100, hands_played: 10,
      hands_won: 1, vpip_hands: 2, pfr_hands: 1, raises: 1, calls: 0, showdowns: 1, showdown_wins: 1 }
  ];
  const stats = aggregateStats(rows);
  assert.equal(stats.nights, 3);
  assert.equal(stats.net, 40);
  assert.equal(stats.roi, 40 / 300);
  assert.equal(stats.currentWinStreak, 2);
  assert.equal(stats.longestWinStreak, 2);
  assert.equal(stats.vpipPct, 25);
  assert.equal(stats.aggression, null);
  assert.equal(stats.showdownWinPct, 200 / 3);
  assert.deepEqual(paginateNights(rows, 2, 1).nights.map(row => row.nightId), ['b']);
  assert.equal(aggregateStats([]).roi, 0);
  assert.equal(aggregateStats([]).vpipPct, 0);
});
