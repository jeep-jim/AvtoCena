// Notification worker only: does not intercept/cache pages, API responses or photos.
self.addEventListener('push', event => {
  let data = {}; try { data = event.data.json(); } catch {}
  event.waitUntil((async () => {
    // Avoid showing an account's notice on a device after logout/account switch.
    const response = await fetch('/api/crm/inbox', {cache: 'no-store'}).catch(() => null);
    if (!response || !response.ok) return;
    const inbox = await response.json();
    if (!inbox.newCount) return;
    await self.registration.showNotification('АвтоЦена · Заявки', {
      body: `Непросмотренных заявок: ${inbox.newCount}`,
      tag: 'avtocena-crm', icon: '/icons/crm-192.png', badge: '/icons/crm-192.png',
      data: {url: '/crm/leads'},
    });
    if ('setAppBadge' in self.navigator) await self.navigator.setAppBadge(inbox.newCount).catch(()=>{});
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const tab = tabs.find(client => new URL(client.url).pathname.startsWith('/crm'));
    if (tab) { await tab.navigate('/crm/leads'); await tab.focus(); }
    else await self.clients.openWindow('/crm/leads');
  })());
});
