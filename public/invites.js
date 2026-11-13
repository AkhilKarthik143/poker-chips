/* global document, window, navigator, sessionStorage */
(() => {
  const returnKey = 'tablemate-invite-return';
  function safeReturn(value) {
    return typeof value === 'string' && /^\/invite\.html\?(?:friend=[a-f0-9]{32}|league=[A-HJ-NP-Z]{8})$/.test(value) ? value : null;
  }
  function fromQuery() {
    return safeReturn(new URL(window.location.href).searchParams.get('return'));
  }
  function remember(value) {
    const path = safeReturn(value);
    if (path) sessionStorage.setItem(returnKey, path);
    return path;
  }
  function pending() { return fromQuery() || safeReturn(sessionStorage.getItem(returnKey)); }
  function nextPath(onboarding) {
    return onboarding ? '/welcome.html' : done();
  }
  function done() {
    const destination = pending();
    if (destination) sessionStorage.removeItem(returnKey);
    return destination || '/me.html';
  }
  function node(tag, className, label) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (label) element.textContent = label;
    return element;
  }
  async function copy(value, field, status) {
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = 'Copied to clipboard.';
    } catch {
      field.focus(); field.select();
      status.textContent = 'Select and copy the link above.';
    }
  }
  function openShare({ type, title, subtitle, url, code, avatar }) {
    if (!['friend', 'league', 'table'].includes(type) || !/^https?:\/\//.test(url)) throw new Error('Invite link unavailable.');
    const dialog = node('dialog', 'invite-share-dialog');
    dialog.setAttribute('aria-labelledby', 'invite-share-heading');
    const heading = node('h2', '', title); heading.id = 'invite-share-heading';
    const close = node('button', 'invite-close', 'Close'); close.type = 'button';
    close.setAttribute('aria-label', 'Close share panel'); close.addEventListener('click', () => dialog.close());
    const header = node('div', 'invite-share-header'); header.append(heading, close); dialog.append(header);
    const identity = node('div', 'invite-share-identity');
    if (avatar && window.TablemateAvatar?.valid(avatar)) identity.append(window.TablemateAvatar.renderAvatar(avatar, 52, subtitle || title));
    const text = node('p', '', subtitle || 'Scan to open this invitation.'); identity.append(text); dialog.append(identity);
    const qrBox = node('div', 'invite-share-qr');
    const qr = node('img'); qr.alt = `QR code for ${title}`; qr.width = 264; qr.height = 264;
    let qrReady = false;
    try {
      const generator = window.qrcode(0, 'M'); generator.addData(url); generator.make();
      qr.src = generator.createDataURL(7, 4); qrReady = true; qrBox.append(qr);
    } catch { qrBox.append(node('p', '', 'QR unavailable. Use the link below.')); }
    dialog.append(qrBox);
    const label = node('label', 'invite-share-label', 'Invitation link');
    const field = node('input', 'invite-share-url'); field.readOnly = true; field.value = url;
    label.append(field); dialog.append(label);
    const actions = node('div', 'invite-share-actions');
    const status = node('p', 'invite-share-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const copyButton = node('button', 'primary', 'Copy Link'); copyButton.type = 'button';
    copyButton.addEventListener('click', () => copy(url, field, status)); actions.append(copyButton);
    const share = node('button', '', 'Share'); share.type = 'button'; share.hidden = typeof navigator.share !== 'function';
    share.addEventListener('click', async () => {
      try { await navigator.share({ title, text: subtitle, url }); status.textContent = 'Share sheet opened.'; }
      catch (error) { if (error.name !== 'AbortError') status.textContent = 'Sharing unavailable. Copy the link instead.'; }
    });
    actions.append(share); dialog.append(actions);
    if (code) {
      const codeLabel = node('label', 'invite-share-label', 'Invite code');
      const codeField = node('input', 'invite-share-url'); codeField.readOnly = true; codeField.value = code;
      codeLabel.append(codeField); dialog.append(codeLabel);
      const codeButton = node('button', 'invite-code-button', 'Copy Invite Code'); codeButton.type = 'button';
      codeButton.addEventListener('click', () => copy(code, codeField, status)); dialog.append(codeButton);
    }
    if (qrReady) {
      const download = node('a', 'invite-download', 'Download QR image');
      download.href = qr.src; download.download = `tablemate-${type}-invite.gif`; dialog.append(download);
    }
    dialog.append(status);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog); dialog.showModal(); close.focus();
    return dialog;
  }
  window.TablemateInvites = Object.freeze({ safeReturn, fromQuery, remember, pending, nextPath, done, openShare });
})();
