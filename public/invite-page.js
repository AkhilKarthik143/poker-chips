/* global document, window, fetch */
(() => {
  const $ = selector => document.querySelector(selector);
  const params = new URL(window.location.href).searchParams;
  const friend = params.get('friend'); const league = params.get('league');
  const path = friend ? `/invite.html?friend=${friend}` : `/invite.html?league=${league}`;
  const valid = params.size === 1 && (friend ? /^[a-f0-9]{32}$/.test(friend) : /^[A-HJ-NP-Z]{8}$/.test(league || ''));
  const kind = friend ? 'friend' : 'league'; const token = friend || league;
  const endpoint = `/api/invites/${kind}/${encodeURIComponent(token || '')}`;
  function button(label, callback, primary = false) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
    if (primary) element.className = 'primary';
    element.addEventListener('click', callback); $('#invite-actions').append(element); return element;
  }
  function signIn() {
    const link = document.createElement('a'); link.className = 'primary invite-signin';
    link.href = `/login.html?return=${encodeURIComponent(path)}`;
    link.textContent = kind === 'friend' ? 'Sign in to add friend' : 'Sign in to join league';
    $('#invite-actions').append(link);
    $('#invite-summary').textContent += ' Sign in to continue. Your invitation will be waiting.';
  }
  async function act(action, trigger) {
    trigger.disabled = true; $('#invite-status').textContent = 'Saving…';
    try {
      const response = await fetch(`${endpoint}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { window.location.assign(`/login.html?return=${encodeURIComponent(path)}`); return; }
      if (!response.ok) throw new Error(data.error || (response.status >= 500
        ? 'Invitation service unavailable. Try again.' : 'Could not finish. Try again.'));
      if (kind === 'league') { window.location.assign(`${data.leaguePath}&joined=1`); return; }
      $('#invite-status').textContent = action === 'send' ? 'Friend Request Sent' : action === 'accept' ? 'You are now friends.' : 'Request declined.';
      await load(false);
    } catch (error) { $('#invite-status').textContent = error.message; trigger.disabled = false; }
  }
  async function load(clearStatus = true) {
    if (clearStatus) $('#invite-status').textContent = '';
    $('#invite-actions').replaceChildren(); $('#invite-person').replaceChildren();
    if (!valid) { $('#invite-heading').textContent = 'Invitation unavailable'; $('#invite-summary').textContent = 'Check the link and ask for a new invitation.'; return; }
    try {
      const response = await fetch(endpoint);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || (response.status >= 500
        ? 'Invitation service unavailable. Try again.' : 'Invitation unavailable.'));
      $('#invite-art').textContent = kind === 'friend' ? '☺' : '♣';
      $('#invite-heading').textContent = kind === 'friend' ? data.displayName : `You're invited to join ${data.name}`;
      $('#invite-summary').textContent = kind === 'friend'
        ? data.username ? `@${data.username} is on Tablemate.` : 'This player keeps their profile private.'
        : 'Join this league to play and see its members and standings.';
      if (kind === 'friend' && data.avatar && window.TablemateAvatar?.valid(data.avatar)) {
        $('#invite-person').append(window.TablemateAvatar.renderAvatar(data.avatar, 80, data.displayName));
      }
      if (!data.signedIn) { signIn(); return; }
      if (data.needsSetup) {
        window.TablemateInvites.remember(path);
        const link = document.createElement('a'); link.className = 'primary invite-signin';
        link.href = `/welcome.html?return=${encodeURIComponent(path)}`; link.textContent = 'Finish account setup';
        $('#invite-actions').append(link); return;
      }
      if (kind === 'league') {
        if (data.alreadyMember) {
          const link = document.createElement('a'); link.href = data.leaguePath; link.textContent = 'Open your league';
          link.className = 'primary invite-signin'; $('#invite-actions').append(link);
          $('#invite-status').textContent = 'You are already a member.';
        } else button('Join League', event => act('join', event.currentTarget), true);
        return;
      }
      if (data.status === 'not-friends') button('Add Friend', event => act('send', event.currentTarget), true);
      else if (data.status === 'request-received') {
        button('Accept', event => act('accept', event.currentTarget), true);
        button('Decline', event => act('decline', event.currentTarget));
      } else $('#invite-status').textContent = ({ 'request-sent': 'Friend Request Sent', friends: 'You are already friends.',
        self: 'This is your profile.', blocked: 'This profile is blocked.' })[data.status] || 'Profile unavailable.';
    } catch (error) {
      $('#invite-heading').textContent = kind === 'friend' ? 'Profile unavailable' : 'Invitation unavailable';
      $('#invite-summary').textContent = error.message;
    }
  }
  load();
})();
