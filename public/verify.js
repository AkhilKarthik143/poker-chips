/* global document, fetch, location, window */
document.querySelector('#verify-button').addEventListener('click', async () => {
  const button = document.querySelector('#verify-button');
  const status = document.querySelector('#verify-status');
  button.disabled = true;
  const token = new URL(location.href).searchParams.get('token');
  try {
    const response = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }) });
    if (!response.ok) throw new Error('This link has expired or was already used.');
    window.location.assign('/me.html');
  } catch (error) { status.textContent = error.message; button.disabled = false; }
});
