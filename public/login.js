/* global document, fetch */
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#login-status');
  status.textContent = 'Sending…';
  try {
    const response = await fetch('/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.querySelector('#email').value }) });
    status.textContent = response.ok ? 'Check your inbox for a sign-in link.' : 'Sign-in is unavailable right now.';
  } catch { status.textContent = 'Could not connect. Try again.'; }
});
