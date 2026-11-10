const ratio = (numerator, denominator) => denominator ? numerator / denominator : 0;
export function aggregateStats(rows) {
  const total = field => rows.reduce((sum, row) => sum + (row[field] || 0), 0);
  const nights = rows.length;
  const net = total('net');
  const buyIn = total('buy_in');
  const handsPlayed = total('hands_played');
  const handsWon = total('hands_won');
  const showdowns = total('showdowns');
  let currentWinStreak = 0; let longestWinStreak = 0; let streak = 0;
  for (const row of [...rows].reverse()) {
    streak = row.net > 0 ? streak + 1 : 0;
    longestWinStreak = Math.max(longestWinStreak, streak);
  }
  for (const row of rows) { if (row.net > 0) currentWinStreak++; else break; }
  return { nights, net, buyIn, roi: ratio(net, buyIn),
    bestNight: nights ? Math.max(...rows.map(row => row.net)) : null,
    worstNight: nights ? Math.min(...rows.map(row => row.net)) : null,
    currentWinStreak, longestWinStreak, handsPlayed, handsWon,
    handWinPct: ratio(handsWon * 100, handsPlayed),
    vpipPct: ratio(total('vpip_hands') * 100, handsPlayed),
    pfrPct: ratio(total('pfr_hands') * 100, handsPlayed),
    aggression: total('calls') ? total('raises') / total('calls') : null,
    showdownWinPct: ratio(total('showdown_wins') * 100, showdowns) };
}
export function paginateNights(rows, page = 1, pageSize = 50) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  return { page: safePage, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / pageSize)),
    nights: rows.slice((safePage - 1) * pageSize, safePage * pageSize).map(row => ({
      nightId: row.night_id, endedAt: row.ended_at, roomCode: row.room_code,
      net: row.net, buyIn: row.buy_in, handsWon: row.hands_won, handsPlayed: row.hands_played
    })) };
}
