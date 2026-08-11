from pathlib import Path
import re

ROOT=Path('.')

def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def must_replace(text, old, new, name):
    if old not in text:
        raise RuntimeError(f'Não encontrei bloco esperado: {name}')
    return text.replace(old,new,1)

# 1) Painel canônico único do cooperado
jsp=Path('public/chegaja-v217-driver-navigation.js')
js=read(jsp)
js=js.replace('/* ChegaJá 14.33.15 — iniciar imediato, GPS resiliente e um único controlador */','/* ChegaJá 14.33.17 — painel único, oferta em tela cheia, SOS e rastreamento contínuo */')
js=js.replace('__CJ_DRIVER_LEAFLET_143315__','__CJ_DRIVER_LEAFLET_143317__')
js=must_replace(js,
"waitPollTimer:null,waitUiTimer:null,wait:null",
"waitPollTimer:null,waitUiTimer:null,locationTimer:null,locationBusy:false,wait:null",
'estado heartbeat')

js=must_replace(js,
'<button id="cj199-checkin" type="button"><b>✓</b><small>CHECK-IN</small></button><section id="cj199-bottom">',
'<button id="cj199-checkin" type="button"><b>✓</b><small>CHECK-IN</small></button><button id="cj217-sos" type="button" aria-label="Enviar pedido de socorro"><b>!</b><small>SOS</small></button><section id="cj199-bottom">',
'botão SOS no shell')

js=must_replace(js,
"if(start){start.hidden=false;start.disabled=false;start.removeAttribute('disabled');start.onclick=toggleOnline;",
"if(start){start.hidden=work;start.disabled=false;start.removeAttribute('disabled');start.onclick=toggleOnline;",
'esconder iniciar durante entrega')

# Oferta: durante a decisão não mostrar botão de Google Maps.
js=must_replace(js,
"buttons+='<button id=\"cj217-open-maps\" type=\"button\">GOOGLE MAPS</button>';",
"if(!offer)buttons+='<button id=\"cj217-open-maps\" type=\"button\">GOOGLE MAPS</button>';",
'maps apenas após aceite')
js=must_replace(js,
"$('#cj217-open-maps').onclick=openExternalMaps;paintWait()",
"$('#cj217-open-maps')?.addEventListener('click',openExternalMaps);paintWait()",
'bind maps opcional')

# Toque de telefone antigo contínuo até aceitar/recusar.
sound_start=js.find('function beep(c,at=0)')
sound_end=js.find('function freshPosition()',sound_start)
if sound_start<0 or sound_end<0: raise RuntimeError('Bloco de som não encontrado')
new_sound=r'''function phoneTone(c,at=0,duration=.78){try{const start=c.currentTime+at,master=c.createGain();master.gain.setValueAtTime(.0001,start);master.gain.exponentialRampToValueAtTime(.52,start+.025);master.gain.setValueAtTime(.52,start+duration-.09);master.gain.exponentialRampToValueAtTime(.0001,start+duration);master.connect(c.destination);for(const freq of[440,480]){const o=c.createOscillator();o.type='sine';o.frequency.setValueAtTime(freq,start);o.connect(master);o.start(start);o.stop(start+duration+.03)}}catch{}}
async function ring(){navigator.vibrate?.([760,140,760,820]);const c=unlockAudio();if(!c)return;try{if(c.state!=='running')await c.resume()}catch{}if(c.state!=='running')return;phoneTone(c,0,.76);phoneTone(c,.94,.76)}
function stopOfferAlert(){clearInterval(A.offerAlertTimer);A.offerAlertTimer=null;A.offerAlertCount=0;navigator.vibrate?.(0)}
function notifyOffer(x){const id=String(x?.id||'');if(!id)return;openSheet();if(id===A.lastOfferId&&A.offerAlertTimer)return;stopOfferAlert();A.lastOfferId=id;const fire=()=>{if(!offerRequired(A.detail)||String(A.detail?.id)!==id){stopOfferAlert();return}A.offerAlertCount+=1;ring()};fire();A.offerAlertTimer=setInterval(fire,3400)}
'''
js=js[:sound_start]+new_sound+js[sound_end:]

# GPS de servidor como fallback e heartbeat real do aparelho.
needle="function positionPayload(p){return{latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed}}"
insert=needle+r'''
function hydrateServerGps(live){const p=point(live?.driver?.current_lat,live?.driver?.current_lng);if(!valid(p))return null;A.gps=p;window.ChegaJaLastDriverLocation={lat:p.lat,lng:p.lng,accuracy:Number(live?.driver?.location_accuracy)||null,heading:A.lastHeading,speed:null};try{ensureSelf()}catch{}return{latitude:p.lat,longitude:p.lng,accuracy:Number(live?.driver?.location_accuracy)||null,heading:A.lastHeading,speed:null}}
'''
js=must_replace(js,needle,insert,'fallback GPS servidor')

startgps="function startGps(force=false){if(!navigator.geolocation)return false;if(force)stopGps();if(A.gpsWatch!=null)return true;A.gpsWatch=navigator.geolocation.watchPosition(handleGpsPosition,e=>{A.gpsError=e;if(e?.code===1){const id=A.gpsWatch;A.gpsWatch=null;if(id!=null)try{navigator.geolocation.clearWatch(id)}catch{}notice('A localização está bloqueada para este site. Autorize a localização no navegador.',true)}},{enableHighAccuracy:true,maximumAge:60000,timeout:60000});return true}"
heartbeat=startgps+r'''
async function locationHeartbeat(){if(A.locationBusy||!isHome()||!A.online||document.hidden)return;A.locationBusy=true;try{let loc=null;if(navigator.geolocation){try{const p=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,maximumAge:2500,timeout:6500}));handleGpsPosition(p);loc=positionPayload(p)}catch{}}if(!loc&&valid(A.gps))loc={latitude:A.gps.lat,longitude:A.gps.lng,accuracy:Number(window.ChegaJaLastDriverLocation?.accuracy)||null,heading:A.lastHeading,speed:window.ChegaJaLastDriverLocation?.speed??null};if(loc){await pushLocation(loc,true);if(A.detail)autoProgress(loc,true).catch(()=>{})}}catch{}finally{A.locationBusy=false}}
'''
js=must_replace(js,startgps,heartbeat,'heartbeat GPS')

# Aceite não deve morrer por timeout temporário do GPS; usa posição persistida do servidor.
old_accept="if(action==='accept'){unlockAudio();const loc=await getPosition();if(!A.online){await api('/api/app/driver/online',{method:'POST',body:{online:true,...loc}});A.online=true;startGps(true);await pushLocation(loc,true)}const d=await acceptCall(x,loc);stopOfferAlert();A.detail={...x,status:String(d.status||'accepted'),accepted_at:new Date().toISOString(),requires_acceptance:false,updated_at:new Date().toISOString()};A.lastOfferId='';A.arrivedDelivery=false;A.wait=null;A.localPickupSince=0;A.manualView=false;A.following=true;clearRoute();updateStops();renderControls();renderSheet(true);notice('Entrega aceita. Navegação interna para a coleta iniciada.');await updateRoute(true);centralize();autoProgress(loc,true).catch(()=>{})}"
new_accept="if(action==='accept'){unlockAudio();let loc=await getPosition().catch(()=>null);if(!loc){const live=await api('/api/app/driver/live',{timeout:6000}).catch(()=>null);loc=hydrateServerGps(live)}if(!A.online){if(!loc)throw new Error('Não recebi sua localização para iniciar. Ative a localização do celular.');await api('/api/app/driver/online',{method:'POST',body:{online:true,...loc}});A.online=true;startGps(true);await pushLocation(loc,true)}const d=await acceptCall(x,loc||{});stopOfferAlert();A.detail={...x,status:String(d.status||'accepted'),accepted_at:new Date().toISOString(),requires_acceptance:false,updated_at:new Date().toISOString()};A.lastOfferId='';A.arrivedDelivery=false;A.wait=null;A.localPickupSince=0;A.manualView=false;A.following=true;clearRoute();updateStops();renderControls();renderSheet(true);closeSheet();if(!valid(A.gps)){const live=await api('/api/app/driver/live',{timeout:6000}).catch(()=>null);hydrateServerGps(live)}notice('Entrega aceita. Rota para a coleta iniciada.');await updateRoute(true);if(valid(A.gps))centralize();if(loc)autoProgress(loc,true).catch(()=>{});locationHeartbeat().catch(()=>{})}"
js=must_replace(js,old_accept,new_accept,'aceite resiliente')

# Qualquer nova oferta ou aceite ocorrido fora do dashboard leva direto ao mapa atual, sem menu intermediário.
anchor="async function getSchedules(){const now=new Date(),from=now.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),end=new Date(`${from}T12:00:00`);end.setDate(end.getDate()+7);try{return(await api(`/api/app/v18/driver/schedule?from=${from}&to=${end.toISOString().slice(0,10)}`,{timeout:6500})).items||[]}catch{return[]}}"
force_home=anchor+r'''
async function forceDriverHome(){if(!isDriver())return;if(window.state)window.state.page='dashboard';document.body.classList.remove('cj199-driver-page');document.body.classList.add('cj199-driver');$('#auth-screen')?.classList.add('hidden');$('#customer-screen')?.classList.add('hidden');$('#tracking-screen')?.classList.add('hidden');$('#app-shell')?.classList.remove('hidden');const content=$('#page-content');if(!content)return;ensureApp(content);try{await ensureMap()}catch{}preserveResize()}
'''
js=must_replace(js,anchor,force_home,'retorno automático ao mapa')

# Hidrata A.gps com a última coordenada persistida sempre que necessário.
js=must_replace(js,
"A.online=Boolean(Number(live.driver?.online));if(window.state)",
"A.online=Boolean(Number(live.driver?.online));if(!valid(A.gps))hydrateServerGps(live);if(window.state)",
'hidratação no poll')

# Se oferta nova/status mudou enquanto estava em outra aba, tomar a tela com o mapa/oferta.
old_changed="const previousId=String(A.detail?.id||''),previousStatus=String(A.detail?.status||''),changed=String(item.id)!==previousId||String(item.status)!==previousStatus;if(String(item.id)!==previousId)"
new_changed="const previousId=String(A.detail?.id||''),previousStatus=String(A.detail?.status||''),changed=String(item.id)!==previousId||String(item.status)!==previousStatus;if(!isHome()&&(offerRequired(item)||changed))await forceDriverHome();if(String(item.id)!==previousId)"
js=must_replace(js,old_changed,new_changed,'oferta toma a tela')

# SOS passa a pertencer ao mesmo v217, usando a rota v32 atual.
sos=r'''
async function sendSos(){if(A.decision)return;if(!confirm('Enviar pedido de socorro agora para a operação?'))return;A.decision=true;try{let loc=await getPosition().catch(()=>null);if(!loc){const live=await api('/api/app/driver/live',{timeout:5500}).catch(()=>null);loc=hydrateServerGps(live)}const d=await api('/api/app/v32/driver/sos',{method:'POST',body:{occurrence:'Pedido de socorro enviado pelo cooperado no aplicativo.',...(loc||{})},timeout:10000});navigator.vibrate?.([420,120,420]);notice(d.message||'Pedido de socorro enviado.')}catch(e){notice(e.message||'Não foi possível enviar o pedido de socorro.',true)}finally{A.decision=false}}
'''
js=must_replace(js,"async function logoutDriver(){",sos+"async function logoutDriver(){",'SOS v32')
js=must_replace(js,
"$('#cj199-checkin').onclick=checkin;$('#cj199-center').onclick=centralize;",
"$('#cj199-checkin').onclick=checkin;$('#cj217-sos').onclick=sendSos;$('#cj199-center').onclick=centralize;",
'bind SOS')

# Timer de localização a cada 7 s, além do watchPosition.
old_timers="function startTimers(){clearInterval(A.pollTimer);clearInterval(A.routeTimer);clearInterval(A.waitPollTimer);clearInterval(A.waitUiTimer);A.pollTimer=setInterval(()=>poll(false),6000);A.routeTimer=setInterval(()=>updateRoute(false),5500);A.waitPollTimer=setInterval(()=>{if(isHome()&&String(A.detail?.status)==='at_pickup')syncWait(false)},7000);A.waitUiTimer=setInterval(paintWait,1000)}"
new_timers="function startTimers(){clearInterval(A.pollTimer);clearInterval(A.routeTimer);clearInterval(A.waitPollTimer);clearInterval(A.waitUiTimer);clearInterval(A.locationTimer);A.pollTimer=setInterval(()=>poll(false),6000);A.routeTimer=setInterval(()=>updateRoute(false),5500);A.locationTimer=setInterval(()=>locationHeartbeat(),7000);A.waitPollTimer=setInterval(()=>{if(isHome()&&String(A.detail?.status)==='at_pickup')syncWait(false)},7000);A.waitUiTimer=setInterval(paintWait,1000);locationHeartbeat().catch(()=>{})}"
js=must_replace(js,old_timers,new_timers,'timer heartbeat')
write(jsp,js)

# 2) Um único CSS do cooperado: funde visual necessário na folha canônica e remove dependência de folhas antigas.
css_files=[
 'public/chegaja-v199-driver.css',
 'public/chegaja-v205-driver-fixes.css',
 'public/chegaja-v222-driver-stability.css',
 'public/chegaja-v223-driver-final.css',
 'public/chegaja-v225-driver-polish.css',
 'public/chegaja-v217-driver-navigation.css',
]
parts=[]
for f in css_files:
    parts.append(read(Path(f)))
final_overrides=r'''

/* ChegaJá 14.33.17 — regras finais do painel canônico único */
body.cj217-active-delivery #cj199-start{display:none!important;visibility:hidden!important;pointer-events:none!important}
#cj217-sos{position:absolute;z-index:36;left:14px;bottom:112px;width:62px;height:62px;border:4px solid #fff;border-radius:50%;background:#c62828;color:#fff;box-shadow:0 7px 20px #10275f35;display:grid;place-content:center;gap:0;text-align:center;font-weight:950;pointer-events:auto!important}
#cj217-sos b{font-size:24px;line-height:.9}#cj217-sos small{font-size:9px;font-weight:950;letter-spacing:.08em}
body.cj217-pending-offer #cj199-sheet{position:fixed!important;z-index:170!important;inset:0!important;width:100vw!important;height:100dvh!important;max-height:none!important;border-radius:0!important;transform:none!important;background:#f4f7fb!important;box-shadow:none!important;pointer-events:auto!important}
body.cj217-pending-offer #cj199-sheet>.handle{display:none!important}
body.cj217-pending-offer #cj199-sheet>header{height:78px!important;padding:max(12px,env(safe-area-inset-top)) 18px 10px!important;background:linear-gradient(145deg,#0a2f96,#1459ff)!important;border:0!important;color:#fff!important;box-sizing:border-box!important}
body.cj217-pending-offer #cj199-sheet>header small,body.cj217-pending-offer #cj199-sheet>header strong{color:#fff!important}
body.cj217-pending-offer #cj199-sheet>header #cj199-down{display:none!important}
body.cj217-pending-offer #cj199-schedules{height:calc(100dvh - 78px)!important;padding:14px 14px calc(108px + env(safe-area-inset-bottom))!important;background:#f4f7fb!important;overflow-y:auto!important}
body.cj217-pending-offer .cj217-sheet{min-height:100%;display:flex!important;flex-direction:column!important;gap:10px!important}
body.cj217-pending-offer .cj217-delivery-head{order:-5!important}
body.cj217-pending-offer .cj217-secondary-actions{position:fixed!important;z-index:175!important;left:0!important;right:0!important;bottom:0!important;padding:12px 12px max(14px,env(safe-area-inset-bottom))!important;background:#fff!important;border-top:1px solid #d9e2ef!important;box-shadow:0 -8px 26px #10275f1f!important;display:grid!important;grid-template-columns:1.25fr .9fr!important;gap:10px!important}
body.cj217-pending-offer .cj217-secondary-actions button{min-height:64px!important;border-radius:17px!important;font-size:14px!important;font-weight:950!important;pointer-events:auto!important}
body.cj217-pending-offer #cj217-accept{background:#ff7a00!important;color:#fff!important;box-shadow:0 7px 18px #ff7a0038!important}
body.cj217-pending-offer #cj217-secondary.danger{background:#fff0f1!important;color:#b4232d!important;border:1px solid #ffd0d4!important}
body.cj217-pending-offer #cj199-map,body.cj217-pending-offer #cj199-metric,body.cj217-pending-offer #cj199-queue,body.cj217-pending-offer #cj199-center,body.cj217-pending-offer #cj199-checkin,body.cj217-pending-offer #cj217-sos,body.cj217-pending-offer #cj199-bottom{pointer-events:none!important}
@media(max-width:390px){#cj217-sos{width:54px;height:54px;left:10px;bottom:108px}body.cj217-pending-offer .cj217-secondary-actions button{min-height:58px!important;font-size:13px!important}}
'''
combined='/* ChegaJá 14.33.17 — ÚNICA folha do painel do cooperado. Conteúdo consolidado das regras necessárias. */\n'+"\n\n".join(parts)+final_overrides
write(Path('public/chegaja-v217-driver-navigation.css'),combined)

# 3) Index: somente v217 para o painel do cooperado.
idxp=Path('public/index.html'); idx=read(idxp)
idx=idx.replace('<meta name="app-version" content="14.33.15" />','<meta name="app-version" content="14.33.17" />')
for name in [
 'chegaja-v199-driver.css','chegaja-v205-driver-fixes.css','chegaja-v222-driver-stability.css','chegaja-v223-driver-final.css','chegaja-v225-driver-polish.css'
]:
    idx=re.sub(r'\s*<link rel="stylesheet" href="/'+re.escape(name)+r'[^\"]*"\s*/>','',idx)
idx=re.sub(r'<script src="/chegaja-v205-driver-fixes\.js[^\"]*" defer></script>','',idx)
idx=re.sub(r'chegaja-v217-driver-navigation\.css\?v=[^&\"]+&recovery=\d+','chegaja-v217-driver-navigation.css?v=14.33.17&recovery=143317',idx)
idx=re.sub(r'chegaja-v217-driver-navigation\.js\?v=[^&\"]+&recovery=\d+','chegaja-v217-driver-navigation.js?v=14.33.17&recovery=143317',idx)
write(idxp,idx)

# 4) Base/dispatcher/cooperativa: atualizar mapa/lista automaticamente a cada 6 s.
appp=Path('public/app.js'); app=read(appp)
pattern=r"pages\.tracking=async\(\)=>\{.*?\};\n\npages\.prices="
m=re.search(pattern,app,re.S)
if not m: raise RuntimeError('pages.tracking não encontrado no app.js')
tracking=r'''pages.tracking=async()=>{if(state.timer){clearInterval(state.timer);state.timer=null}const refreshTracking=async()=>{if(state.page!=='tracking')return;const d=await api(`/api/app/online-drivers${query(scopeParams())}`);$('#page-content').innerHTML=panel('Cooperados online da cooperativa',`<div id="live-map" class="map"></div>`)+panel('Lista de cooperados',table([{label:'Cooperado',key:'name'},{label:'Telefone',key:'phone'},{label:'Moto',render:r=>esc([r.vehicle_model,r.vehicle_plate].filter(Boolean).join(' • ')||'—')},{label:'Online',render:r=>badge(r.online?'active':'inactive')},{label:'Última atualização',render:r=>dateTime(r.location_updated_at||r.last_seen_at)}],d.items));if(state.map){try{state.map.remove()}catch{}state.map=null}state.map=L.map('live-map').setView([-5.7945,-35.211],12);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(state.map);const pts=[];(d.items||[]).filter(x=>x.online&&x.current_lat!=null&&x.current_lng!=null).forEach(x=>{L.marker([x.current_lat,x.current_lng]).addTo(state.map).bindPopup(`<strong>${esc(x.name)}</strong><br>${esc(x.vehicle_plate||'')}<br>${dateTime(x.location_updated_at)}`);pts.push([x.current_lat,x.current_lng])});if(pts.length)state.map.fitBounds(pts,{padding:[35,35],maxZoom:17})};await refreshTracking();state.timer=setInterval(()=>{if(state.page==='tracking'&&!document.hidden)refreshTracking().catch(()=>{})},6000)};

pages.prices='''
app=app[:m.start()]+tracking+app[m.end():]
app=app.replace('state.timer=setInterval(refresh,12000)','state.timer=setInterval(refresh,6000)')
write(appp,app)

# 5) Mapa do estabelecimento: mesma cadência de 6 s.
op=Path('public/chegaja-v201-operational.js'); operational=read(op)
operational=operational.replace('R.timer=setTimeout(tick,10000)','R.timer=setTimeout(tick,6000)')
write(op,operational)

# 6) Teste regressivo focado no runtime único e rastreamento contínuo.
test=Path('scripts/test-v14153-logo-google-maps.mjs')
write(test,r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=file=>readFileSync(file,'utf8');
const index=read('public/index.html');
const driver=read('public/chegaja-v217-driver-navigation.js');
const driverCss=read('public/chegaja-v217-driver-navigation.css');
const app=read('public/app.js');
const operational=read('public/chegaja-v201-operational.js');
const driverLive=read('src/routes/driver-live.ts');
const mapSafe=read('src/routes/map-safe.ts');
const navigation=read('src/routes/platform-v32.ts');

assert.match(index,/app-version" content="14\.33\.17"/);
assert.match(index,/chegaja-v217-driver-navigation\.js\?v=14\.33\.17&recovery=143317/);
assert.match(index,/chegaja-v217-driver-navigation\.css\?v=14\.33\.17&recovery=143317/);
for(const old of ['chegaja-v199-driver.css','chegaja-v205-driver-fixes.css','chegaja-v222-driver-stability.css','chegaja-v223-driver-final.css','chegaja-v225-driver-polish.css','chegaja-v205-driver-fixes.js']) assert.equal(index.includes(old),false,`asset antigo carregado: ${old}`);
assert.doesNotMatch(index,/chegaja-v230-base-toast-filter|chegaja-v232-navigation-final/);

assert.match(driver,/ChegaJá 14\.33\.17/);
assert.match(driver,/start\.hidden=work/);
assert.match(driver,/phoneTone/);
assert.match(driver,/setInterval\(fire,3400\)/);
assert.doesNotMatch(driver,/offerAlertCount>=6/);
assert.match(driver,/forceDriverHome/);
assert.match(driver,/if\(!isHome\(\)&&\(offerRequired\(item\)\|\|changed\)\)await forceDriverHome\(\)/);
assert.match(driver,/hydrateServerGps/);
assert.match(driver,/async function locationHeartbeat/);
assert.match(driver,/maximumAge:2500,timeout:6500/);
assert.match(driver,/A\.locationTimer=setInterval\(\(\)=>locationHeartbeat\(\),7000\)/);
assert.match(driver,/closeSheet\(\);if\(!valid\(A\.gps\)\)/);
assert.match(driver,/\/api\/app\/v32\/driver\/sos/);
assert.match(driver,/id="cj217-sos"/);
assert.match(driver,/router\.project-osrm\.org/);
assert.match(driver,/const NAV_ZOOM=18\.5/);

assert.match(driverCss,/ÚNICA folha do painel do cooperado/);
assert.match(driverCss,/body\.cj217-active-delivery #cj199-start\{display:none!important/);
assert.match(driverCss,/body\.cj217-pending-offer #cj199-sheet\{position:fixed!important/);
assert.match(driverCss,/grid-template-columns:1\.25fr \.9fr/);
assert.match(driverCss,/#cj217-sos/);

assert.match(app,/state\.timer=setInterval\(\(\)=>\{if\(state\.page==='tracking'/);
assert.match(app,/},6000\)\};/);
assert.match(app,/state\.timer=setInterval\(refresh,6000\)/);
assert.match(operational,/R\.timer=setTimeout\(tick,6000\)/);
assert.match(driverLive,/Finalize ou resolva suas entregas ativas antes de ficar offline/);
assert.match(mapSafe,/d\.current_lat IS NOT NULL AND d\.current_lng IS NOT NULL/);
assert.match(navigation,/platformV32Routes\.post\('\/v32\/driver\/sos'/);
console.log('ChegaJá 14.33.17: painel único, oferta full-screen, navegação após aceite e GPS contínuo validados.');
''')

print('Consolidação 14.33.17 aplicada com sucesso.')
