/* global document, window, fetch */
(() => {
  const invites = window.TablemateInvites;
  const profile = document.querySelector('#share-profile');
  const league = document.querySelector('#invite-members');
  const status = document.querySelector('#invite-action-status');
  async function open(path, type) {
    const button = type === 'friend' ? profile : league;
    button.disabled = true; status.textContent = 'Preparing invitation…';
    try {
      const response = await fetch(path);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Invitation unavailable.');
      invites.openShare({ type, title: type === 'friend' ? 'Share Your Profile' : `Invite to ${data.name}`,
        subtitle: type === 'friend' ? `@${data.username}` : data.name,
        url: data.url || new URL(data.path, window.location.origin).href,
        ...(type === 'friend' ? { avatar: data.avatar } : { code: data.inviteCode }) });
      status.textContent = '';
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }
  profile?.addEventListener('click', () => open('/api/invites/me', 'friend'));
  if (league) {
    const id = new URL(window.location.href).searchParams.get('id');
    if (id) fetch(`/api/leagues/${encodeURIComponent(id)}`).then(response => response.ok ? response.json() : null)
      .then(data => { league.hidden = !['commissioner', 'co'].includes(data?.myRole); }).catch(() => {});
    league.addEventListener('click', () => open(`/api/leagues/${encodeURIComponent(id)}/invite`, 'league'));
  }
})();
