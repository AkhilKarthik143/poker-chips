/* global window, document, fetch, location */
(() => {
const build = document.querySelector('#creator-build');
const loading = document.querySelector('#creator-loading');
const error = document.querySelector('#creator-error');
const progress = document.querySelector('#creator-progress');
const returnPath = window.TablemateCreatorPath.safeReturnPath(new URLSearchParams(location.search).get('return'));
const fallback = document.querySelector('#simple-builder'); fallback.href = returnPath;
const showError = message => { error.textContent = message; error.hidden = false; loading.hidden = true; };
window.TablemateAvatar = {
  initial: null,
  returnPath,
  navigate(path) { location.assign(window.TablemateCreatorPath.safeReturnPath(path === '/me.html' ? returnPath : path)); },
  async save(json) {
    let avatar;
    try { avatar = JSON.parse(json); } catch { throw new Error('Invalid character data.'); }
    const response = await fetch('/api/me/profile', { method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save character.');
    this.initial = result.avatar;
    return result.avatar;
  }
};
async function start() {
  const accountResponse = await fetch('/api/me', { credentials: 'same-origin' });
  if (accountResponse.status === 401) { location.assign('/login.html'); return; }
  if (!accountResponse.ok) throw new Error('Your account could not load. Use the simple builder.');
  const account = await accountResponse.json();
  window.TablemateAvatar.initial = account.avatar?.v === 2 ? account.avatar : null;
  if (!build.dataset.loader || build.dataset.loader.includes('{{{')) throw new Error('Unity build files are missing. Use the simple builder.');
  const script = document.createElement('script'); script.src = `Build/${build.dataset.loader}`;
  await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = () => reject(new Error('Creator download failed. Use the simple builder.')); document.head.append(script); });
  const config = { dataUrl: `Build/${build.dataset.data}`, frameworkUrl: `Build/${build.dataset.framework}`,
    codeUrl: `Build/${build.dataset.code}`, streamingAssetsUrl: 'StreamingAssets', companyName: 'Tablemate',
    productName: 'Tablemate Avatar Creator', productVersion: '1.0' };
  window.tablemateUnityInstance = await window.createUnityInstance(document.querySelector('#unity-canvas'), config,
    value => { progress.value = value; });
  loading.hidden = true;
}
start().catch(cause => showError(cause.message || 'Creator could not load. Use the simple builder.'));
})();
