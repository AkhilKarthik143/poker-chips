/* global document, window, fetch, setTimeout, clearTimeout, setInterval */
(() => {
const $ = selector => document.querySelector(selector);
const params = new URL(window.location.href).searchParams;
const roomCode = /^[A-HJ-NP-Z]{8}$/.test(params.get('code') || '') ? params.get('code') : null;
let searchTimer; let searchSequence = 0; let listData;
const status = message => { $('#friend-status').textContent = message; };
const actionLabels = { send: 'Add friend', accept: 'Accept', decline: 'Decline', cancel: 'Cancel request',
  remove: 'Remove', block: 'Block', unblock: 'Unblock' };

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { window.location.assign('/login.html'); throw new Error('Sign in to see friends.'); }
  if (!response.ok) throw new Error(body.error || 'Could not load friends. Try again.');
  return body;
}
function avatarNode(person) {
  if (person.avatar && window.TablemateAvatar.valid(person.avatar)) return window.TablemateAvatar.renderAvatar(person.avatar, 48, person.displayName);
  const badge = document.createElement('span'); badge.className = 'friend-initial';
  badge.setAttribute('aria-hidden', 'true'); badge.textContent = person.displayName?.charAt(0)?.toUpperCase() || '?'; return badge;
}
async function change(person, action, button) {
  button.disabled = true; status('Saving…');
  try {
    await api(`/api/friends/${encodeURIComponent(person.username)}/${action}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{}' });
    status(action === 'send' ? 'Friend request sent.' : action === 'block' ? 'User blocked.' : 'Friends updated.');
    await loadLists(); await search();
  } catch (error) { status(error.message); button.disabled = false; }
}
function actionButton(person, action) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = actionLabels[action];
  if (action === 'remove' || action === 'block' || action === 'decline') button.className = 'quiet';
  button.addEventListener('click', () => change(person, action, button)); return button;
}
function personRow(person) {
  const row = document.createElement('article'); row.className = 'friend-row';
  row.append(avatarNode(person));
  const info = document.createElement('div'); info.className = 'friend-person';
  const name = document.createElement('strong'); name.textContent = person.displayName;
  const handle = document.createElement('span'); handle.textContent = `@${person.username}`;
  info.append(name, handle); row.append(info);
  const actions = document.createElement('div'); actions.className = 'friend-actions';
  const choices = person.status === 'friends' ? ['remove', 'block']
    : person.status === 'request-received' ? ['accept', 'decline', 'block']
      : person.status === 'request-sent' ? ['cancel', 'block']
        : person.status === 'blocked' ? ['unblock'] : person.status === 'not-friends' ? ['send', 'block'] : [];
  if (person.status === 'friends' && roomCode) {
    const share = document.createElement('button'); share.type = 'button'; share.textContent = 'Share table link';
    share.addEventListener('click', () => shareRoom()); actions.append(share);
  }
  for (const choice of choices) actions.append(actionButton(person, choice));
  row.append(actions); return row;
}
function fill(selector, people, empty) {
  const target = $(selector); target.replaceChildren();
  if (!people.length) { const note = document.createElement('p'); note.className = 'helper'; note.textContent = empty; target.append(note); return; }
  for (const person of people) target.append(personRow(person));
}
async function loadLists() {
  const data = await api('/api/friends'); listData = data;
  fill('#friend-list', data.friends, 'No friends yet. Search by username below to invite someone.');
  fill('#friend-incoming', data.incoming, 'No incoming requests.');
  fill('#friend-outgoing', data.outgoing, 'No sent requests.');
  fill('#friend-blocked', data.blocked, 'No blocked users.');
  const updates = $('#friend-notification-list'); updates.replaceChildren();
  $('#friend-notifications').hidden = !data.notifications.length;
  for (const event of data.notifications) {
    const line = document.createElement('p');
    line.textContent = event.kind === 'accepted' ? `${event.displayName} accepted your friend request.`
      : `${event.displayName} sent you a friend request.`;
    updates.append(line);
  }
}
async function search() {
  const query = $('#friend-search').value.trim(); const sequence = ++searchSequence;
  if (query.length < 2) { fill('#friend-search-results', [], 'Enter at least two characters to search.'); return; }
  const target = $('#friend-search-results'); target.textContent = 'Searching…';
  try {
    const data = await api(`/api/friends/search?q=${encodeURIComponent(query)}`);
    if (sequence !== searchSequence) return;
    fill('#friend-search-results', data.users, 'No matching usernames.');
  } catch (error) { if (sequence === searchSequence) target.textContent = error.message; }
}
async function shareRoom() {
  if (!roomCode) return;
  const message = $('#friend-invite-status'); message.textContent = 'Checking table…';
  try {
    await api(`/api/friends/invite/${roomCode}`);
    const url = window.Tablemate.roomInviteUrl(window.location.origin, roomCode);
    window.TablemateInvites.openShare({ type: 'table', title: `Share table ${roomCode}`,
      subtitle: `Room ${roomCode}`, url, code: roomCode });
    message.textContent = '';
  } catch (error) { message.textContent = error.message; }
}
$('#friend-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 350); });
$('#friend-notifications-read').addEventListener('click', async () => {
  try { await api('/api/friends/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadLists(); }
  catch (error) { status(error.message); }
});
$('#friend-share-room').addEventListener('click', shareRoom);
if (roomCode) { $('#friend-invite-panel').hidden = false; $('#friend-invite-title').textContent = `Share table ${roomCode}`; }
loadLists().catch(error => status(error.message));
setInterval(() => { if (document.visibilityState === 'visible' && listData) loadLists().catch(() => {}); }, 30_000);
})();
