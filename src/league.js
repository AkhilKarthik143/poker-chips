import { RequestError } from './validation.js';

const fail = message => { throw new RequestError(message); };
const whole = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
function basisPoints(net, buyIn) {
  if (!buyIn) return 0;
  const sign = net < 0 ? -1 : 1;
  const numerator = BigInt(Math.abs(net)) * 10_000n;
  const denominator = BigInt(buyIn);
  const rounded = (numerator + denominator / 2n) / denominator;
  return sign * Number(rounded > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : rounded);
}
export function validateScoring(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid scoring rule.');
  const allowed = { net: ['type', 'dropWorst', 'minNightsPct'],
    points: ['type', 'table', 'participation', 'dropWorst', 'minNightsPct'],
    capped_net: ['type', 'capMultiple', 'dropWorst', 'minNightsPct'],
    roi: ['type', 'minNightsPct'] }[value.type];
  if (!allowed || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid scoring rule.');
  if (!whole(value.minNightsPct ?? 0, 0, 100) || !whole(value.dropWorst ?? 0, 0, 3)) fail('Invalid scoring option.');
  if (value.type === 'points') {
    if (!Array.isArray(value.table) || value.table.length < 1 || value.table.length > 10 ||
      !value.table.every(point => whole(point, 0, 1000)) || !whole(value.participation ?? 1, 0, 1000)) fail('Invalid points table.');
  }
  if (value.type === 'capped_net' && !whole(value.capMultiple, 1, 100)) fail('Invalid chip cap.');
  return structuredClone(value);
}

function scoredNight(rule, row, nightRows) {
  if (rule.type === 'points') {
    const tied = nightRows.filter(other => other.rank === row.rank).length;
    let sum = 0;
    for (let place = row.rank; place < row.rank + tied; place++) sum += rule.table[place - 1] ?? (rule.participation ?? 1);
    return Math.round(sum * 100 / tied);
  }
  if (rule.type === 'capped_net') {
    const cap = rule.capMultiple * row.buyIn;
    return Math.max(-cap, Math.min(cap, row.net)) * 100;
  }
  return row.net * 100;
}

export function computeStandings(season, results, members = []) {
  const rule = validateScoring(season.scoring);
  const counted = results.filter(row => row.counts !== false);
  const byNight = new Map();
  for (const row of counted) {
    const rows = byNight.get(row.nightId) || [];
    rows.push(row); byNight.set(row.nightId, rows);
  }
  const seasonNights = byNight.size;
  const people = new Map(members.map(member => [member.memberId, member]));
  for (const row of counted) if (!people.has(row.memberId)) people.set(row.memberId, row);
  const standings = [...people.values()].map(member => {
    const played = counted.filter(row => row.memberId === member.memberId);
    const net = played.reduce((sum, row) => sum + row.net, 0);
    const buyIn = played.reduce((sum, row) => sum + row.buyIn, 0);
    const perNight = played.map(row => scoredNight(rule, row, byNight.get(row.nightId)));
    const drop = Math.min(rule.dropWorst ?? 0, Math.max(0, perNight.length - 1));
    const retained = [...perNight].sort((a, b) => a - b).slice(drop);
    const score = rule.type === 'roi' ? basisPoints(net, buyIn) : retained.reduce((sum, value) => sum + value, 0);
    return { memberId: member.memberId, displayName: member.displayName, rank: 0, score,
      nights: played.length, wins: played.filter(row => row.rank === 1).length, net,
      roi: basisPoints(net, buyIn),
      qualified: seasonNights === 0 ? (rule.minNightsPct ?? 0) === 0 : played.length * 100 >= seasonNights * (rule.minNightsPct ?? 0),
      former: Boolean(member.former), delta: 0 };
  });
  standings.sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.score - a.score || b.wins - a.wins ||
    b.net - a.net || b.nights - a.nights || a.displayName.localeCompare(b.displayName) || a.memberId.localeCompare(b.memberId));
  standings.forEach((row, index) => { row.rank = index + 1; });
  if (seasonNights > 1) {
    const latest = [...byNight.entries()].sort((a, b) => Math.max(...b[1].map(row => row.endedAt)) - Math.max(...a[1].map(row => row.endedAt)))[0][0];
    const prior = computeStandings({ ...season, scoring: rule }, counted.filter(row => row.nightId !== latest), members);
    const priorRanks = new Map(prior.map(row => [row.memberId, row.rank]));
    standings.forEach(row => { row.delta = (priorRanks.get(row.memberId) ?? row.rank) - row.rank; });
  }
  return standings;
}

export function recordsFromResults(results, members = []) {
  const counted = results.filter(row => row.counts !== false);
  if (!counted.length) return { biggestNight: null, mostWins: null, bestAttendance: null, longestStreak: null };
  const byMember = new Map(members.map(member => [member.memberId, { ...member, rows: [] }]));
  for (const row of counted) {
    if (!byMember.has(row.memberId)) byMember.set(row.memberId, { memberId: row.memberId, displayName: row.displayName, rows: [] });
    byMember.get(row.memberId).rows.push(row);
  }
  const people = [...byMember.values()].map(member => {
    const rows = member.rows.sort((a, b) => a.endedAt - b.endedAt);
    let streak = 0; let longest = 0;
    for (const row of rows) { streak = row.net > 0 ? streak + 1 : 0; longest = Math.max(longest, streak); }
    return { memberId: member.memberId, displayName: member.displayName, nights: rows.length,
      wins: rows.filter(row => row.rank === 1).length, longestStreak: longest };
  });
  const allNights = new Set(counted.map(row => row.nightId)).size;
  const by = (field, rows) => [...rows].sort((a, b) => b[field] - a[field] || a.displayName.localeCompare(b.displayName))[0];
  return { biggestNight: by('net', counted), mostWins: by('wins', people),
    bestAttendance: by('nights', people) && { ...by('nights', people), pct: Math.round(by('nights', people).nights * 100 / allNights) },
    longestStreak: by('longestStreak', people) };
}
