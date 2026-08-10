/* ChegaJá 14.32.0 — painel único do cooperado com Leaflet + OpenStreetMap */
(()=>{
'use strict';
if(window.__CJ_DRIVER_LEAFLET_14320__)return;
window.__CJ_DRIVER_LEAFLET_14320__=true;

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)/100);
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
const isHome=()=>isDriver()&&window.state?.page==='dashboard';
const valid=p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lng))&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lng))<=180;
const point=(lat,lng)=>({lat:Number(lat),lng:Number(lng)});

const A={
 installed:false,oldDashboard:null,oldNavigate:null,mounted:false,
 map:null,mapHost:null,self:null,pickup:null,delivery:null,casing:null,line:null,
 gps:null,gpsWatch:null,firstGpsCentered:false,manualView:false,programmatic:false,following:true,lastSent:0,
 detail:null,online:false,queue:null,summary:null,schedules:[],decision:false,lastOfferId:'',audio:null,audioUnlocked:false,
 pollTimer:null,routeTimer:null,healthTimer:null,routeBusy:false,lastRouteAt:0,lastRouteOrigin:null,lastRouteTarget:null,routePoints:[],sheetKey:'',touchY:null,
 resizeObserver:null,resizeTimer:null
};

async function api(path,opt={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||8000);
 try{
  const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
  return data;
 }catch(error){if(error?.name==='AbortError')throw new Error('A conexão demorou. Tente novamente.');throw error}
 finally{clearTimeout(timer)}
}
function notice(text,error=false){
 let node=$('#cj217-notice');if(!node){node=document.createElement('div');node.id='cj217-notice';document.body.appendChild(node)}
 node.textContent=String(text||'');node.className=`show${error?' error':''}`;clearTimeout(node._timer);node._timer=setTimeout(()=>node.className='',4200);
}
function removeLegacy(){
 ['#cj196-driver-app','#cj24-driver-app','#cj190-drawer','#cj190-page-menu','#cj212-call','#cj214-internal','#cj217-nav','.v31-driver-app','.v31-driver-bottom','.driver-bottom-nav','.mobile-bottom-nav','.bottom-navigation'].forEach(s=>$$(s).forEach(n=>n.remove()));
 try{window.ChegaJaV31?.stopDriver?.()}catch{}
}
function shell(){return `<main id="cj199-app" aria-label="Painel do cooperado">
 <div id="cj199-map" aria-label="Mapa OpenStreetMap do cooperado"></div>
 <button id="cj199-metric" type="button"><small id="cj199-metric-label">GANHOS HOJE</small><strong id="cj199-metric-value">R$ 0,00</strong><span id="cj199-metric-hint">Acompanhe sua operação</span></button>
 <button id="cj199-queue" type="button"><small>FILA</small><strong id="cj199-queue-number">+</strong></button>
 <button id="cj199-center" type="button" aria-label="Centralizar na minha localização">◎</button>
 <button id="cj199-start" type="button"><span>INICIAR</span></button>
 <button id="cj199-checkin" type="button"><b>✓</b><small>CHECK-IN</small></button>
 <section id="cj199-bottom"><button id="cj199-up" type="button" aria-label="Abrir painel">⌃</button><div><strong id="cj199-online">Você está offline</strong><small id="cj199-queue-text">Você está fora da fila</small></div><button id="cj199-menu" type="button" aria-label="Abrir menu">☰</button></section>
 <section id="cj199-sheet"><button class="handle" type="button" aria-label="Fechar painel"></button><header><div><small>MINHA ESCALA</small><strong>Datas, horários e locais</strong></div><button id="cj199-down" type="button">⌄</button></header><div id="cj199-schedules"><p class="empty">Carregando…</p></div></section>
 <div id="cj199-drawer"><button class="backdrop" type="button"></button><aside><header><div id="cj199-photo">CJ</div><span><strong id="cj199-name">Cooperado</strong><small>Meu aplicativo</small></span><button data-close type="button">×</button></header><nav><button data-go="dashboard">Início</button><button data-go="deliveries">Entregas</button><button data-go="schedules">Minha escala</button><button data-go="routes">Rotas</button><button data-go="financial">Ganhos e descontos</button><button data-go="advances">Adiantamentos</button><button data-checkin>Fazer check-in</button><button data-go="ratings">Avaliações</button><button data-go="profile">Perfil e configurações</button><button data-go="account">Alterar senha</button><button data-logout>Sair</button></nav></aside></div>
 </main>`}

function currentCenter(){try{const c=A.map?.getCenter?.();return c?{lat:c.lat,lng:c.lng}:null}catch{return null}}
function selfIcon(){return L.divIcon({className:'cj217-self-icon',html:'<span class="cj217-self-marker"></span>',iconSize:[34,34],iconAnchor:[17,17]})}
function stopIcon(kind){return L.divIcon({className:`cj217-stop-icon ${kind}`,html:`<span>${kind==='pickup'?'C':'E'}</span>`,iconSize:[34,34],iconAnchor:[17,17]})}
function ensureSelfMarker(){
 if(!A.map||!valid(A.gps))return;
 if(!A.self)A.self=L.marker([A.gps.lat,A.gps.lng],{icon:selfIcon(),zIndexOffset:1000,keyboard:false,title:'Sua localização'}).addTo(A.map);
 else A.self.setLatLng([A.gps.lat,A.gps.lng]);
}
function markerPosition(marker,p){if(!marker||!valid(p))return null;marker.setLatLng([p.lat,p.lng]);return marker}
function updateStops(){
 if(!A.map)return;const item=A.detail;
 if(!item){A.pickup?.remove();A.delivery?.remove();A.pickup=A.delivery=null;return}
 const pickup=point(item.pickup_lat,item.pickup_lng),delivery=point(item.delivery_lat,item.delivery_lng);
 if(valid(pickup)){if(!A.pickup)A.pickup=L.marker([pickup.lat,pickup.lng],{icon:stopIcon('pickup'),title:'Coleta',keyboard:false}).addTo(A.map);else markerPosition(A.pickup,pickup)}else{A.pickup?.remove();A.pickup=null}
 if(valid(delivery)){if(!A.delivery)A.delivery=L.marker([delivery.lat,delivery.lng],{icon:stopIcon('delivery'),title:'Entrega',keyboard:false}).addTo(A.map);else markerPosition(A.delivery,delivery)}else{A.delivery?.remove();A.delivery=null}
}
function bindMapInteraction(){
 if(!A.map||A.map.__cj217Bound)return;A.map.__cj217Bound=true;
 const manual=()=>{if(!A.programmatic){A.manualView=true;A.following=false;$('#cj199-center')?.classList.add('manual')}};
 A.map.on('dragstart',manual);A.map.on('zoomstart',manual);
}
async function ensureMap(){
 const host=$('#cj199-map');if(!host||typeof L==='undefined')throw new Error('O mapa não carregou. Atualize a página.');
 if(A.map&&A.mapHost===host){preserveResize();return}
 destroyMap();A.mapHost=host;host.replaceChildren();
 const center=valid(A.gps)?A.gps:{lat:-5.7945,lng:-35.211};
 A.map=L.map(host,{zoomControl:true,attributionControl:true,preferCanvas:true,zoomSnap:.5,zoomDelta:.5,fadeAnimation:false,markerZoomAnimation:false}).setView([center.lat,center.lng],valid(A.gps)?17:13);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,maxNativeZoom:19,updateWhenIdle:true,keepBuffer:7,attribution:'© OpenStreetMap'}).addTo(A.map);
 bindMapInteraction();ensureSelfMarker();updateStops();if(A.routePoints.length)drawRoute(A.routePoints);
 window.ChegaJaDriverMap={map:A.map,move:raw=>{const p=point(raw?.lat??raw?.latitude,raw?.lng??raw?.longitude);if(valid(p)){A.gps=p;ensureSelfMarker();followGps()}},follow:enabled=>{A.following=Boolean(enabled);A.manualView=!A.following}};
 if(typeof ResizeObserver!=='undefined'){A.resizeObserver=new ResizeObserver(()=>preserveResize());A.resizeObserver.observe(host)}
 requestAnimationFrame(()=>requestAnimationFrame(()=>A.map?.invalidateSize(false)));
}
function destroyMap(){
 try{A.resizeObserver?.disconnect()}catch{}A.resizeObserver=null;
 for(const layer of[A.casing,A.line,A.self,A.pickup,A.delivery])try{layer?.remove()}catch{}
 A.casing=A.line=A.self=A.pickup=A.delivery=null;
 if(A.map)try{A.map.remove()}catch{}A.map=null;A.mapHost=null;
}
function clearRoute(){try{A.casing?.remove();A.line?.remove()}catch{}A.casing=A.line=null;A.routePoints=[];A.lastRouteOrigin=A.lastRouteTarget=null}
function normalizeGeometry(raw){
 let data=raw;for(let i=0;i<2&&typeof data==='string';i++){try{data=JSON.parse(data)}catch{return[]}}
 if(data?.type==='Feature')data=data.geometry;
 if(data?.type==='LineString')data=data.coordinates;
 if(data?.geometry)data=data.geometry.coordinates||data.geometry;
 if(!Array.isArray(data))return[];
 const direct=data.map(p=>Array.isArray(p)?point(p[0],p[1]):point(p?.lat??p?.latitude,p?.lng??p?.longitude)).filter(valid);
 const swapped=data.map(p=>Array.isArray(p)?point(p[1],p[0]):point(p?.lat??p?.latitude,p?.lng??p?.longitude)).filter(valid);
 const gps=A.gps,target=targetPoint();
 const score=list=>{if(list.length<2)return Infinity;let total=0;if(valid(gps))total+=distance(gps,list[0]);if(valid(target))total+=Math.min(distance(target,list[0]),distance(target,list.at(-1)));return total};
 let points=score(swapped)<score(direct)?swapped:direct;
 if(valid(gps)&&points.length>1&&distance(gps,points.at(-1))<distance(gps,points[0]))points=[...points].reverse();
 return points;
}
function drawRoute(points){
 if(!A.map||!Array.isArray(points)||points.length<2)return;
 const path=points.map(p=>point(p.lat,p.lng)).filter(valid);if(path.length<2)return;A.routePoints=path;
 const latlngs=path.map(p=>[p.lat,p.lng]);
 if(!A.casing)A.casing=L.polyline(latlngs,{color:'#fff',weight:14,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,pane:'overlayPane'}).addTo(A.map);else A.casing.setLatLngs(latlngs);
 if(!A.line)A.line=L.polyline(latlngs,{color:'#1459ff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,pane:'overlayPane'}).addTo(A.map);else A.line.setLatLngs(latlngs);
 A.casing.bringToFront?.();A.line.bringToFront?.();
}
function geometryPoints(raw){return normalizeGeometry(raw)}
function targetPoint(){
 const item=A.detail;if(!item)return null;const delivering=['picked_up','in_route','problem'].includes(String(item.status));
 const p=point(delivering?item.delivery_lat:item.pickup_lat,delivering?item.delivery_lng:item.pickup_lng);return valid(p)?p:null;
}
function distance(a,b){
 if(!valid(a)||!valid(b))return Infinity;const rad=v=>v*Math.PI/180,r=6371000,dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;return 2*r*Math.asin(Math.min(1,Math.sqrt(h)));
}
function snapSelfToRoute(){
 ensureSelfMarker();if(!A.self||!valid(A.gps)||A.routePoints.length<2)return;
 let best=A.gps,bestDistance=Infinity,step=Math.max(1,Math.floor(A.routePoints.length/350));
 for(let i=0;i<A.routePoints.length;i+=step){const d=distance(A.gps,A.routePoints[i]);if(d<bestDistance){bestDistance=d;best=A.routePoints[i]}}
 A.self.setLatLng([bestDistance<=80?best.lat:A.gps.lat,bestDistance<=80?best.lng:A.gps.lng]);
}
function shouldRefreshRoute(force=false){
 if(force)return true;const origin=A.gps,target=targetPoint();if(!valid(origin)||!valid(target))return false;
 if(Date.now()-A.lastRouteAt<12000)return false;
 if(!A.lastRouteOrigin||!A.lastRouteTarget)return true;
 return distance(origin,A.lastRouteOrigin)>55||distance(target,A.lastRouteTarget)>15||A.routePoints.length<2;
}
async function osrmFallback(origin,destination){
 if(!valid(origin)||!valid(destination))return[];
 try{
  const url=`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
  const response=await fetch(url,{cache:'no-store'});if(!response.ok)return[];
  const data=await response.json().catch(()=>null);return geometryPoints(data?.routes?.[0]?.geometry);
 }catch{return[]}
}
async function updateRoute(force=false){
 if(!A.detail||!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(A.detail.status))||A.routeBusy||document.hidden)return;
 if(!shouldRefreshRoute(force))return;const origin=A.gps,target=targetPoint();if(!valid(origin)||!valid(target))return;
 A.lastRouteAt=Date.now();A.routeBusy=true;
 try{
  const data=await api('/api/app/v32/driver/navigation',{timeout:9000});let points=geometryPoints(data.route?.geometry);
  if(points.length<2&&!data.arrived)points=await osrmFallback(origin,target);
  if(points.length>=2){A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(points)}
  else if(data.arrived)clearRoute();
 }catch{const points=await osrmFallback(origin,target);if(points.length>=2){A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(points)}}
 finally{A.routeBusy=false}
}
function followGps(){
 if(!A.map||!valid(A.gps)||A.manualView||!A.following)return;
 A.programmatic=true;A.map.panTo([A.gps.lat,A.gps.lng],{animate:false});setTimeout(()=>A.programmatic=false,70);
}
function centralize(){
 if(!A.map||!valid(A.gps))return notice('Aguardando a localização do GPS.',true);
 A.manualView=false;A.following=true;$('#cj199-center')?.classList.remove('manual');A.programmatic=true;
 A.map.setView([A.gps.lat,A.gps.lng],18,{animate:false});setTimeout(()=>A.programmatic=false,120);
}
function preserveResize(){
 if(!A.map)return;clearTimeout(A.resizeTimer);const center=currentCenter(),zoom=A.map.getZoom();
 A.resizeTimer=setTimeout(()=>{for(const delay of[0,90,260])setTimeout(()=>requestAnimationFrame(()=>{try{A.map.invalidateSize(false);if(center&&!A.following){A.programmatic=true;A.map.setView([center.lat,center.lng],zoom,{animate:false});setTimeout(()=>A.programmatic=false,70)}if(A.routePoints.length)drawRoute(A.routePoints)}catch{}}),delay)},20);
}

function offerRequired(item){return Boolean(item)&&(['offered','assigned'].includes(String(item.status))||Boolean(item.requires_acceptance))&&!item.accepted_at}
function actionFor(item){
 if(!item)return null;if(offerRequired(item))return{label:'NOVA ENTREGA',text:'ACEITAR ENTREGA',hint:'Toque para aceitar',action:'accept'};
 if(['accepted','to_pickup','at_pickup'].includes(String(item.status)))return{label:'COLETA',text:'COLETA REALIZADA',hint:'Toque após receber o item',action:'picked_up'};
 if(item.status==='picked_up')return{label:'PRÓXIMA ETAPA',text:'INICIAR ENTREGA',hint:'Seguir até o cliente',action:'in_route'};
 if(['in_route','problem'].includes(String(item.status)))return{label:'ENTREGA',text:'FINALIZAR ENTREGA',hint:'Será solicitado o código',action:'complete'};
 return null;
}
function applyMetric(){
 const card=$('#cj199-metric'),label=$('#cj199-metric-label'),value=$('#cj199-metric-value'),hint=$('#cj199-metric-hint');if(!card)return;
 const action=actionFor(A.detail);card.classList.toggle('cj217-action-card',Boolean(action));card.classList.toggle('busy',A.decision);card.disabled=A.decision;
 if(action){label.textContent=A.decision?'PROCESSANDO':action.label;value.textContent=A.decision?'AGUARDE…':action.text;hint.textContent=A.decision?'Não feche esta tela':action.hint}
 else{label.textContent='GANHOS HOJE';value.textContent=money(A.summary?.earnings_today_cents||0);hint.textContent=`${Number(A.summary?.deliveries_today||0)} entrega(s) concluída(s) hoje`}
}
function statusText(status){return({offered:'Nova entrega',assigned:'Aguardando aceite',accepted:'Indo para coleta',to_pickup:'Indo para coleta',at_pickup:'No local da coleta',picked_up:'Item coletado',in_route:'Em rota para entrega',problem:'Atenção necessária'})[String(status||'')]||'Entrega atual'}
function openSheet(){const sheet=$('#cj199-sheet');if(!sheet)return;sheet.hidden=false;sheet.classList.add('open');const up=$('#cj199-up');if(up)up.textContent='⌄';setTimeout(preserveResize,180)}
function closeSheet(){$('#cj199-sheet')?.classList.remove('open');const up=$('#cj199-up');if(up)up.textContent='⌃';setTimeout(preserveResize,180)}
function renderSheet(force=false){
 const host=$('#cj199-schedules');if(!host)return;
 if(!A.detail){renderSchedules();return}
 const item=A.detail,key=[item.id,item.status,item.updated_at||''].join('|');if(!force&&key===A.sheetKey&&host.querySelector('.cj217-sheet'))return;A.sheetKey=key;
 const offer=offerRequired(item);
 host.innerHTML=`<section class="cj217-sheet"><div class="cj217-delivery-head"><div><small>${offer?'NOVA ENTREGA':'ENTREGA ATUAL'}</small><strong>${esc(item.display_code||'Entrega')}</strong></div><span>${esc(statusText(item.status))}</span></div><article class="cj217-address"><b>C</b><div><small>COLETA</small><strong>${esc(item.pickup_address||'Endereço não informado')}</strong>${item.pickup_complement?`<span>${esc(item.pickup_complement)}</span>`:''}</div></article><article class="cj217-address"><b>E</b><div><small>ENTREGA</small><strong>${esc(item.delivery_address||'Endereço não informado')}</strong>${item.delivery_complement?`<span>${esc(item.delivery_complement)}</span>`:''}</div></article><div class="cj217-values"><span><small>VOCÊ RECEBE</small><b>${money(item.driver_net_cents??item.driver_earnings_cents??item.charge_cents??0)}</b></span><span><small>PAGAMENTO</small><b>${esc(String(item.payment_method||'—').toUpperCase())}</b></span><span><small>DISTÂNCIA</small><b>${Number(item.distance_meters||0)>=1000?`${(Number(item.distance_meters)/1000).toFixed(1).replace('.',',')} km`:`${Math.round(Number(item.distance_meters||0))} m`}</b></span><span><small>TEMPO</small><b>${Math.max(1,Math.round(Number(item.duration_seconds||0)/60))} min</b></span></div>${item.notes?`<p class="cj217-notes"><b>Observações:</b> ${esc(item.notes)}</p>`:''}<div class="cj217-secondary-actions"><button id="cj217-secondary" class="danger" type="button">${offer?'RECUSAR':'CANCELAR ENTREGA'}</button><button id="cj217-open-maps" type="button">ABRIR ROTA EXTERNA</button></div></section>`;
 const title=$('#cj199-sheet header strong'),small=$('#cj199-sheet header small');if(title)title.textContent=item.display_code||'Entrega atual';if(small)small.textContent=offer?'NOVA ENTREGA':'ENTREGA ATUAL';
 $('#cj217-secondary').onclick=()=>offer?decline():cancelDelivery();$('#cj217-open-maps').onclick=openExternalMaps;
}
function renderSchedules(){
 const host=$('#cj199-schedules');if(!host||A.detail)return;A.sheetKey='';
 host.innerHTML=A.schedules.length?A.schedules.map(item=>{const raw=String(item.start_at||''),date=raw.slice(0,10),d=date?new Date(`${date}T12:00:00`):null;return `<article><div class="date"><small>${d?d.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','').toUpperCase():''}</small><strong>${d?String(d.getDate()).padStart(2,'0'):''}</strong><span>${d?d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','').toUpperCase():''}</span></div><div class="info"><strong>${esc(item.location_name||item.contract_name||item.base_name||item.establishment_name||'Local da escala')}</strong><b>${esc(raw.slice(11,16))} às ${esc(String(item.end_at||'').slice(11,16))}</b><p>${esc(item.location_address||item.base_address||item.establishment_address||item.address||'Endereço não informado')}</p></div></article>`}).join(''):'<p class="empty">Sem escala cadastrada para os próximos dias.</p>';
 const title=$('#cj199-sheet header strong'),small=$('#cj199-sheet header small');if(title)title.textContent='Datas, horários e locais';if(small)small.textContent='MINHA ESCALA';
}
function renderControls(){
 const work=Boolean(A.detail);document.body.classList.toggle('cj217-active-delivery',work);document.body.classList.toggle('cj217-pending-offer',offerRequired(A.detail));
 $('#cj199-start')?.classList.toggle('online',A.online);if($('#cj199-start span'))$('#cj199-start span').textContent=A.online?'PARAR':'INICIAR';
 if($('#cj199-start'))$('#cj199-start').hidden=work;if($('#cj199-checkin'))$('#cj199-checkin').hidden=work;
 if($('#cj199-online'))$('#cj199-online').textContent=A.online?'Você está online':'Você está offline';
 if($('#cj199-queue-number'))$('#cj199-queue-number').textContent=A.queue?String(A.queue.queue_position||1):'+';
 $('#cj199-queue')?.classList.toggle('active',Boolean(A.queue));if($('#cj199-queue-text'))$('#cj199-queue-text').textContent=A.queue?`Você é o ${A.queue.queue_position||1}º da fila`:'Você está fora da fila';
 applyMetric();renderSheet();window.ChegaJaDriverActiveDelivery=A.detail||null;
}

function unlockAudio(){
 A.audioUnlocked=true;try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;A.audio=A.audio||new C();A.audio.resume?.();if(!A.audio.__unlocked){const o=A.audio.createOscillator(),g=A.audio.createGain();g.gain.value=.000001;o.connect(g);g.connect(A.audio.destination);o.start();o.stop(A.audio.currentTime+.025);A.audio.__unlocked=true}}catch{}
}
function ring(){
 unlockAudio();const c=A.audio;if(!c||c.state!=='running'){navigator.vibrate?.([300,120,300]);return}const start=c.currentTime+.02;
 for(const tone of[{f:760,t:0,d:.2},{f:980,t:.28,d:.23},{f:1220,t:.62,d:.36}])try{const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(tone.f,start+tone.t);g.gain.setValueAtTime(.0001,start+tone.t);g.gain.exponentialRampToValueAtTime(.34,start+tone.t+.025);g.gain.exponentialRampToValueAtTime(.0001,start+tone.t+tone.d);o.connect(g);g.connect(c.destination);o.start(start+tone.t);o.stop(start+tone.t+tone.d+.04)}catch{}
 navigator.vibrate?.([300,120,300]);
}
function notifyOffer(item){const id=String(item?.id||'');if(!id||id===A.lastOfferId)return;A.lastOfferId=id;ring();setTimeout(()=>{if(offerRequired(A.detail))ring()},1700);openSheet()}
async function getPosition(){
 if(valid(A.gps))return{latitude:A.gps.lat,longitude:A.gps.lng,accuracy:Number(window.ChegaJaLastDriverLocation?.accuracy)||null};
 return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}),()=>reject(new Error('Autorize a localização precisa para continuar.')),{enableHighAccuracy:true,maximumAge:2500,timeout:7000}):reject(new Error('GPS indisponível.')));
}
async function postStatus(id,status){return api(`/api/app/v6/driver/deliveries/${encodeURIComponent(id)}/status`,{method:'POST',body:{status},timeout:9000})}
async function performAction(action){
 if(A.decision||!A.detail?.id)return;A.decision=true;applyMetric();const item=A.detail;
 try{
  if(action==='accept'){
   const location=await getPosition();if(!A.online){await api('/api/app/driver/online',{method:'POST',body:{online:true,...location},timeout:9000});A.online=true}
   const result=await api(`/api/app/v28/driver/calls/${encodeURIComponent(item.id)}/accept`,{method:'POST',body:location,timeout:10000});A.lastOfferId='';A.detail={...item,status:String(result.status||'to_pickup'),accepted_at:new Date().toISOString(),requires_acceptance:false};
  }else if(action==='picked_up'){
   let status=String(item.status||'');
   if(status==='accepted'){await postStatus(item.id,'to_pickup');status='to_pickup'}
   if(status==='to_pickup'){await postStatus(item.id,'at_pickup');status='at_pickup'}
   if(status==='at_pickup'){await postStatus(item.id,'picked_up');status='picked_up'}
   if(status!=='picked_up')throw new Error('A coleta não pôde ser confirmada no estado atual.');
   A.detail={...item,status:'picked_up',picked_up_at:new Date().toISOString()};
  }else if(action==='in_route'){
   await postStatus(item.id,'in_route');A.detail={...item,status:'in_route'};
  }else if(action==='complete'){
   const code=prompt('Informe o código de 4 dígitos fornecido pelo cliente:');if(code===null)return;if(!/^\d{4}$/.test(code))throw new Error('Informe um código de 4 dígitos.');
   await api(`/api/app/v16/driver/deliveries/${encodeURIComponent(item.id)}/complete`,{method:'POST',body:{confirmation_code:code},timeout:10000});A.detail=null;clearRoute();closeSheet();
  }
  updateStops();renderControls();renderSheet(true);if(A.detail&&!offerRequired(A.detail))updateRoute(true);setTimeout(()=>poll(true),350);
 }catch(error){notice(error.message||'Não foi possível concluir a operação.',true)}finally{A.decision=false;applyMetric()}
}
async function decline(){
 const reason=prompt('Informe o motivo da recusa:');if(reason===null)return;if(String(reason).trim().length<3)return notice('Informe o motivo da recusa.',true);
 try{await api(`/api/app/v28/driver/calls/${encodeURIComponent(A.detail.id)}/decline`,{method:'POST',body:{reason:String(reason).trim()},timeout:9000});A.detail=null;A.lastOfferId='';clearRoute();closeSheet();await poll(true)}catch(error){notice(error.message,true)}
}
async function cancelDelivery(){
 const reason=prompt('Informe o motivo do cancelamento:');if(reason===null)return;if(String(reason).trim().length<3)return notice('Informe o motivo do cancelamento.',true);if(!confirm('Confirma o cancelamento desta entrega?'))return;
 try{await api(`/api/app/driver/deliveries/${encodeURIComponent(A.detail.id)}/cancel`,{method:'POST',body:{reason:String(reason).trim()},timeout:9000});A.detail=null;clearRoute();closeSheet();await poll(true)}catch(error){notice(error.message,true)}
}
function openExternalMaps(){
 const target=targetPoint();if(!valid(target))return;const origin=valid(A.gps)?`${A.gps.lat},${A.gps.lng}`:'';
 const route=origin?`${origin};${target.lat},${target.lng}`:`${target.lat},${target.lng}`;
 location.href=`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(route)}`;
}

async function getQueue(){try{return await api('/api/app/v10/queue/locations',{timeout:6000})}catch{return{active:null,items:[]}}}
async function getSchedules(){const now=new Date(),from=now.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),end=new Date(`${from}T12:00:00`);end.setDate(end.getDate()+7);try{return(await api(`/api/app/v18/driver/schedule?from=${from}&to=${end.toISOString().slice(0,10)}`,{timeout:6500})).items||[]}catch{return[]}}
async function poll(force=false){
 if(!isDriver()||!token()||document.hidden||A.decision)return;
 try{
  const [live,queue,schedules]=await Promise.all([api('/api/app/driver/live',{timeout:7000}),getQueue(),A.detail?Promise.resolve(A.schedules):getSchedules()]);
  A.online=Boolean(Number(live.driver?.online));A.summary=live.summary||{};A.queue=queue.active||null;A.schedules=schedules;
  const basic=live.call||live.active||null;
  if(!basic){A.detail=null;A.lastOfferId='';clearRoute();updateStops();renderControls();renderSchedules();return}
  let item=basic;try{item=(await api(`/api/app/v28/driver/calls/${encodeURIComponent(basic.id)}`,{timeout:5500})).item||basic}catch{}
  const changed=String(item.id)!==String(A.detail?.id)||String(item.status)!==String(A.detail?.status);A.detail=item;updateStops();renderControls();renderSheet(changed||force);
  if(offerRequired(item))notifyOffer(item);else{A.lastOfferId='';updateRoute(changed||force)}
 }catch(error){if(force)notice(error.message,true)}
}
async function toggleOnline(){
 if(A.detail)return;const b=$('#cj199-start');if(b?.disabled)return;b.disabled=true;
 try{if(A.online){await api('/api/app/driver/online',{method:'POST',body:{online:false}});A.online=false}else{const location=await getPosition();await api('/api/app/driver/online',{method:'POST',body:{online:true,...location}});A.online=true}renderControls()}catch(error){notice(error.message,true)}finally{if(b)b.disabled=false}
}
async function toggleQueue(){
 if(A.detail)return;const b=$('#cj199-queue');if(b?.disabled)return;b.disabled=true;
 try{if(A.queue){await api('/api/app/v10/queue/leave',{method:'POST',body:{}});A.queue=null}else{if(!A.online)throw new Error('Fique online antes de entrar na fila.');const q=await getQueue(),item=q.items?.[0];if(!item)throw new Error('Nenhuma fila disponível para sua escala agora.');const location=await getPosition();await api('/api/app/v25/driver/queue/arrive',{method:'POST',body:{location_type:item.location_type,location_id:item.location_id,latitude:location.latitude,longitude:location.longitude}})}await poll(true)}catch(error){notice(error.message,true)}finally{if(b)b.disabled=false}
}
async function checkin(){
 if(A.detail)return notice('Finalize a entrega atual antes do check-in.',true);
 try{const locations=await api('/api/app/v25/driver/checkin/locations');if(locations.active)return notice(`Check-in já ativo em ${locations.active.location_name||'seu local'}.`);const item=locations.items?.[0];if(!item)throw new Error('Nenhuma escala ativa para check-in agora.');const location=await getPosition();await api('/api/app/v25/driver/checkin',{method:'POST',body:{schedule_id:item.schedule_id,location_type:item.location_type,location_id:item.location_id,latitude:location.latitude,longitude:location.longitude,accuracy:location.accuracy}});notice('Check-in confirmado.')}catch(error){notice(error.message,true)}
}
function startGps(){
 if(A.gpsWatch!=null||!navigator.geolocation)return;
 A.gpsWatch=navigator.geolocation.watchPosition(p=>{
  A.gps={lat:p.coords.latitude,lng:p.coords.longitude};window.ChegaJaLastDriverLocation={lat:A.gps.lat,lng:A.gps.lng,accuracy:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed};ensureSelfMarker();snapSelfToRoute();
  if(A.map&&!A.firstGpsCentered){A.firstGpsCentered=true;centralize()}else followGps();
  if(A.online&&Date.now()-A.lastSent>6000){A.lastSent=Date.now();api('/api/app/map/location',{method:'POST',body:{latitude:A.gps.lat,longitude:A.gps.lng,accuracy:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed},timeout:5000}).catch(()=>{})}
 },()=>{},{enableHighAccuracy:true,maximumAge:1500,timeout:15000});
}

function bind(){
 $('#cj199-start').onclick=toggleOnline;$('#cj199-queue').onclick=toggleQueue;$('#cj199-checkin').onclick=checkin;$('#cj199-center').onclick=centralize;$('#cj199-up').onclick=openSheet;$('#cj199-down').onclick=$('#cj199-sheet .handle').onclick=closeSheet;
 $('#cj199-menu').onclick=()=>$('#cj199-drawer').classList.add('open');$('#cj199-drawer [data-close]').onclick=$('#cj199-drawer .backdrop').onclick=()=>$('#cj199-drawer').classList.remove('open');
 $$('#cj199-drawer [data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));$('#cj199-drawer [data-checkin]').onclick=()=>{ $('#cj199-drawer').classList.remove('open');checkin()};$('#cj199-drawer [data-logout]').onclick=()=>window.logout?.();
 $('#cj199-metric').onclick=()=>{const action=actionFor(A.detail);if(action)performAction(action.action)};
 const bottom=$('#cj199-bottom');bottom.addEventListener('touchstart',e=>A.touchY=e.touches[0]?.clientY??null,{passive:true});bottom.addEventListener('touchend',e=>{const y=e.changedTouches[0]?.clientY??A.touchY;if(A.touchY!=null&&y-A.touchY<-35)openSheet();A.touchY=null},{passive:true});
 for(const name of['pointerdown','touchstart','click'])document.addEventListener(name,unlockAudio,{capture:true,passive:true});
}
async function mount(){
 if(!isHome())return;removeLegacy();document.body.classList.remove('cj199-driver-page');document.body.classList.add('cj199-driver');$('#auth-screen')?.classList.add('hidden');$('#customer-screen')?.classList.add('hidden');$('#tracking-screen')?.classList.add('hidden');$('#app-shell')?.classList.remove('hidden');
 const content=$('#page-content');if(!content)return;if(!$('#cj199-app',content)){content.innerHTML=shell();bind()}A.mounted=true;
 try{await ensureMap()}catch(error){notice(error.message,true)}startGps();await poll(true);startTimers();
}
function leaveHome(){document.body.classList.remove('cj199-driver');document.body.classList.add('cj199-driver-page');closeSheet();$('#cj199-drawer')?.classList.remove('open')}
async function go(page){$('#cj199-drawer')?.classList.remove('open');if(page==='dashboard'){window.state.page='dashboard';return mount()}leaveHome();return A.oldNavigate?.call(window,page)}
function install(){
 if(A.installed||!window.pages||typeof window.navigate!=='function')return false;A.installed=true;A.oldDashboard=window.pages.dashboard;A.oldNavigate=window.navigate;
 window.pages.dashboard=async function(){if(isDriver())return mount();return A.oldDashboard?.apply(this,arguments)};
 window.navigate=async function(page,...rest){if(isDriver()&&page==='dashboard'){window.state.page='dashboard';return mount()}if(isDriver())leaveHome();return A.oldNavigate.call(this,page,...rest)};
 if(isHome())mount();return true;
}
function startTimers(){
 clearInterval(A.pollTimer);clearInterval(A.routeTimer);clearInterval(A.healthTimer);
 A.pollTimer=setInterval(()=>poll(false),6000);A.routeTimer=setInterval(()=>updateRoute(false),15000);A.healthTimer=setInterval(()=>{if(isHome()){removeLegacy();if(!$('#cj199-app'))mount();else{renderControls();if(A.routePoints.length&&A.map)drawRoute(A.routePoints)}}},5000);
}
window.addEventListener('orientationchange',preserveResize);window.addEventListener('resize',preserveResize);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isHome()){preserveResize();poll(true);updateRoute(true)}});
window.addEventListener('load',()=>{install();setTimeout(()=>{if(!A.installed)install()},900)},{once:true});if(document.readyState==='complete'){install();setTimeout(()=>{if(!A.installed)install()},900)}
})();