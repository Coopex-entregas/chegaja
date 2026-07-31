/* ChegaJá 14.31.5 — fluxo único do cooperado, rota azul persistente e mapa manual */
(()=>{
'use strict';
if(window.__CJ217_DRIVER_FLOW_14315__)return;
window.__CJ217_DRIVER_FLOW_14315__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0)/100);
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
const isHome=()=>isDriver()&&window.state?.page==='dashboard'&&!!$('#cj199-app');

const R={
 detail:null,online:false,lastId:'',lastStatus:'',decision:false,
 pollTimer:null,navTimer:null,tickTimer:null,emptyPolls:0,
 map:null,renderer:null,casing:null,line:null,routePoints:[],routeKey:'',
 navBusy:false,lastNavAt:0,lastInstruction:'',
 offerSoundId:'',audio:null,audioUnlocked:false,
 sheetHtml:'',sheetTitle:'',sheetKey:''
};

async function api(path,opt={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),opt.timeout||7000);
 try{
  const response=await fetch(path,{
   method:opt.method||'GET',
   headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},
   body:opt.body?JSON.stringify(opt.body):undefined,
   cache:'no-store',signal:controller.signal
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
  return data;
 }catch(error){
  if(error?.name==='AbortError')throw new Error('A conexão demorou. Tente novamente.');
  throw error;
 }finally{clearTimeout(timer)}
}

const point=(lat,lng)=>({lat:Number(lat),lng:Number(lng)});
const validPoint=value=>Number.isFinite(Number(value?.lat))&&Number.isFinite(Number(value?.lng))&&Math.abs(Number(value.lat))<=90&&Math.abs(Number(value.lng))<=180;
function distance(a,b){
 if(!validPoint(a)||!validPoint(b))return Infinity;
 const rad=value=>value*Math.PI/180,earth=6371000;
 const dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng);
 const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
 return 2*earth*Math.asin(Math.min(1,Math.sqrt(h)));
}
function currentGps(){
 const raw=window.ChegaJaLastDriverLocation;
 const value=point(raw?.lat??raw?.latitude,raw?.lng??raw?.longitude);
 return validPoint(value)?value:null;
}
function getPosition(){
 const cached=currentGps();
 if(cached)return Promise.resolve({latitude:cached.lat,longitude:cached.lng,accuracy:Number(window.ChegaJaLastDriverLocation?.accuracy)||null});
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation){reject(new Error('GPS indisponível.'));return}
  navigator.geolocation.getCurrentPosition(position=>resolve({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}),()=>reject(new Error('Autorize a localização precisa para continuar.')),{enableHighAccuracy:true,maximumAge:3500,timeout:7000});
 });
}

function offerRequired(item){return Boolean(item)&&(['offered','assigned'].includes(String(item.status))||Boolean(item.requires_acceptance))&&!item.accepted_at}
function navigationEligible(item){return Boolean(item)&&['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(item.status))&&!offerRequired(item)}
function actionFor(item){
 const status=String(item?.status||'');
 if(offerRequired(item))return{label:'NOVA ENTREGA',text:'ACEITAR ENTREGA',hint:'Toque aqui para aceitar',action:'accept'};
 if(['accepted','to_pickup','at_pickup'].includes(status))return{label:'COLETA',text:'COLETA REALIZADA',hint:'Confirme somente após receber o item',action:'picked_up'};
 if(status==='picked_up')return{label:'PRÓXIMA ETAPA',text:'INICIAR ENTREGA',hint:'Começar o percurso até o cliente',action:'in_route'};
 if(['in_route','problem'].includes(status))return{label:'ENTREGA',text:'FINALIZAR ENTREGA',hint:'Será solicitado o código do cliente',action:'complete'};
 return null;
}

function showMessage(text,error=false){
 let node=$('#cj217-msg');
 if(!node){node=document.createElement('p');node.id='cj217-msg';$('#cj199-schedules')?.prepend(node)}
 node.textContent=String(text||'');node.classList.toggle('error',error);
}
function applyTopCard(){
 const card=$('#cj199-metric'),label=$('#cj199-metric-label'),value=$('#cj199-metric-value'),hint=$('#cj199-metric-hint');
 if(!card||!label||!value||!hint)return;
 const action=actionFor(R.detail);
 if(!action){card.classList.remove('cj217-action-card','busy');card.disabled=false;return}
 card.classList.add('cj217-action-card');card.classList.toggle('busy',R.decision);card.disabled=R.decision;
 label.textContent=R.decision?'PROCESSANDO':action.label;
 value.textContent=R.decision?'AGUARDE…':action.text;
 hint.textContent=R.decision?'Não feche esta tela':action.hint;
}

function rememberSheet(){
 const host=$('#cj199-schedules'),title=$('#cj199-sheet header strong');
 if(!host||R.sheetHtml)return;
 R.sheetHtml=host.innerHTML;R.sheetTitle=title?.textContent||'Datas, horários e locais';
}
function restoreSheet(){
 if(R.detail)return;
 const host=$('#cj199-schedules'),title=$('#cj199-sheet header strong'),kicker=$('#cj199-sheet header small');
 if(host&&R.sheetHtml){host.innerHTML=R.sheetHtml;R.sheetHtml='';R.sheetKey=''}
 if(title)title.textContent=R.sheetTitle||'Datas, horários e locais';
 if(kicker)kicker.textContent='MINHA ESCALA';
}
function openSheet(){
 const sheet=$('#cj199-sheet');if(!sheet)return;
 sheet.hidden=false;sheet.classList.add('open');
 const up=$('#cj199-up');if(up)up.textContent='⌄';
 setTimeout(()=>{try{window.ChegaJaDriverMap?.map?.invalidateSize?.(false)}catch{}},180);
}
function closeSheet(){$('#cj199-sheet')?.classList.remove('open');const up=$('#cj199-up');if(up)up.textContent='⌃'}
function statusLabel(status){return({offered:'Nova entrega',assigned:'Aguardando aceite',accepted:'Indo para coleta',to_pickup:'Indo para coleta',at_pickup:'No local da coleta',picked_up:'Item coletado',in_route:'Em rota para entrega',problem:'Atenção necessária'})[String(status||'')]||String(status||'Entrega atual')}
function renderSheet(force=false){
 const item=R.detail,host=$('#cj199-schedules');
 if(!item||!host){restoreSheet();return}
 rememberSheet();
 const key=[item.id,item.status,item.accepted_at||'',item.updated_at||''].join('|');
 if(!force&&key===R.sheetKey&&host.querySelector('.cj217-sheet'))return;
 R.sheetKey=key;
 const offer=offerRequired(item);
 host.innerHTML=`<section class="cj217-sheet">
  <div class="cj217-delivery-head"><div><small>${offer?'NOVA ENTREGA':'ENTREGA ATUAL'}</small><strong>${esc(item.display_code||'Entrega')}</strong></div><span>${esc(statusLabel(item.status))}</span></div>
  <article class="cj217-address"><b>C</b><div><small>COLETA</small><strong>${esc(item.pickup_address||'Endereço não informado')}</strong>${item.pickup_complement?`<span>${esc(item.pickup_complement)}</span>`:''}</div></article>
  <article class="cj217-address"><b>E</b><div><small>ENTREGA</small><strong>${esc(item.delivery_address||'Endereço não informado')}</strong>${item.delivery_complement?`<span>${esc(item.delivery_complement)}</span>`:''}</div></article>
  <div class="cj217-values">
   <span><small>VOCÊ RECEBE</small><b>${money(item.driver_net_cents??item.driver_earnings_cents??item.charge_cents??0)}</b></span>
   <span><small>PAGAMENTO</small><b>${esc(String(item.payment_method||'—').toUpperCase())}</b></span>
   <span><small>DISTÂNCIA</small><b>${Number(item.distance_meters||0)>=1000?`${(Number(item.distance_meters)/1000).toFixed(1).replace('.',',')} km`:`${Math.round(Number(item.distance_meters||0))} m`}</b></span>
   <span><small>TEMPO</small><b>${Math.max(1,Math.round(Number(item.duration_seconds||0)/60))} min</b></span>
  </div>
  ${item.notes?`<p class="cj217-notes"><b>Observações:</b> ${esc(item.notes)}</p>`:''}
  <div class="cj217-secondary-actions"><button id="cj217-secondary" type="button" class="danger">${offer?'RECUSAR':'CANCELAR ENTREGA'}</button>${!offer?'<button id="cj217-open-maps" type="button">ABRIR NO MAPS</button>':''}</div>
  <p id="cj217-msg"></p>
 </section>`;
 const title=$('#cj199-sheet header strong'),kicker=$('#cj199-sheet header small');
 if(title)title.textContent=item.display_code||'Entrega atual';if(kicker)kicker.textContent=offer?'NOVA ENTREGA':'ENTREGA ATUAL';
 $('#cj217-secondary')?.addEventListener('click',()=>offer?decline():cancelDelivery());
 $('#cj217-open-maps')?.addEventListener('click',openGoogleMaps);
}

function setActive(item){
 R.detail=item||null;
 window.ChegaJaDriverCurrentDelivery=R.detail;
 window.ChegaJaDriverPendingOffer=offerRequired(R.detail)?R.detail:null;
 window.ChegaJaDriverActiveDelivery=navigationEligible(R.detail)?R.detail:null;
 document.body.classList.toggle('cj217-active-delivery',Boolean(R.detail));
 document.body.classList.toggle('cj217-pending-offer',offerRequired(R.detail));
 try{window.ChegaJaDriverMap?.setActive?.(window.ChegaJaDriverActiveDelivery);window.ChegaJaDriverMap?.follow?.(false)}catch{}
 applyTopCard();renderSheet();
}

function clearRoute(){
 for(const layer of[R.line,R.casing])if(layer)try{layer.remove()}catch{}
 R.line=R.casing=null;R.routePoints=[];R.routeKey='';
 try{window.ChegaJaDriverMap?.setRoutePoints?.([])}catch{}
}
function ensureMap(){
 const map=window.ChegaJaDriverMap?.map;
 if(!map||typeof L==='undefined')return false;
 if(R.map!==map){clearRoute();R.map=map;R.renderer=null}
 if(!map.getPane('cj217RoutePane')){const pane=map.createPane('cj217RoutePane');pane.style.zIndex='590';pane.style.pointerEvents='none'}
 if(!R.renderer){try{R.renderer=L.svg({pane:'cj217RoutePane',padding:.7}).addTo(map)}catch{R.renderer=null}}
 return true;
}
function routeKey(points){if(points.length<2)return'';const first=points[0],last=points.at(-1);return`${points.length}:${first.lat.toFixed(5)}:${first.lng.toFixed(5)}:${last.lat.toFixed(5)}:${last.lng.toFixed(5)}`}
function drawRoute(points,force=false){
 if(!ensureMap()||points.length<2)return;
 const key=routeKey(points),visible=R.line&&R.casing&&R.map.hasLayer?.(R.line)&&R.map.hasLayer?.(R.casing);
 if(!force&&key===R.routeKey&&visible)return;
 for(const layer of[R.line,R.casing])if(layer)try{layer.remove()}catch{}
 R.routePoints=points;R.routeKey=key;
 const latlngs=points.map(item=>[item.lat,item.lng]);
 const base={pane:'cj217RoutePane',renderer:R.renderer||undefined,interactive:false,lineCap:'round',lineJoin:'round',smoothFactor:.35};
 R.casing=L.polyline(latlngs,{...base,color:'#fff',weight:13,opacity:1}).addTo(R.map);
 R.line=L.polyline(latlngs,{...base,color:'#1459ff',weight:8,opacity:1}).addTo(R.map);
 R.casing.bringToFront?.();R.line.bringToFront?.();
 try{window.ChegaJaDriverMap?.setRoutePoints?.(points)}catch{}
}
function normalizeGeometry(geometry){return Array.isArray(geometry)?geometry.map(item=>point(item?.[0],item?.[1])).filter(validPoint):[]}
function targetPoint(){
 const item=R.detail;if(!item)return null;
 const delivery=['picked_up','in_route','problem'].includes(String(item.status));
 const value=point(delivery?item.delivery_lat:item.pickup_lat,delivery?item.delivery_lng:item.pickup_lng);
 return validPoint(value)?value:null;
}
async function fallbackRoute(){
 const from=currentGps(),to=targetPoint();if(!validPoint(from)||!validPoint(to))return[];
 try{
  const response=await fetch(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`,{cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  return(data.routes?.[0]?.geometry?.coordinates||[]).map(item=>point(item[1],item[0])).filter(validPoint);
 }catch{return[]}
}
function speak(instruction){
 const text=String(instruction||'').trim();
 if(!text||text===R.lastInstruction||!R.audioUnlocked||!('speechSynthesis'in window))return;
 R.lastInstruction=text;
 try{speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='pt-BR';utterance.rate=1;speechSynthesis.speak(utterance)}catch{}
}
async function fetchNavigation(force=false){
 if(!navigationEligible(R.detail)||R.navBusy||document.hidden)return;
 if(!force&&Date.now()-R.lastNavAt<7000)return;
 R.lastNavAt=Date.now();R.navBusy=true;
 try{
  const data=await api('/api/app/v32/driver/navigation',{timeout:8000});
  if(data.route){
   let points=normalizeGeometry(data.route.geometry);if(points.length<2)points=await fallbackRoute();
   if(points.length>=2)drawRoute(points,true);
   if(!data.arrived)speak(data.route.steps?.[0]?.instruction);
  }else if(!data.arrived&&R.routePoints.length<2){const points=await fallbackRoute();if(points.length>=2)drawRoute(points,true)}
  if(R.routePoints.length)setTimeout(()=>drawRoute(R.routePoints,true),120);
 }catch{if(R.routePoints.length<2){const points=await fallbackRoute();if(points.length>=2)drawRoute(points,true)}}
 finally{R.navBusy=false}
}

function nearestRoutePoint(gps){
 if(!validPoint(gps)||R.routePoints.length<2)return gps;
 let best=null,bestDistance=Infinity;const step=Math.max(1,Math.floor(R.routePoints.length/300));
 for(let index=0;index<R.routePoints.length;index+=step){const item=R.routePoints[index],value=distance(gps,item);if(value<bestDistance){bestDistance=value;best=item}}
 return best&&bestDistance<=90?best:gps;
}
function snapDriverMarker(){
 if(!ensureMap()||!R.detail||R.routePoints.length<2)return;
 const snapped=nearestRoutePoint(currentGps());if(!validPoint(snapped))return;
 try{R.map.eachLayer(layer=>{const element=layer?.getElement?.();if(element?.classList?.contains('cj199-photo-marker'))layer.setLatLng?.([snapped.lat,snapped.lng])})}catch{}
}

function patchMap(){
 const mapApi=window.ChegaJaDriverMap;if(!mapApi||mapApi.__cj217StableManual)return;
 mapApi.__cj217StableManual=true;
 const originalSetActive=typeof mapApi.setActive==='function'?mapApi.setActive.bind(mapApi):null;
 const originalFollow=typeof mapApi.follow==='function'?mapApi.follow.bind(mapApi):null;
 const originalCenter=typeof mapApi.center==='function'?mapApi.center.bind(mapApi):null;
 mapApi.setActive=item=>{
  const map=mapApi.map;let center=null,zoom=null;
  try{center=map?.getCenter?.();zoom=map?.getZoom?.()}catch{}
  const result=originalSetActive?.(item);try{originalFollow?.(false)}catch{}
  if(map&&center&&Number.isFinite(Number(zoom)))try{map.setView(center,zoom,{animate:false,noMoveStart:true})}catch{}
  return result;
 };
 mapApi.follow=()=>{try{originalFollow?.(false)}catch{};return false};
 mapApi.setRoutePoints=points=>{R.routePoints=Array.isArray(points)?points:[]};
 mapApi.center=()=>{
  const gps=currentGps(),map=mapApi.map;
  if(!validPoint(gps)||!map){originalCenter?.();return}
  try{originalFollow?.(false);map.stop?.();map.invalidateSize(false);map.setView([gps.lat,gps.lng],18,{animate:false,noMoveStart:true})}catch{}
 };
}
function centralize(){patchMap();window.ChegaJaDriverMap?.center?.()}

function unlockAudio(){
 R.audioUnlocked=true;
 try{
  const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
  if(!R.audio)R.audio=new Context();R.audio.resume?.();
  if(!R.audio.__cjUnlocked){const oscillator=R.audio.createOscillator(),gain=R.audio.createGain();gain.gain.value=.000001;oscillator.connect(gain);gain.connect(R.audio.destination);oscillator.start();oscillator.stop(R.audio.currentTime+.025);R.audio.__cjUnlocked=true}
 }catch{}
}
function ring(){
 if(!R.audioUnlocked){navigator.vibrate?.([220,100,220]);return}
 unlockAudio();const context=R.audio;if(!context||context.state!=='running')return;
 const start=context.currentTime+.02;
 for(const tone of[{frequency:720,delay:0,duration:.2},{frequency:930,delay:.27,duration:.22},{frequency:1180,delay:.58,duration:.34}]){
  try{const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(tone.frequency,start+tone.delay);gain.gain.setValueAtTime(.0001,start+tone.delay);gain.gain.exponentialRampToValueAtTime(.32,start+tone.delay+.025);gain.gain.exponentialRampToValueAtTime(.0001,start+tone.delay+tone.duration);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start+tone.delay);oscillator.stop(start+tone.delay+tone.duration+.04)}catch{}
 }
 navigator.vibrate?.([250,100,250]);
}
function notifyOffer(item){const id=String(item?.id||'');if(!id||id===R.offerSoundId)return;R.offerSoundId=id;ring();setTimeout(ring,1500);openSheet()}

async function performAction(action){
 if(R.decision||!R.detail?.id)return;
 const item=R.detail;R.decision=true;applyTopCard();showMessage('');
 try{
  if(action==='accept'){
   const location=await getPosition();
   if(!R.online){await api('/api/app/driver/online',{method:'POST',body:{online:true,...location},timeout:8000});R.online=true}
   const result=await api(`/api/app/v28/driver/calls/${encodeURIComponent(item.id)}/accept`,{method:'POST',body:location,timeout:9000});
   R.offerSoundId='';setActive({...item,status:String(result.status||'to_pickup'),accepted_at:new Date().toISOString(),requires_acceptance:false});renderSheet(true);fetchNavigation(true);
  }else if(action==='picked_up'||action==='in_route'){
   await api(`/api/app/v6/driver/deliveries/${encodeURIComponent(item.id)}/status`,{method:'POST',body:{status:action},timeout:8000});
   setActive({...item,status:action});renderSheet(true);fetchNavigation(true);
  }else if(action==='complete'){
   const code=prompt('Informe o código de 4 dígitos fornecido pelo cliente:');if(code===null)return;if(!/^\d{4}$/.test(code))throw new Error('Informe um código de 4 dígitos.');
   await api(`/api/app/v16/driver/deliveries/${encodeURIComponent(item.id)}/complete`,{method:'POST',body:{confirmation_code:code},timeout:9000});
   R.detail=null;setActive(null);clearRoute();restoreSheet();closeSheet();
  }
 }catch(error){showMessage(error.message||'Não foi possível concluir.',true)}
 finally{R.decision=false;applyTopCard();setTimeout(()=>poll(true),250)}
}
async function decline(){
 if(R.decision||!R.detail?.id)return;
 const reason=prompt('Informe o motivo da recusa:');if(reason===null)return;if(String(reason).trim().length<3){showMessage('Informe o motivo da recusa.',true);return}
 R.decision=true;applyTopCard();
 try{await api(`/api/app/v28/driver/calls/${encodeURIComponent(R.detail.id)}/decline`,{method:'POST',body:{reason:String(reason).trim()},timeout:8000});R.offerSoundId='';R.detail=null;setActive(null);clearRoute();restoreSheet();closeSheet()}
 catch(error){showMessage(error.message,true)}finally{R.decision=false;applyTopCard();setTimeout(()=>poll(true),250)}
}
async function cancelDelivery(){
 if(R.decision||!R.detail?.id)return;
 const reason=prompt('Informe o motivo do cancelamento:');if(reason===null)return;if(String(reason).trim().length<3){showMessage('Informe o motivo do cancelamento.',true);return}if(!confirm('Confirma o cancelamento desta entrega?'))return;
 R.decision=true;applyTopCard();
 try{await api(`/api/app/driver/deliveries/${encodeURIComponent(R.detail.id)}/cancel`,{method:'POST',body:{reason:String(reason).trim()},timeout:8000});R.detail=null;setActive(null);clearRoute();restoreSheet();closeSheet()}
 catch(error){showMessage(error.message,true)}finally{R.decision=false;applyTopCard();setTimeout(()=>poll(true),250)}
}
function openGoogleMaps(){
 const item=R.detail;if(!item)return;
 const delivery=['picked_up','in_route','problem'].includes(String(item.status));
 const target=point(delivery?item.delivery_lat:item.pickup_lat,delivery?item.delivery_lng:item.pickup_lng);if(!validPoint(target))return;
 const params=new URLSearchParams({api:'1',travelmode:'driving',destination:`${target.lat},${target.lng}`});const from=currentGps();if(validPoint(from))params.set('origin',`${from.lat},${from.lng}`);location.href=`https://www.google.com/maps/dir/?${params}`;
}

async function poll(force=false){
 if(!isDriver()||!token()||document.hidden)return;
 try{
  const live=await api('/api/app/driver/live',{timeout:6000});R.online=Boolean(Number(live.driver?.online));
  const basic=live.call||live.active||null;
  if(!basic){R.emptyPolls++;if(R.emptyPolls<2&&R.detail)return;R.detail=null;R.lastId='';R.lastStatus='';setActive(null);clearRoute();restoreSheet();return}
  R.emptyPolls=0;let item=basic;
  try{item=(await api(`/api/app/v28/driver/calls/${encodeURIComponent(basic.id)}`,{timeout:5000})).item||basic}catch{}
  const changed=String(item.id)!==R.lastId||String(item.status)!==R.lastStatus;
  R.lastId=String(item.id);R.lastStatus=String(item.status);setActive(item);renderSheet(changed||force);
  if(offerRequired(item))notifyOffer(item);else{R.offerSoundId='';if(navigationEligible(item))fetchNavigation(changed||force)}
 }catch(error){if(force)showMessage(error.message,true)}
}

function resizeMapPreservingView(){
 const map=window.ChegaJaDriverMap?.map;if(!map)return;
 let center=null,zoom=null;try{center=map.getCenter();zoom=map.getZoom()}catch{}
 for(const delay of[80,260,520])setTimeout(()=>{try{map.invalidateSize(false);if(center&&Number.isFinite(Number(zoom)))map.setView(center,zoom,{animate:false,noMoveStart:true});if(R.routePoints.length)drawRoute(R.routePoints,true)}catch{}},delay);
}
function tick(){
 if(!isHome())return;
 patchMap();try{window.ChegaJaDriverMap?.follow?.(false)}catch{}
 applyTopCard();if(R.detail&&!$('#cj199-schedules .cj217-sheet'))renderSheet(true);
 if(R.routePoints.length){const visible=R.line&&R.casing&&R.map?.hasLayer?.(R.line)&&R.map?.hasLayer?.(R.casing);if(!visible)drawRoute(R.routePoints,true);snapDriverMarker()}
}

document.addEventListener('click',event=>{
 if(!isDriver())return;unlockAudio();
 const center=event.target?.closest?.('#cj199-center');if(center){event.preventDefault();event.stopImmediatePropagation();centralize();return}
 const card=event.target?.closest?.('#cj199-metric');if(card&&R.detail){event.preventDefault();event.stopImmediatePropagation();const action=actionFor(R.detail);if(action)performAction(action.action)}
},{capture:true});
document.addEventListener('touchend',event=>{if(R.detail&&event.target?.closest?.('#cj199-metric'))event.stopImmediatePropagation()},{capture:true,passive:true});
for(const name of['pointerdown','touchstart'])document.addEventListener(name,unlockAudio,{capture:true,passive:true});
window.addEventListener('cj:driver-open-delivery',()=>{renderSheet(true);openSheet()});
window.addEventListener('orientationchange',resizeMapPreservingView);window.addEventListener('resize',resizeMapPreservingView);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){resizeMapPreservingView();poll(true)}});

function boot(){
 clearInterval(R.pollTimer);clearInterval(R.navTimer);clearInterval(R.tickTimer);
 R.pollTimer=setInterval(()=>poll(false),3000);R.navTimer=setInterval(()=>{if(navigationEligible(R.detail))fetchNavigation(false)},8000);R.tickTimer=setInterval(tick,400);
 poll(true);tick();
}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();