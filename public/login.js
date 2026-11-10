/* global document, fetch, location */
fetch('/api/config').then(response => response.json()).then(config => {
  if (!config.accounts) {
    document.querySelector('#login-form').hidden = true;
    document.querySelector('#login-status').textContent = 'Accounts are unavailable on this table. You can keep playing as a guest.';
  }
}).catch(() => {});
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#login-status');
  const localLogin = document.querySelector('#local-login');
  localLogin.hidden = true;
  status.textContent = 'Sending…';
  try {
    const response = await fetch('/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.querySelector('#email').value }) });
    if (!response.ok) { status.textContent = 'Sign-in is unavailable right now.'; return; }
    const result = await response.json();
    if (result.devLink) {
      const link = new URL(result.devLink);
      if (link.origin === location.origin && link.pathname === '/verify.html' && /^[a-f0-9]{64}$/.test(link.searchParams.get('token') || '')) {
        document.querySelector('#local-login-link').href = link.href;
        localLogin.hidden = false;
        status.textContent = 'Local demo link ready. Open it to sign in.';
        return;
      }
    }
    status.textContent = 'Check your inbox for a sign-in link.';
  } catch { status.textContent = 'Could not connect. Try again.'; }
});
