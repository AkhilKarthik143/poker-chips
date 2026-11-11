/* global document, fetch, localStorage, window, navigator, Blob, URL */
(() => {
const $ = selector => document.querySelector(selector);
const number = value => Number(value).toLocaleString();
const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
const pct = value => `${Number(value).toFixed(1)}%`;
let page = 1;
let profileAccount;
function renderAvatarPreview() {
  if (!profileAccount) return;
  $('#profile-avatar-preview').replaceChildren(window.TablemateAvatar.renderAvatar(profileAccount.avatar, 72, profileAccount.displayName));
  $('#avatar-description').textContent = window.TablemateAvatar.describe(profileAccount.avatar);
  $('#remove-avatar-photo').hidden = profileAccount.avatar?.v !== 3;
}
function renderProfileForm() {
  if (!profileAccount) return;
  $('#identity-panel').hidden = false;
  $('#profile-username').value = profileAccount.username || '';
  $('#profile-display-name').value = profileAccount.displayName;
  $('#profile-visibility').value = profileAccount.privacy.profileVisibility;
  $('#show-username-tables').checked = profileAccount.privacy.showUsernameAtTables;
  $('#show-avatar-tables').checked = profileAccount.privacy.showAvatarAtTables;
  const locked = profileAccount.username && profileAccount.usernameChangeAvailableAt > Date.now();
  $('#username-cooldown').textContent = locked ? `Your next username change is available ${new Date(profileAccount.usernameChangeAvailableAt).toLocaleDateString()}. You may still switch back to a previous name.`
    : '3–20 letters, numbers or underscores. Start with a letter. Changes are limited to once every 30 days.';
}
async function load() {
  const [accountResponse, statsResponse, configResponse] = await Promise.all([fetch('/api/me'), fetch(`/api/me/stats?page=${page}`), fetch('/api/config')]);
  if (accountResponse.status === 401) { window.location.assign('/login.html'); return; }
  if (!accountResponse.ok || !statsResponse.ok) { $('#nights-list').textContent = 'Could not load stats. Try again later.'; return; }
  const account = await accountResponse.json();
  const config = configResponse.ok ? await configResponse.json() : {};
  if (config.avatarCreator) {
    const lowMemory = Number(navigator.deviceMemory) > 0 && Number(navigator.deviceMemory) < 4;
    $('#character-creator-link').hidden = false;
    $('#character-creator-link').textContent = lowMemory ? 'Use full creator' : 'Customize character';
    $('#character-creator-note').hidden = !lowMemory;
    if (lowMemory) $('#character-creator-note').textContent = 'The full creator uses more memory. The simple builder works on this device.';
  }
  profileAccount = account; renderAvatarPreview(); renderProfileForm();
  const data = await statsResponse.json();
  $('#profile-name').textContent = account.displayName;
  renderStats(data.lifetime);
  renderChart(data.trend);
  renderNights(data);
  showClaims();
  loadLeagues();
}
$('#edit-avatar').addEventListener('click', () => {
  if (!profileAccount) return;
  const dialog = $('#avatar-builder-dialog');
  window.TablemateAvatar.mountBuilder($('#avatar-builder-body'), profileAccount.avatar, profileAccount.displayName, async avatar => {
    const response = await fetch('/api/me/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save avatar.');
    profileAccount = result; renderAvatarPreview(); $('#identity-status').textContent = 'Avatar saved.'; dialog.close();
  });
  dialog.showModal(); dialog.querySelector('#avatar-builder-body button')?.focus();
});
$('#close-avatar-builder').addEventListener('click', () => $('#avatar-builder-dialog').close());
$('#avatar-photo').addEventListener('change', async event => {
  const input = event.currentTarget; const file = input.files?.[0]; if (!file) return;
  const status = $('#avatar-photo-status'); input.disabled = true; status.textContent = 'Uploading photo…';
  try {
    profileAccount = await window.TablematePhotoAvatar.upload(file);
    renderAvatarPreview(); status.textContent = 'Photo avatar saved.';
  } catch (error) { status.textContent = error.message; }
  finally { input.value = ''; input.disabled = false; }
});
$('#remove-avatar-photo').addEventListener('click', async event => {
  const button = event.currentTarget; const status = $('#avatar-photo-status');
  button.disabled = true; status.textContent = 'Removing photo…';
  try {
    profileAccount = await window.TablematePhotoAvatar.remove();
    renderAvatarPreview(); status.textContent = 'Photo removed. Your character avatar is back.';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const username = $('#profile-username').value.trim();
  if (username && !window.TablemateIdentity.validateUsername(username)) { $('#identity-status').textContent = 'Username must be 3–20 safe characters and cannot be reserved.'; return; }
  const body = { displayName: $('#profile-display-name').value,
    privacy: { profileVisibility: $('#profile-visibility').value, showUsernameAtTables: $('#show-username-tables').checked,
      showAvatarAtTables: $('#show-avatar-tables').checked } };
  if (username && username !== profileAccount.username) body.username = username;
  if (!username && profileAccount.username) { $('#identity-status').textContent = 'Choose a username or keep your current one.'; return; }
  const response = await fetch('/api/me/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) { $('#identity-status').textContent = data.error === 'cooldown' ? 'Username is still on cooldown.' : data.error || 'Could not save profile.'; return; }
  profileAccount = data; renderAvatarPreview(); renderProfileForm(); $('#profile-name').textContent = data.displayName;
  $('#identity-status').textContent = 'Profile saved.';
});
$('#preview-profile').addEventListener('click', () => {
  const body = $('#profile-preview-body'); body.replaceChildren();
  body.append(window.TablemateAvatar.renderAvatar(profileAccount.avatar, 72, profileAccount.displayName));
  const avatarDescription = document.createElement('p'); avatarDescription.textContent = window.TablemateAvatar.describe(profileAccount.avatar); body.append(avatarDescription);
  const name = document.createElement('h3'); name.textContent = profileAccount.displayName; body.append(name);
  const username = document.createElement('p'); username.textContent = profileAccount.username ? `@${profileAccount.username}` : 'No username yet'; body.append(username);
  const visibility = document.createElement('p'); visibility.textContent = profileAccount.privacy.profileVisibility === 'leagues'
    ? 'People in your leagues can view this profile.' : 'Only you can view this profile.'; body.append(visibility);
  const table = document.createElement('p'); table.textContent = `At tables: ${profileAccount.privacy.showAvatarAtTables ? 'avatar shown' : 'avatar hidden'} · ${profileAccount.privacy.showUsernameAtTables ? '@username shown' : '@username hidden'}.`;
  body.append(table); $('#profile-preview-dialog').showModal(); $('#close-profile-preview').focus();
});
$('#close-profile-preview').addEventListener('click', () => $('#profile-preview-dialog').close());
async function loadLeagues() {
  const response = await fetch('/api/leagues');
  const list = $('#leagues-list'); list.replaceChildren();
  if (!response.ok) { list.textContent = 'Leagues are unavailable.'; return; }
  const { leagues } = await response.json();
  if (!leagues.length) list.textContent = 'No leagues yet. Create one or ask a friend for an invite code.';
  for (const league of leagues) {
    const link = document.createElement('a'); link.href = `/league.html?id=${encodeURIComponent(league.id)}`;
    link.className = 'league-link'; link.textContent = `${league.name} · ${league.role}`; list.append(link);
  }
}
async function leagueAction(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'League request failed.');
  window.location.assign(`/league.html?id=${encodeURIComponent(data.id)}`);
}
$('#create-league').addEventListener('submit', async event => {
  event.preventDefault();
  try { await leagueAction('/api/leagues', { name: $('#league-name').value }); }
  catch (error) { $('#league-status').textContent = error.message; }
});
$('#join-league').addEventListener('submit', async event => {
  event.preventDefault();
  try { await leagueAction('/api/leagues/join', { inviteCode: $('#league-code').value.trim().toUpperCase() }); }
  catch (error) { $('#league-status').textContent = error.message; }
});
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
