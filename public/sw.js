const RECOVERY_VERSION='14.33.5';

self.addEventListener('install',event=>{
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{
      const keys=await caches.keys();
      await Promise.all(keys.map(key=>caches.delete(key)));
    }catch{}
    try{await self.clients.claim()}catch{}
    try{
      const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      for(const client of clients)client.postMessage({type:'CHEGAJA_RECOVERY',version:RECOVERY_VERSION});
    }catch{}
    try{await self.registration.unregister()}catch{}
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  event.respondWith(fetch(request,{cache:'no-store'}));
});
