/* global document, fetch, window, setTimeout, clearTimeout */
(() => {
const $ = selector => document.querySelector(selector);
let account; let timer; let checkSequence = 0;
function message(text) { $('#welcome-status').textContent = text; }
async function putProfile(patch) {
  const response = await fetch('/api/me/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not save. Try again.');
  account = data; return data;
}
function step(number) {
  document.querySelectorAll('.welcome-step').forEach(section => { section.hidden = Number(section.dataset.step) !== number; });
  $('#welcome-progress').textContent = `Step ${number} of 4`;
  message('');
  const heading = $(`.welcome-step[data-step="${number}"] h2`); heading.focus();
  if (number === 3) window.TablemateAvatar.mountBuilder($('#welcome-avatar-builder'), account.avatar, account.displayName, async avatar => {
    await putProfile({ avatar }); step(4);
  });
}
async function availability(value) {
  const sequence = ++checkSequence;
  const status = $('#username-availability');
  if (!window.TablemateIdentity.validateUsername(value)) { status.textContent = 'Use 3–20 letters, numbers or underscores; start with a letter. Reserved names are unavailable.'; return; }
  status.textContent = 'Checking availability…';
  try {
    const response = await fetch(`/api/username/check?u=${encodeURIComponent(value)}`);
    const data = await response.json();
    if (sequence !== checkSequence) return;
    status.textContent = response.ok ? data.available ? `@${value} is available.` : `That username is ${data.reason}.` : 'Could not check right now. You can still try Continue.';
  } catch { if (sequence === checkSequence) status.textContent = 'Could not check right now. You can still try Continue.'; }
}
$('#welcome-username').addEventListener('input', event => {
  clearTimeout(timer); checkSequence++;
  const value = event.target.value.trim();
  if (!value) { $('#username-availability').textContent = ''; return; }
  timer = setTimeout(() => availability(value), 400);
});
$('#welcome-username-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await putProfile({ username: $('#welcome-username').value.trim() }); $('#welcome-name').value = account.displayName; step(2); }
  catch (error) { message(error.message); }
});
$('#welcome-name-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await putProfile({ displayName: $('#welcome-name').value }); step(3); }
  catch (error) { message(error.message); }
});
$('#keep-avatar').addEventListener('click', () => step(4));
$('#welcome-privacy-form').addEventListener('submit', async event => {
  event.preventDefault();
  const privacy = { profileVisibility: $('#welcome-visibility').value,
    showUsernameAtTables: $('#welcome-username-tables').checked, showAvatarAtTables: $('#welcome-avatar-tables').checked };
  try { await putProfile({ privacy }); window.location.assign('/me.html'); }
  catch (error) { message(error.message); }
});
$('#welcome-skip').addEventListener('click', async () => {
  const button = $('#welcome-skip'); button.disabled = true;
  try {
    const response = await fetch('/api/me/onboarding/skip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not skip setup.');
    window.location.assign('/me.html');
  } catch (error) { message(error.message); button.disabled = false; }
});
async function load() {
  try {
    const response = await fetch('/api/me');
    if (response.status === 401) { window.location.assign('/login.html'); return; }
    if (!response.ok) { window.location.assign('/'); return; }
    account = await response.json();
    if (account.username) { window.location.assign('/me.html'); return; }
    document.querySelector('main').hidden = false;
    $('#welcome-name').value = account.displayName;
    $('#welcome-visibility').value = account.privacy.profileVisibility;
    $('#welcome-username-tables').checked = account.privacy.showUsernameAtTables;
    $('#welcome-avatar-tables').checked = account.privacy.showAvatarAtTables;
    step(1);
    const suggestions = await fetch('/api/username/suggestions');
    if (!suggestions.ok) return;
    const data = await suggestions.json(); const list = $('#username-suggestions');
    for (const name of data.suggestions || []) {
      if (!window.TablemateIdentity.validateUsername(name)) continue;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `@${name}`;
      button.addEventListener('click', () => { $('#welcome-username').value = name; availability(name); $('#welcome-username').focus(); });
      list.append(button);
    }
  } catch { message('Could not load your account. Refresh and try again.'); }
}
load();
})();
