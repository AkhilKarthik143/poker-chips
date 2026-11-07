/* global self */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { body: event.data.text() }; }
  const body = typeof payload.body === 'string' && /^Your turn at table [A-HJ-NP-Z]{8}$/.test(payload.body) ? payload.body : '';
  if (!body) return;
  const tag = typeof payload.tag === 'string' && /^tablemate-[A-HJ-NP-Z]{8}$/.test(payload.tag) ? payload.tag : 'tablemate-turn';
  event.waitUntil(self.registration.showNotification('Tablemate', {
    body,
    tag,
    icon: '/icons/tablemate-192.svg',
    badge: '/icons/tablemate-192.svg',
    data: { path: '/' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const app = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (app) {
      if (new URL(app.url).pathname !== '/') await app.navigate('/');
      return app.focus();
    }
    return self.clients.openWindow('/');
  }));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'clear-turn-notifications') return;
  event.waitUntil(self.registration.getNotifications().then(notifications => {
    notifications.filter(notification => notification.tag.startsWith('tablemate-')).forEach(notification => notification.close());
  }));
});
