// Separate account scope preserves staff subscriptions on the same device.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{event.waitUntil((async()=>{let data;try{data=event.data.json();}catch{return;}const response=await fetch('/api/account/auth',{cache:'no-store'}).catch(()=>null);if(!response?.ok)return;const {account}=await response.json();if(!account||account.id!==data.accountId)return;const portal=await fetch('/api/account/notifications',{cache:'no-store'}).catch(()=>null);if(!portal?.ok)return;const {items}=await portal.json();if(!items?.length)return;await self.registration.showNotification('АвтоЦена · Новое событие',{body:'Откройте кабинет, чтобы посмотреть подробности.',tag:'avtocena-customer',icon:'/icons/crm-192.png',data:{href:data.href}});})());});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path=event.notification.data?.href;
  const target=new URL(typeof path==='string'&&/^\/account(?:\?|$)/.test(path)?path:'/account',self.location.origin).href;
  event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const account=windows.find(client=>new URL(client.url).pathname==='/account');if(account){await account.navigate(target);await account.focus();}else await self.clients.openWindow(target);})());
});
