from pathlib import Path
import re

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def must_replace(text, old, new, name):
    if old not in text:
        raise RuntimeError(f'Não encontrei bloco esperado: {name}')
    return text.replace(old,new,1)

jsp=Path('public/chegaja-v217-driver-navigation.js')
js=read(jsp)
if 'ChegaJá 14.33.19' not in js:
    js=must_replace(js,
        '/* ChegaJá 14.33.18 — painel único, oferta full-screen real, toque persistente e GPS contínuo */',
        '/* ChegaJá 14.33.19 — aceite volta ao mapa, seta visível e rota garantida */',
        'versão JS')
    js=js.replace('__CJ_DRIVER_LEAFLET_143318__','__CJ_DRIVER_LEAFLET_143319__')
    js=must_replace(js,
        'const A={installed:false,oldDashboard:null,oldNavigate:null,appNode:null,',
        'const A={installed:false,oldDashboard:null,oldNavigate:null,oldDeliveries:null,appNode:null,',
        'estado deliveries')
    js=must_replace(js,
        "function paintHeading(){const el=A.self?.getElement?.()?.querySelector('.cj217-self-marker');if(el&&Number.isFinite(A.lastHeading))el.style.transform=`rotate(${A.lastHeading}deg)`}",
        "function paintHeading(){const el=A.self?.getElement?.()?.querySelector('.cj217-self-marker');if(el)el.style.transform=`rotate(${Number.isFinite(A.lastHeading)?A.lastHeading:0}deg)`}",
        'seta com direção padrão')
    js=must_replace(js,
        "function ensureSelf(){if(!A.map||!valid(A.gps))return;if(!A.self)A.self=L.marker([A.gps.lat,A.gps.lng],{icon:selfIcon(),keyboard:false,zIndexOffset:1000,title:'Sua localização'}).addTo(A.map);else A.self.setLatLng([A.gps.lat,A.gps.lng]);paintHeading()}",
        "function ensureSelf(){if(!A.map||!valid(A.gps))return;if(!A.self)A.self=L.marker([A.gps.lat,A.gps.lng],{icon:selfIcon(),keyboard:false,zIndexOffset:5000,title:'Sua localização'}).addTo(A.map);else A.self.setLatLng([A.gps.lat,A.gps.lng]);A.self.setZIndexOffset?.(5000);paintHeading()}",
        'seta acima da rota')
    js=must_replace(js,
        "if(pts.length<2)pts=await osrm(origin,target);if(pts.length>=2){A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(pts);trimRouteToGps();if(navigationActive()&&!A.manualView&&A.following)followGps();else fitRouteOnce()}",
        "if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2)pts=[{...origin},{...target}];if(pts.length>=2){A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(pts);trimRouteToGps();ensureSelf();if(navigationActive()&&!A.manualView&&A.following)followGps();else fitRouteOnce()}",
        'fallback visual da rota')
    old_home="async function forceDriverHome(){if(!isDriver())return;if(window.state)window.state.page='dashboard';document.body.classList.remove('cj199-driver-page');document.body.classList.add('cj199-driver');$('#auth-screen')?.classList.add('hidden');$('#customer-screen')?.classList.add('hidden');$('#tracking-screen')?.classList.add('hidden');$('#app-shell')?.classList.remove('hidden');const content=$('#page-content');if(!content)return;ensureApp(content);try{await ensureMap()}catch{}preserveResize()}"
    new_home="async function forceDriverHome(){if(!isDriver())return;if(window.state)window.state.page='dashboard';try{history.replaceState(null,'','#dashboard')}catch{}document.body.classList.remove('cj199-driver-page','modal-open');document.body.classList.add('cj199-driver');$('#modal')?.classList.add('hidden');$('#auth-screen')?.classList.add('hidden');$('#customer-screen')?.classList.add('hidden');$('#tracking-screen')?.classList.add('hidden');$('#app-shell')?.classList.remove('hidden');const content=$('#page-content');if(!content)return;ensureApp(content);try{await ensureMap()}catch{}ensureSelf();updateStops();renderControls();preserveResize()}"
    js=must_replace(js,old_home,new_home,'retorno real ao mapa')
    pat=r"if\(action==='accept'\)\{.*?\}else if\(action==='complete'\)\{"
    new_accept="""if(action==='accept'){unlockAudio();let loc=await getPosition().catch(()=>null);if(!loc){const live=await api('/api/app/driver/live',{timeout:6000}).catch(()=>null);loc=hydrateServerGps(live)}if(!A.online){if(!loc)throw new Error('Não recebi sua localização para iniciar. Ative a localização do celular.');await api('/api/app/driver/online',{method:'POST',body:{online:true,...loc}});A.online=true;startGps(true);await pushLocation(loc,true)}const d=await acceptCall(x,loc||{});stopOfferAlert();A.detail={...x,status:String(d.status||'accepted'),accepted_at:new Date().toISOString(),requires_acceptance:false,updated_at:new Date().toISOString()};A.lastOfferId='';A.arrivedDelivery=false;A.wait=null;A.localPickupSince=0;A.manualView=false;A.following=true;clearRoute();await forceDriverHome();if(!valid(A.gps)){const live=await api('/api/app/driver/live',{timeout:6000}).catch(()=>null);hydrateServerGps(live)}try{await ensureMap()}catch{}ensureSelf();updateStops();renderControls();renderSheet(true);closeSheet();await locationHeartbeat().catch(()=>{});await updateRoute(true);ensureSelf();if(valid(A.gps))centralize();notice('Entrega aceita. Siga a linha azul até a coleta.');if(loc)autoProgress(loc,true).catch(()=>{})}else if(action==='complete'){"""
    js,n=re.subn(pat,new_accept,js,count=1,flags=re.S)
    if n!=1: raise RuntimeError('Não encontrei o bloco de aceite')
    old_install="function install(){if(A.installed||!window.pages||typeof window.navigate!=='function')return false;A.installed=true;A.oldDashboard=window.pages.dashboard;A.oldNavigate=window.navigate;window.pages.dashboard=async function(){if(isDriver())return mount();return A.oldDashboard?.apply(this,arguments)};window.navigate=async function(page,...rest){if(isDriver()&&page==='dashboard'){window.state.page='dashboard';return mount()}if(isDriver())leaveHome();return A.oldNavigate.call(this,page,...rest)};if(isHome())mount();return true}"
    new_install="function install(){if(A.installed||!window.pages||typeof window.navigate!=='function')return false;A.installed=true;A.oldDashboard=window.pages.dashboard;A.oldDeliveries=window.pages.deliveries;A.oldNavigate=window.navigate;window.pages.dashboard=async function(){if(isDriver())return mount();return A.oldDashboard?.apply(this,arguments)};window.pages.deliveries=async function(){if(isDriver()){try{await poll(true)}catch{}if(A.detail){await forceDriverHome();if(offerRequired(A.detail))notifyOffer(A.detail);else{startGps();locationHeartbeat().catch(()=>{});await updateRoute(true);ensureSelf();if(valid(A.gps))centralize()}return}}return A.oldDeliveries?.apply(this,arguments)};window.navigate=async function(page,...rest){if(isDriver()&&page==='dashboard'){window.state.page='dashboard';return mount()}if(isDriver()&&page==='deliveries'&&(A.detail||window.ChegaJaDriverActiveDelivery)){window.state.page='dashboard';await forceDriverHome();if(offerRequired(A.detail))notifyOffer(A.detail);else{await updateRoute(true);ensureSelf();if(valid(A.gps))centralize()}return}if(isDriver())leaveHome();return A.oldNavigate.call(this,page,...rest)};if(isHome())mount();return true}"
    js=must_replace(js,old_install,new_install,'bloqueio da aba antiga durante entrega')
    write(jsp,js)

cssp=Path('public/chegaja-v217-driver-navigation.css')
css=read(cssp)
css=css.replace('/* ChegaJá 14.33.17 — ÚNICA folha do painel do cooperado. Conteúdo consolidado das regras necessárias. */','/* ChegaJá 14.33.19 — ÚNICA folha do painel do cooperado. */',1)
if 'ChegaJá 14.33.19 — navegação sempre visível' not in css:
    css += r'''

/* ChegaJá 14.33.19 — navegação sempre visível */
body.cj199-driver #cj199-map{display:block!important;visibility:visible!important;opacity:1!important}
body.cj217-active-delivery #cj199-map{z-index:2!important}
body.cj199-driver #cj199-map .cj217-self-icon{z-index:10000!important;opacity:1!important;visibility:visible!important}
body.cj199-driver #cj199-map .cj217-self-marker{width:38px!important;height:44px!important;background:#1459ff!important;border:3px solid #fff!important;filter:drop-shadow(0 5px 7px #07183aaa)!important;opacity:1!important;visibility:visible!important}
body.cj199-driver #cj199-map .leaflet-overlay-pane{z-index:450!important}
body.cj199-driver #cj199-map .leaflet-marker-pane{z-index:650!important}
'''
write(cssp,css)

idxp=Path('public/index.html')
idx=read(idxp)
idx=idx.replace('app-version" content="14.33.18"','app-version" content="14.33.19"')
idx=idx.replace('chegaja-v217-driver-navigation.css?v=14.33.18&recovery=143318','chegaja-v217-driver-navigation.css?v=14.33.19&recovery=143319')
idx=idx.replace('chegaja-v217-driver-navigation.js?v=14.33.18&recovery=143318','chegaja-v217-driver-navigation.js?v=14.33.19&recovery=143319')
write(idxp,idx)

testp=Path('scripts/test-v14153-logo-google-maps.mjs')
t=read(testp)
t=t.replace('14\\.33\\.18','14\\.33\\.19')
t=t.replace('14.33.18: painel único, oferta full-screen, navegação após aceite e GPS contínuo validados.','14.33.19: aceite retorna ao mapa, seta e rota validados.')
t=t.replace('chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.19&recovery=143318','chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.19&recovery=143319')
t=t.replace('chegaja-v217-driver-navigation\\.css\\?v=14\\.33\\.19&recovery=143318','chegaja-v217-driver-navigation\\.css\\?v=14\\.33\\.19&recovery=143319')
t=t.replace("assert.match(driver,/closeSheet\\(\\);if\\(!valid\\(A\\.gps\\)\\)/);", "assert.match(driver,/await forceDriverHome\\(\\)/);\nassert.match(driver,/pts=\\[\\{\\.\\.\\.origin\\},\\{\\.\\.\\.target\\}\\]/);\nassert.match(driver,/oldDeliveries/);\nassert.match(driver,/page==='deliveries'.*ChegaJaDriverActiveDelivery/);")
write(testp,t)

print('ChegaJá 14.33.19 preparado: aceite volta ao mapa, seta acima da rota e fallback visual ativo.')
