/* global document, fetch, window, navigator */
(() => {
const $ = selector => document.querySelector(selector);
const id = new URL(window.location.href).searchParams.get('id');
let league; let seasons = []; let currentStandings = []; let currentScoring = null;
const number = value => Number(value).toLocaleString();
const netText = value => `${value > 0 ? '+' : ''}${number(value)} chips`;
function status(message) { $('#league-status').textContent = message; }
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/leagues/${id}${path}`, { method,
    headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function button(label, action) {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
  element.addEventListener('click', () => Promise.resolve(action()).catch(error => status(error.message)));
  return element;
}
function text(tag, value, className) {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  return element;
}
function scoringLabel(rule) { return { points: 'Points per night', net: 'Total net', capped_net: 'Capped net', roi: 'ROI' }[rule.type]; }
function scoreText(score, rule) {
  return rule.type === 'roi' ? `${(score / 100).toFixed(2)}%` : rule.type === 'points' ? `${(score / 100).toFixed(2)} pts` : `${number(score / 100)} chips`;
}
async function load() {
  if (!id) { status('Choose a league from My stats.'); return; }
  try {
    const [detail, seasonData, live] = await Promise.all([api(''), api('/seasons'), api('/live')]);
    league = detail; seasons = seasonData.seasons;
    $('#league-title').textContent = detail.name;
    $('#league-role').textContent = `Your role: ${detail.myRole}`;
    $('#invite-code').textContent = detail.inviteCode;
    $('#rotate-invite').hidden = !['commissioner', 'co'].includes(detail.myRole);
    $('#leave-league').hidden = detail.myRole === 'commissioner';
    const liveButton = $('#live-action');
    if (live.roomCode) {
      $('#live-label').textContent = `Tonight’s table: ${live.roomCode}`;
      liveButton.textContent = 'Join tonight’s table'; liveButton.hidden = false;
      liveButton.onclick = () => window.location.assign(`/?code=${live.roomCode}`);
    } else if (['commissioner', 'co'].includes(detail.myRole)) {
      $('#live-label').textContent = 'No table open tonight.';
      liveButton.textContent = 'Start tonight’s table'; liveButton.hidden = false;
      liveButton.onclick = () => window.location.assign(`/?league=${encodeURIComponent(id)}`);
    } else { $('#live-label').textContent = 'The commissioner has not opened a table yet.'; liveButton.hidden = true; }
    renderMembers(); renderRules(); renderSeasons();
    await Promise.all([renderStandings(), renderNights()]);
  } catch (error) { status(error.message); }
}
function renderMembers() {
  const list = $('#members-list'); list.replaceChildren();
  for (const member of league.members.filter(item => item.leftAt === null)) {
    const row = text('div', '', 'league-member');
    row.append(text('strong', member.displayName), text('span', member.role));
    if (league.myRole === 'commissioner' && member.role !== 'commissioner') {
      row.append(button(member.role === 'co' ? 'Make member' : 'Make co', async () => {
        await api(`/members/${member.memberId}`, 'PATCH', { role: member.role === 'co' ? 'member' : 'co' }); await load();
      }));
      row.append(button('Transfer', async () => { await api('/transfer', 'POST', { memberId: member.memberId }); await load(); }));
    }
    if (['commissioner', 'co'].includes(league.myRole) && member.role !== 'commissioner') {
      row.append(button('Remove', async () => { await api(`/members/${member.memberId}`, 'DELETE'); await load(); }));
    }
    list.append(row);
  }
}
function renderRules() {
  const form = $('#table-rules');
  for (const [key, value] of Object.entries(league.tableSettings)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
  const settings = league.tableSettings;
  const summary = $('#rules-summary'); summary.replaceChildren();
  for (const [label, value] of [
    ['Starting stack', `${number(settings.startingStack)} chips`],
    ['Blinds', `${number(settings.smallBlind)} / ${number(settings.bigBlind)}`],
    ['Blind timer', settings.blindMinutes ? `Every ${settings.blindMinutes} minutes` : 'Off'],
    ['Cash value', settings.centsPer1000Chips ? `$${(settings.centsPer1000Chips / 100).toFixed(2)} per 1,000 chips` : 'Off']
  ]) summary.append(text('dt', label), text('dd', value));
  summary.hidden = league.myRole === 'commissioner';
  form.hidden = league.myRole !== 'commissioner';
  $('#season-form').hidden = league.myRole !== 'commissioner';
}
function renderSeasons() {
  const list = $('#seasons-list'); list.replaceChildren();
  const select = $('#season-select'); const selected = select.value; select.replaceChildren();
  for (const season of seasons) {
    const option = document.createElement('option'); option.value = season.id; option.textContent = `${season.name} · ${season.status}`; select.append(option);
    const row = text('div', '', 'season-row');
    row.append(text('strong', season.name), text('span', `${season.status} · ${scoringLabel(season.scoring)}`));
    if (league.myRole === 'commissioner' && season.status === 'draft') {
      row.append(button('Edit draft', () => { fillSeasonForm(season); }));
      row.append(button('Activate', async () => { await api(`/seasons/${season.id}/activate`, 'POST', {}); await load(); }));
    }
    if (league.myRole === 'commissioner' && season.status === 'active') {
      row.append(button('Close season', async () => { await api(`/seasons/${season.id}/close`, 'POST', {}); await load(); }));
    }
    list.append(row);
  }
  const preferred = seasons.find(season => season.id === selected) || seasons.find(season => season.status === 'active') || seasons[0];
  if (preferred) select.value = preferred.id;
}
function fillSeasonForm(season) {
  const form = $('#season-form'); form.dataset.editId = season.id;
  form.elements.namedItem('name').value = season.name;
  form.elements.namedItem('type').value = season.scoring.type;
  form.elements.namedItem('pointsTable').value = (season.scoring.table || [10, 7, 5, 3, 2, 1]).join(',');
  form.elements.namedItem('participation').value = season.scoring.participation ?? 1;
  form.elements.namedItem('capMultiple').value = season.scoring.capMultiple ?? 5;
  form.elements.namedItem('dropWorst').value = season.scoring.dropWorst ?? 0;
  form.elements.namedItem('minNightsPct').value = season.scoring.minNightsPct ?? 0;
  $('#season-form-title').textContent = `Edit ${season.name} draft`;
  $('[data-tab="rules"]').click(); form.elements.namedItem('name').focus();
}
async function renderStandings() {
  const list = $('#standings-list'); list.replaceChildren();
  const seasonId = $('#season-select').value;
  if (!seasonId) { list.textContent = 'No season yet. A commissioner can create a draft in Rules.'; currentStandings = []; return; }
  const { season, standings } = await api(`/seasons/${seasonId}/standings`);
  currentStandings = standings; currentScoring = season.scoring;
  $('#champion-banner').hidden = !season.championMemberId;
  const champion = standings.find(row => row.memberId === season.championMemberId);
  $('#champion-banner').textContent = champion ? `${champion.displayName} · Season champion` : '';
  for (const row of standings) {
    const card = text('div', '', 'standing-row');
    card.append(text('strong', `${row.rank}. ${row.displayName}`), text('span', scoreText(row.score, season.scoring)),
      text('span', `${row.nights} nights · ${row.wins} wins`), text('span', `${netText(row.net)} · ${row.qualified ? 'Qualified' : 'Needs more nights'}`),
      text('span', row.delta > 0 ? `↑ ${row.delta}` : row.delta < 0 ? `↓ ${-row.delta}` : '—'));
    list.append(card);
  }
  if (!standings.length) list.textContent = 'No members in the standings yet.';
}
async function renderNights() {
  const [nightData, auditData, records] = await Promise.all([api('/nights'), api('/audit'), api('/records')]);
  const list = $('#nights-results'); list.replaceChildren();
  for (const night of nightData.nights) {
    const details = document.createElement('details'); details.className = 'league-night';
    const summary = text('summary', `${new Date(night.endedAt).toLocaleDateString()} · Table ${night.roomCode} · ${night.counts ? 'Counts' : 'Voided'}`);
    details.append(summary);
    if (night.voidReason) details.append(text('p', `Review reason: ${night.voidReason}`, 'review-reason'));
    if (night.results.length < 2) details.append(text('p', 'Not enough league members for standings.'));
    for (const result of night.results) details.append(text('p', `${result.rank}. ${result.displayName} · ${netText(result.net)}`));
    const seats = text('div', '', 'night-seats');
    seats.append(text('strong', 'All seats, including subs'));
    for (const participant of night.participants) seats.append(text('p', `${participant.name} · ${netText(participant.net)}`));
    details.append(seats);
    if (['commissioner', 'co'].includes(league.myRole) && seasons.some(season => season.id === night.seasonId && season.status === 'active')) {
      details.append(button(night.counts ? 'Void night' : 'Restore night', () => openReview(night.id, night.counts ? 'void' : 'restore')));
    }
    list.append(details);
  }
  if (!nightData.nights.length) list.textContent = 'No reviewed nights yet.';
  const audit = $('#audit-list'); audit.replaceChildren();
  for (const entry of auditData.entries) audit.append(text('p', `${entry.actor} ${entry.action === 'restore' ? 'restored' : 'voided'} a night: ${entry.detail.reason}`));
  if (!auditData.entries.length) audit.textContent = 'No corrections recorded.';
  const shelf = $('#records-list'); shelf.replaceChildren();
  shelf.append(text('p', records.biggestNight ? `Biggest night: ${records.biggestNight.displayName} · ${netText(records.biggestNight.net)}` : 'Records appear after the first scored night.'));
  if (records.mostWins) shelf.append(text('p', `Most night wins: ${records.mostWins.displayName} · ${records.mostWins.wins}`));
  if (records.bestAttendance) shelf.append(text('p', `Best attendance: ${records.bestAttendance.displayName} · ${records.bestAttendance.pct}%`));
  if (records.longestStreak) shelf.append(text('p', `Longest winning streak: ${records.longestStreak.displayName} · ${records.longestStreak.longestStreak}`));
}
function openReview(nightId, action) {
  const dialog = $('#review-dialog'); dialog.dataset.nightId = nightId; dialog.dataset.action = action;
  $('#review-title').textContent = `${action === 'void' ? 'Void' : 'Restore'} night result`;
  $('#review-reason').value = ''; dialog.showModal(); $('#review-reason').focus();
}
document.querySelectorAll('[data-tab]').forEach(tab => tab.addEventListener('click', () => {
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button === tab));
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
}));
$('#season-select').addEventListener('change', () => renderStandings().catch(error => status(error.message)));
$('#copy-standings').addEventListener('click', async () => {
  const copy = `${league.name}\n${currentStandings.map(row => `${row.rank}. ${row.displayName} — ${scoreText(row.score, currentScoring)} · ${row.nights} nights`).join('\n')}`;
  try { await navigator.clipboard.writeText(copy); status('Standings copied.'); }
  catch { window.prompt('Copy standings', copy); status('Select and copy the standings.'); }
});
$('#rotate-invite').addEventListener('click', async () => { try { await api('/invite/rotate', 'POST', {}); await load(); } catch (error) { status(error.message); } });
$('#leave-league').addEventListener('click', async () => { try { await api('/leave', 'POST', {}); window.location.assign('/me.html'); } catch (error) { status(error.message); } });
$('#table-rules').addEventListener('submit', async event => {
  event.preventDefault();
  const settings = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, Number(value)]));
  try { await api('', 'PATCH', { tableSettings: settings }); status('Table rules saved.'); await load(); } catch (error) { status(error.message); }
});
$('#season-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  const type = form.elements.namedItem('type').value;
  const scoring = { type, minNightsPct: Number(form.elements.namedItem('minNightsPct').value) };
  if (type !== 'roi') scoring.dropWorst = Number(form.elements.namedItem('dropWorst').value);
  if (type === 'points') {
    scoring.table = form.elements.namedItem('pointsTable').value.split(',').map(value => Number(value.trim()));
    scoring.participation = Number(form.elements.namedItem('participation').value);
  }
  if (type === 'capped_net') scoring.capMultiple = Number(form.elements.namedItem('capMultiple').value);
  const editId = form.dataset.editId;
  try {
    await api(editId ? `/seasons/${editId}` : '/seasons', editId ? 'PATCH' : 'POST', { name: form.elements.namedItem('name').value, scoring });
    delete form.dataset.editId; $('#season-form-title').textContent = 'Create a season'; form.reset();
    status('Draft season saved.'); await load();
  } catch (error) { status(error.message); }
});
$('#review-cancel').addEventListener('click', () => $('#review-dialog').close());
$('#review-form').addEventListener('submit', async event => {
  event.preventDefault(); const dialog = $('#review-dialog');
  try { await api(`/nights/${dialog.dataset.nightId}/${dialog.dataset.action}`, 'POST', { reason: $('#review-reason').value });
    dialog.close(); status('Review recorded in the audit log.'); await load();
  } catch (error) { status(error.message); }
});
load();
})();
