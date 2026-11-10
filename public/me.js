/* global document, fetch, localStorage, window, Blob, URL */
(() => {
const $ = selector => document.querySelector(selector);
const number = value => Number(value).toLocaleString();
const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
const pct = value => `${Number(value).toFixed(1)}%`;
let page = 1;
async function load() {
  const [accountResponse, statsResponse] = await Promise.all([fetch('/api/me'), fetch(`/api/me/stats?page=${page}`)]);
  if (accountResponse.status === 401) { window.location.assign('/login.html'); return; }
  if (!accountResponse.ok || !statsResponse.ok) { $('#nights-list').textContent = 'Could not load stats. Try again later.'; return; }
  const account = await accountResponse.json();
  const data = await statsResponse.json();
  $('#profile-name').textContent = account.displayName;
  renderStats(data.lifetime);
  renderChart(data.trend);
  renderNights(data);
  showClaims();
}
function renderStats(stats) {
  const items = [
    ['Nights played', number(stats.nights)], ['Lifetime net', signed(stats.net) + ' chips'],
    ['ROI', pct(stats.roi * 100)], ['Best night', stats.bestNight === null ? '—' : signed(stats.bestNight)],
    ['Worst night', stats.worstNight === null ? '—' : signed(stats.worstNight)],
    ['Winning streak', number(stats.currentWinStreak)], ['Longest streak', number(stats.longestWinStreak)],
    ['Hands won', `${number(stats.handsWon)} / ${number(stats.handsPlayed)}`],
    ['VPIP', pct(stats.vpipPct)], ['PFR', pct(stats.pfrPct)],
    ['Aggression', stats.aggression === null ? '—' : stats.aggression.toFixed(2)],
    ['Showdown wins', pct(stats.showdownWinPct)]
  ];
  const grid = $('#stat-grid'); grid.replaceChildren();
  for (const [label, value] of items) {
    const tile = document.createElement('div'); tile.className = 'stat-tile';
    const key = document.createElement('span'); key.textContent = label;
    const figure = document.createElement('strong'); figure.textContent = value;
    tile.append(key, figure); grid.append(tile);
  }
}
function renderChart(trend) {
  const svg = $('#net-chart'); svg.replaceChildren();
  if (!trend.length) { svg.setAttribute('aria-label', 'No nights yet'); return; }
  const values = [0, ...trend.map(point => point.net)];
  const low = Math.min(...values); const high = Math.max(...values); const span = high - low || 1;
  const y = value => 160 - (value - low) / span * 140;
  const ns = 'http://www.w3.org/2000/svg';
  const baseline = document.createElementNS(ns, 'line');
  baseline.setAttribute('x1', '20'); baseline.setAttribute('x2', '660');
  baseline.setAttribute('y1', String(y(0))); baseline.setAttribute('y2', String(y(0)));
  baseline.setAttribute('class', 'chart-zero'); svg.append(baseline);
  const path = document.createElementNS(ns, 'path');
  const points = [{ net: 0 }, ...trend];
  path.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'}${20 + index / Math.max(1, points.length - 1) * 640} ${y(point.net)}`).join(' '));
  path.setAttribute('class', 'chart-line'); svg.append(path);
  svg.setAttribute('aria-label', `Cumulative net chips after ${trend.length} nights: ${signed(trend.at(-1).net)}`);
}
function renderNights(data) {
  const list = $('#nights-list'); list.replaceChildren();
  if (!data.nights.length) { list.textContent = 'No saved nights yet. Play as a guest or with an account, then end the night.'; }
  for (const night of data.nights) {
    const card = document.createElement('article'); card.className = 'night-row';
    const when = document.createElement('span'); when.textContent = new Date(night.endedAt).toLocaleDateString();
    const room = document.createElement('span'); room.textContent = `Table ${night.roomCode}`;
    const net = document.createElement('strong'); net.textContent = `${night.net >= 0 ? '↑' : '↓'} ${signed(night.net)} chips`;
    net.className = night.net >= 0 ? 'positive' : 'negative';
    const hands = document.createElement('span'); hands.textContent = `${number(night.handsWon)} of ${number(night.handsPlayed)} hands won`;
    card.append(when, room, net, hands); list.append(card);
  }
  $('#page-label').textContent = `${data.page} of ${data.pages}`;
  $('#previous-page').disabled = data.page <= 1;
  $('#next-page').disabled = data.page >= data.pages;
}
function deviceClaims() {
  try {
    const value = JSON.parse(localStorage.getItem('tablemate-nights-v1') || '[]');
    return Array.isArray(value) ? value.filter(item => item && typeof item.nightId === 'string' && typeof item.token === 'string').slice(0, 20) : [];
  } catch { return []; }
}
function showClaims() {
  const claims = deviceClaims();
  $('#claim-banner').hidden = !claims.length;
  $('#claim-count').textContent = `${claims.length} night${claims.length === 1 ? '' : 's'} saved on this device can be checked for your account.`;
}
$('#claim-button').addEventListener('click', async () => {
  const claims = deviceClaims().map(({ nightId, token }) => ({ nightId, token }));
  const response = await fetch('/api/nights/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claims }) });
  if (!response.ok) { $('#claim-status').textContent = 'Could not claim nights. Try again.'; return; }
  const result = await response.json();
  $('#claim-status').textContent = `${result.claimed} claimed · ${result.skipped} already claimed or unavailable.`;
  if (result.claimed) load();
});
$('#previous-page').addEventListener('click', () => { page--; load(); });
$('#next-page').addEventListener('click', () => { page++; load(); });
$('#export-data').addEventListener('click', async () => {
  const response = await fetch('/api/me/export');
  if (!response.ok) { $('#privacy-status').textContent = 'Export failed. Try again.'; return; }
  const data = await response.json();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'tablemate-data.json';
  link.click(); URL.revokeObjectURL(url);
});
$('#delete-data').addEventListener('click', async () => {
  if (!window.confirm('Delete your account and sign out? Your friends’ anonymous night totals will remain.')) return;
  const response = await fetch('/api/me', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' }) });
  if (response.ok) window.location.assign('/');
  else $('#privacy-status').textContent = 'Deletion failed. Try again.';
});
load();
})();
