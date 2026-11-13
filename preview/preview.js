/* global document, fetch, window */
const status = document.querySelector('#preview-account');
const demo = document.querySelector('#demo-login');
const fresh = document.querySelector('#fresh-login');
window.TablemateInvites.remember(window.TablemateInvites.fromQuery());

async function accountState() {
  try {
    const response = await fetch('/api/me');
    if (!response.ok) { status.textContent = 'Preview account is ready. Enter as Alex to see sample data.'; return; }
    const account = await response.json();
    status.textContent = `Signed in as ${account.displayName}. This site uses its own sample database.`;
    const leagues = await fetch('/api/leagues');
    if (leagues.ok) {
      const { leagues: items } = await leagues.json();
      const league = items.find(item => item.name === 'Friday Night');
      if (league) document.querySelector('#preview-league-link').href = `/league.html?id=${encodeURIComponent(league.id)}`;
    }
  } catch { status.textContent = 'Could not check your preview account. Refresh and try again.'; }
}

async function signIn(path, button, message) {
  button.disabled = true;
  status.textContent = message;
  try {
    const response = await fetch(path, { method: 'POST' });
    if (!response.ok) throw new Error('Could not open the preview account.');
    const result = await response.json();
    window.location.assign(window.TablemateInvites.nextPath(result.onboarding));
  } catch (error) { status.textContent = error.message; button.disabled = false; }
}
demo.addEventListener('click', () => signIn('/preview/demo-login', demo, 'Opening the sample account…'));
fresh.addEventListener('click', () => signIn('/preview/fresh-account', fresh, 'Making a fresh test account…'));

document.querySelectorAll('[data-preview-theme]').forEach(button => button.addEventListener('click', () => {
  const theme = button.dataset.previewTheme;
  if (!window.TablematePrefs?.update({ theme })) return;
  document.querySelector('#preview-theme-status').textContent = `${button.textContent.trim()} selected. Open the table to see it.`;
  document.querySelectorAll('[data-preview-theme]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
document.querySelectorAll('[data-preview-theme]').forEach(button =>
  button.setAttribute('aria-pressed', String(window.TablematePrefs?.get().theme === button.dataset.previewTheme)));
accountState();
