/* global window, fetch */
(() => {
const formats = ['image/jpeg', 'image/png', 'image/webp'];
async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not update photo avatar.');
  return data;
}
async function upload(file) {
  if (!file || !formats.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Photo must be 8 MB or smaller.');
  return request('/api/me/avatar-photo', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
}
const remove = () => request('/api/me/avatar-photo', { method: 'DELETE' });
window.TablematePhotoAvatar = Object.freeze({ upload, remove });
})();
