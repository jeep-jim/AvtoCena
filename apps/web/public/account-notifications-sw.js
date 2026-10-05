self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path=event.notification.data?.href;
  const target=new URL(typeof path==='string'&&/^\/account(?:\?|$)/.test(path)?path:'/account',self.location.origin).href;
  event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const account=windows.find(client=>new URL(client.url).pathname==='/account');if(account){await account.navigate(target);await account.focus();}else await self.clients.openWindow(target);})());
});
