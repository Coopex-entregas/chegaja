const CACHE='chegaja-clean-14-16-4';
self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key))))
]))});
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname.startsWith('/api/'))return;
  event.respondWith(fetch(request,{cache:'no-store'}).catch(()=>caches.match(request)));
});
