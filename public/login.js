/* global document, fetch, location, window */
fetch('/api/config').then(response => response.json()).then(config => {
  if (!config.accounts) {
    document.querySelector('#login-form').hidden = true;
    document.querySelector('#google-signin').hidden = true;
    document.querySelector('#signin-divider').hidden = true;
    document.querySelector('#login-status').textContent = 'Accounts are unavailable on this table. You can keep playing as a guest.';
    return;
  }
  if (!config.email) {
    document.querySelector('#login-form').hidden = true;
    document.querySelector('#signin-divider').hidden = true;
  }
  if (!config.googleClientId) return;
  document.querySelector('#google-signin-note').textContent = 'Loading Google sign-in…';
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => {
    if (!window.google?.accounts?.id) {
      document.querySelector('#google-signin-note').textContent = 'Google sign-in could not load. Please try again later.';
      return;
    }
    const container = document.querySelector('#google-signin-button');
    window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: async result => {
      const status = document.querySelector('#login-status');
      status.textContent = 'Signing in with Google…';
      try {
        const response = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: result.credential }) });
        if (!response.ok) {
          const body = await response.json();
          status.textContent = body.error || 'Google sign-in failed. Try again.';
          return;
        }
        window.location.assign('/me.html');
      } catch { status.textContent = 'Could not connect. Try again.'; }
    } });
    try {
      window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', text: 'continue_with',
        shape: 'rectangular', width: Math.min(360, container.parentElement.clientWidth) });
    } catch {
      document.querySelector('#google-signin-note').textContent = 'Google sign-in could not load. Please try again later.';
      return;
    }
    document.querySelector('#google-signin-unavailable').hidden = true;
    document.querySelector('#google-signin-note').hidden = true;
    container.hidden = false;
  };
  script.onerror = () => { document.querySelector('#google-signin-note').textContent = 'Google sign-in could not load. Please try again later.'; };
  document.head.append(script);
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
