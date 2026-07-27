const CACHE='chegaja-14-15-9';
const CORE=['/','/index.html','/chegaja-final.css?v=14.15.9','/chegaja-v144.css?v=14.15.9','/chegaja-v145.css?v=14.15.9','/chegaja-v148.css?v=14.15.9','/chegaja-v149.css?v=14.15.9','/app.js?v=14.15.9','/chegaja-final.js?v=14.15.9','/chegaja-v144.js?v=14.15.9','/chegaja-v145.js?v=14.15.9','/chegaja-v148.js?v=14.15.9','/chegaja-v149.js?v=14.15.9','/manifest.webmanifest','/icons/icon-official.png','/icons/logo-official.png','/vendor/leaflet/leaflet.css','/vendor/leaflet/leaflet.js','/vendor/qrcode.js'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}))});
self.addEventListener('activate',event=>event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.pathname.startsWith('/api/'))return;
  event.respondWith(fetch(req).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{})}return response}).catch(()=>caches.match(req).then(r=>r||caches.match('/index.html'))));
});
