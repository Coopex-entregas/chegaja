const CACHE='chegaja-static-14-19-1';
const CORE=[
  '/','/index.html','/manifest.webmanifest',
  '/icons/icon-official.png','/icons/logo-official.png',
  '/vendor/leaflet/leaflet.css','/vendor/leaflet/leaflet.js','/vendor/qrcode.js',
  '/chegaja-final.css?v=14.15.9','/chegaja-v144.css?v=14.15.9','/chegaja-v145.css?v=14.15.9',
  '/chegaja-v148.css?v=14.15.9','/chegaja-v149.css?v=14.15.9','/chegaja-mobile-app.css?v=14.16.0',
  '/chegaja-v190.css?v=14.19.0','/chegaja-v191.css?v=14.19.1',
  '/app.js?v=14.15.9','/chegaja-maps-google.js?v=14.19.1','/chegaja-final.js?v=14.15.9',
  '/chegaja-v144.js?v=14.15.9','/chegaja-v145.js?v=14.15.9','/chegaja-v148.js?v=14.15.9',
  '/chegaja-v149.js?v=14.15.9','/chegaja-v190.js?v=14.19.0','/chegaja-v191.js?v=14.19.1'
];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).catch(()=>{}))});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))]))});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put('/index.html',response.clone())).catch(()=>{});return response}).catch(()=>caches.match('/index.html')));
    return;
  }
  event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone())).catch(()=>{});return response}).catch(()=>caches.match(request)));
});
