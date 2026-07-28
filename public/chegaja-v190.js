/* ChegaJá 14.19.0 — aplicativo único do cooperado e mapas Google */
(()=>{
'use strict';

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0)/100);
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const ACTIVE=new Set(['new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem']);
const STATUS={new:'Solicitada',offered:'Buscando cooperado',assigned:'Aguardando aceite',accepted:'Aceita',to_pickup:'Indo para coleta',at_pickup:'Na coleta',picked_up:'Pedido coletado',in_route:'Em rota',problem:'Atenção necessária',delivered:'Entregue',cancelled:'Cancelada'};
const DEFAULT_PRIMARY='#0D257A';
const DEFAULT_ACCENT='#F97316';

const runtime={
  originalDashboard:null,originalNavigate:null,
  driverTimer:null,driverBusy:false,lastDriverSignature:'',ratingLoaded:false,rating:5,
  gpsWatch:null,lastGpsSent:0,lastPosition:null,
  audio:null,ringTimer:null,ringId:null,
  offerId:null,offerMap:null,
  mapStates:new WeakMap(),clientTimer:null,trackingTimer:null,trackingBusy:false,
  operationalTimer:null,operationalSignature:'',themeCache:new Map(),
  customerObserver:null,driverObserver:null
};

function appState(){return typeof state!=='undefined'?state:null}
function isDriver(){return appState()?.user?.role==='driver'}
function authToken(){return localStorage.getItem('lg_token')||''}
function customerToken(){return localStorage.getItem('ligerim_customer_token')||''}

async function request(url,options={}){
  const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  if(options.auth!==false&&authToken())headers.Authorization=`Bearer ${authToken()}`;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),options.timeout||7000);
  try{
    const response=await fetch(url,{method:options.method||'GET',headers,body:options.body?JSON.stringify(options.body):undefined,cache:'no-store',signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
    return data;
  }finally{clearTimeout(timer)}
}
async function clientRequest(path,options={}){
  const tokenValue=customerToken();
  return request(`/api/client${path}`,{...options,auth:false,headers:{...(options.headers||{}),...(tokenValue?{Authorization:`Bearer ${tokenValue}`}:{})}});
}

function normalizeColor(value){
  let color=String(value||'').trim();
  if(/^#[0-9a-f]{3}$/i.test(color))color='#'+[...color.slice(1)].map(char=>char+char).join('');
  if(!/^#[0-9a-f]{6}$/i.test(color))return DEFAULT_PRIMARY;
  const upper=color.toUpperCase();
  return ['#721536','#6B1238','#800020','#7A1538'].includes(upper)?DEFAULT_PRIMARY:upper;
}
function shade(hex,amount){
  const color=normalizeColor(hex).slice(1);
  const rgb=[0,2,4].map(index=>parseInt(color.slice(index,index+2),16));
  const target=amount<0?0:255,p=Math.abs(amount);
  return '#'+rgb.map(channel=>Math.round(channel+(target-channel)*p).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function cooperativeId(){
  const params=new URLSearchParams(location.search),current=appState();
  return String(params.get('coop')||params.get('cooperative_id')||localStorage.getItem('chegaja_customer_cooperative')||current?.user?.cooperative_id||current?.user?.cooperativeId||'').trim();
}
async function applyTheme(fallback){
  const id=cooperativeId();
  let primary=normalizeColor(fallback||DEFAULT_PRIMARY);
  if(id){
    if(runtime.themeCache.has(id))primary=runtime.themeCache.get(id);
    else try{const data=await request(`/api/public/branding/${encodeURIComponent(id)}`,{auth:false,timeout:5000});primary=normalizeColor(data.item?.primary_color||primary);runtime.themeCache.set(id,primary)}catch{}
  }
  const accent=primary===DEFAULT_PRIMARY?DEFAULT_ACCENT:primary;
  const root=document.documentElement;
  root.style.setProperty('--cj190-primary',primary);
  root.style.setProperty('--cj190-primary-dark',shade(primary,-.28));
  root.style.setProperty('--cj190-primary-soft',shade(primary,.88));
  root.style.setProperty('--cj190-accent',accent);
  root.style.setProperty('--cj190-accent-soft',accent===DEFAULT_ACCENT?'#FFF0E5':shade(accent,.88));
  root.style.setProperty('--customer-color',primary);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',primary);
  return primary;
}

function point(lat,lng){
  let a=Number(lat),b=Number(lng);
  const brazil=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&x>=-35&&x<=7&&y>=-75&&y<=-32;
  if(!brazil(a,b)&&brazil(b,a))[a,b]=[b,a];
  return{lat:a,lng:b};
}
function validPoint(p){return Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&p.lat>=-90&&p.lat<=90&&p.lng>=-180&&p.lng<=180}
function googleEmbedUrl({center,origin,destination,zoom=15}){
  if(validPoint(origin)&&validPoint(destination))return `https://www.google.com/maps?saddr=${origin.lat},${origin.lng}&daddr=${destination.lat},${destination.lng}&output=embed`;
  const target=validPoint(center)?center:{lat:-5.7945,lng:-35.211};
  return `https://www.google.com/maps?q=${target.lat},${target.lng}&z=${zoom}&output=embed`;
}
function mountEmbed(host,options={}){
  const url=googleEmbedUrl(options);
  host.innerHTML=`<iframe class="cj190-google-embed" title="Google Maps" src="${esc(url)}" loading="eager" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
  runtime.mapStates.set(host,{mode:'embed',signature:url});
}
async function mountInteractiveMap(host,options={}){
  if(!host)return;
  const signature=JSON.stringify({center:options.center,origin:options.origin,destination:options.destination,route:options.route,markers:(options.markers||[]).map(item=>[item.lat,item.lng,item.photo,item.label])});
  const previous=runtime.mapStates.get(host);
  if(previous?.signature===signature)return;
  if(previous?.adapter)try{previous.adapter.remove()}catch{}
  host.replaceChildren();
  try{
    if(!window.ChegaJaMaps?.createMap)throw new Error('Google Maps ainda não carregou.');
    const center=validPoint(options.center)?options.center:(validPoint(options.origin)?options.origin:{lat:-5.7945,lng:-35.211});
    const adapter=await window.ChegaJaMaps.createMap(host,{center:[center.lat,center.lng],zoom:options.zoom||14,fullscreenControl:false});
    adapter.clearGroup('cj190');adapter.clearGroup('cj190-route');
    const bounds=[];
    for(const marker of options.markers||[]){
      const p=point(marker.lat,marker.lng);if(!validPoint(p))continue;bounds.push([p.lat,p.lng]);
      adapter.addMarker([p.lat,p.lng],{group:'cj190',photo:marker.photo||'',label:marker.label||'',title:marker.title||'',color:marker.color||getComputedStyle(document.documentElement).getPropertyValue('--cj190-primary').trim()||DEFAULT_PRIMARY,popup:marker.popup||''});
    }
    if(options.route)adapter.addGeoJSON(options.route,{group:'cj190-route',color:getComputedStyle(document.documentElement).getPropertyValue('--cj190-primary').trim()||DEFAULT_PRIMARY,weight:7,opacity:.9});
    if(bounds.length>1)adapter.fitBounds(bounds,{padding:45,maxZoom:16});else if(bounds.length===1)adapter.setView(bounds[0],16);
    adapter.invalidateSize?.();
    runtime.mapStates.set(host,{mode:'google',adapter,signature});
    setTimeout(()=>{
      if(!host.isConnected)return;
      if(host.querySelector('.gm-err-container,.gm-err-message')||!host.querySelector('.gm-style'))mountEmbed(host,options);
    },4500);
  }catch{mountEmbed(host,options)}
}
window.gm_authFailure=()=>{
  for(const host of document.querySelectorAll('.cj190-map-host,#cj190-client-map,#cj190-track-map,#v31-base-map,#cj14-est-map')){
    const stateMap=runtime.mapStates.get(host);if(stateMap?.fallback)stateMap.fallback();
  }
};

async function unlockAudio(){
  try{
    if(!runtime.audio)runtime.audio=new(window.AudioContext||window.webkitAudioContext)();
    if(runtime.audio.state==='suspended')await runtime.audio.resume();
    const oscillator=runtime.audio.createOscillator(),gain=runtime.audio.createGain();gain.gain.value=.0001;oscillator.connect(gain).connect(runtime.audio.destination);oscillator.start();oscillator.stop(runtime.audio.currentTime+.02);
  }catch{}
}
function tone(frequency,start,duration){
  if(!runtime.audio||runtime.audio.state!=='running')return;
  const oscillator=runtime.audio.createOscillator(),gain=runtime.audio.createGain();oscillator.type='square';oscillator.frequency.value=frequency;
  gain.gain.setValueAtTime(.0001,runtime.audio.currentTime+start);gain.gain.exponentialRampToValueAtTime(.28,runtime.audio.currentTime+start+.015);gain.gain.exponentialRampToValueAtTime(.0001,runtime.audio.currentTime+start+duration);
  oscillator.connect(gain).connect(runtime.audio.destination);oscillator.start(runtime.audio.currentTime+start);oscillator.stop(runtime.audio.currentTime+start+duration+.03);
}
function playRing(){unlockAudio().then(()=>{tone(740,0,.2);tone(960,.25,.22);tone(1180,.55,.27)});navigator.vibrate?.([450,130,450,130,650])}
function startRing(id){if(runtime.ringId===id&&runtime.ringTimer)return;stopRing();runtime.ringId=id;playRing();runtime.ringTimer=setInterval(playRing,1150)}
function stopRing(){if(runtime.ringTimer)clearInterval(runtime.ringTimer);runtime.ringTimer=null;runtime.ringId=null;navigator.vibrate?.(0)}
document.addEventListener('pointerdown',unlockAudio,{capture:true});

function stopOldDriverUi(){
  try{window.ChegaJaV31?.stopDriver?.()}catch{}
  for(const selector of ['#cj143-driver-nav','#cj143-driver-menu','#cj173-nav','#cj180-driver-nav','#cj183-driver-top','#cj144-sos-floating','#v32-driver-drawer'])$(selector)?.remove();
}
function driverDrawerHtml(driver={}){
  return `<div class="cj190-drawer-backdrop"></div><aside><header><span>${driver.photo_url?`<img src="${esc(driver.photo_url)}" alt="Foto">`:'<b>CJ</b>'}</span><div><strong>${esc(driver.name||appState()?.user?.name||'Cooperado')}</strong><small>Cooperado</small></div><button data-close>×</button></header><nav><button data-go="dashboard">⌂ <span>Início</span></button><button data-go="deliveries">▣ <span>Entregas</span></button><button data-go="schedules">▦ <span>Minha escala</span></button><button data-go="financial">R$ <span>Ganhos e descontos</span></button><button data-go="ratings">★ <span>Avaliações</span></button><button data-go="profile">● <span>Perfil</span></button><button data-go="support">? <span>Suporte</span></button><button data-help class="warning">! <span>Ajuda / SOS</span></button><button data-logout class="danger">↪ <span>Sair</span></button></nav></aside>`;
}
function openDrawer(){const drawer=$('#cj190-drawer');if(drawer)drawer.classList.add('open')}
function closeDrawer(){const drawer=$('#cj190-drawer');if(drawer)drawer.classList.remove('open')}
function bindDrawer(){
  const drawer=$('#cj190-drawer');if(!drawer)return;
  drawer.querySelector('.cj190-drawer-backdrop').onclick=closeDrawer;drawer.querySelector('[data-close]').onclick=closeDrawer;
  drawer.querySelectorAll('[data-go]').forEach(button=>button.onclick=()=>{closeDrawer();typeof navigate==='function'&&navigate(button.dataset.go)});
  drawer.querySelector('[data-logout]').onclick=()=>typeof logout==='function'&&logout();drawer.querySelector('[data-help]').onclick=showHelp;
}
function showHelp(){
  closeDrawer();
  if(typeof openModal!=='function')return;
  openModal('Ajuda e emergência',`<div class="cj190-help"><button id="cj190-send-sos"><strong>SOS da cooperativa</strong><span>Alertar imediatamente a Base</span></button><a href="tel:190"><b>190</b><span>Polícia Militar</span></a><a href="tel:192"><b>192</b><span>SAMU</span></a><a href="tel:193"><b>193</b><span>Bombeiros</span></a></div>`);
  $('#cj190-send-sos').onclick=sendSos;
}
async function sendSos(){
  const button=$('#cj190-send-sos');if(button)button.disabled=true;
  try{const current=await getCurrentPosition();const active=window.ChegaJaV31?.driverData?.item;await request(active?`/api/app/v15/driver/deliveries/${active.id}/sos`:'/api/app/v15/driver/sos',{method:'POST',body:{occurrence:'Solicitação de ajuda enviada pelo cooperado.',latitude:current.coords.latitude,longitude:current.coords.longitude,accuracy:current.coords.accuracy}});typeof closeModal==='function'&&closeModal();typeof toast==='function'&&toast('Pedido de ajuda enviado para a Base.')}catch(error){typeof toast==='function'?toast(error.message,'error'):alert(error.message)}finally{if(button?.isConnected)button.disabled=false}
}
function driverShell(){
  return `<main id="cj190-driver-app"><section id="cj190-driver-map" class="cj190-map-host"></section><section id="cj190-metrics" aria-label="Resumo do dia"><article><small>GANHOS HOJE</small><strong id="cj190-gain">R$ 0,00</strong></article><article><small>ENTREGAS HOJE</small><strong id="cj190-deliveries">0</strong></article><article><small>MINHA NOTA</small><strong id="cj190-rating">★ 5,00</strong></article></section><button id="cj190-center" aria-label="Centralizar localização">◎</button><button id="cj190-start"><span>INICIAR</span></button><section id="cj190-status-bar"><button id="cj190-expand">⌃</button><strong id="cj190-status-text">Você está offline</strong><button id="cj190-menu" aria-label="Abrir menu">☰</button></section><section id="cj190-active-card"></section><div id="cj190-drawer" class="cj190-drawer"></div></main>`;
}
async function renderDriverDashboard(){
  stopOldDriverUi();$('#cj190-page-menu')?.remove();$('#cj190-drawer')?.remove();await applyTheme();
  document.body.classList.remove('cj190-driver-page');document.body.classList.add('cj190-driver-home');
  const content=$('#page-content');if(!content)return;content.innerHTML=driverShell();
  $('#cj190-menu').onclick=openDrawer;$('#cj190-start').onclick=toggleOnline;$('#cj190-center').onclick=()=>{if(runtime.lastPosition)renderDriverMap(runtime.lastLive,true)};
  $('#cj190-expand').onclick=()=>$('#cj190-active-card')?.classList.toggle('open');
  await pollDriver(true);startDriverLoop();
}
function startDriverLoop(){clearInterval(runtime.driverTimer);runtime.driverTimer=setInterval(()=>pollDriver(false),1000)}
function stopDriverLoop(){clearInterval(runtime.driverTimer);runtime.driverTimer=null;stopRing();stopGps()}
async function loadRating(){if(runtime.ratingLoaded)return;runtime.ratingLoaded=true;try{const data=await request('/api/app/v7/ratings',{timeout:6000});const score=(data.driver_scores||[])[0];runtime.rating=Number(score?.score||5)}catch{runtime.rating=5}}
function getCurrentPosition(){return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:15000}):reject(new Error('GPS indisponível.')))}
function startGps(){
  if(runtime.gpsWatch!=null||!navigator.geolocation)return;
  runtime.gpsWatch=navigator.geolocation.watchPosition(position=>{
    runtime.lastPosition=point(position.coords.latitude,position.coords.longitude);
    if(Date.now()-runtime.lastGpsSent<4000)return;runtime.lastGpsSent=Date.now();
    request('/api/app/map/location',{method:'POST',body:{latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,speed:position.coords.speed,heading:position.coords.heading},timeout:5000}).catch(()=>{});
    renderDriverMap(runtime.lastLive,false);
  },()=>{}, {enableHighAccuracy:true,maximumAge:0,timeout:15000});
}
function stopGps(){if(runtime.gpsWatch!=null)navigator.geolocation?.clearWatch(runtime.gpsWatch);runtime.gpsWatch=null}
async function toggleOnline(){
  const live=runtime.lastLive||{},online=Boolean(live.driver?.online);const button=$('#cj190-start');if(button?.disabled)return;if(button)button.disabled=true;await unlockAudio();
  try{
    let body={online:!online};
    if(!online){const current=await getCurrentPosition();runtime.lastPosition=point(current.coords.latitude,current.coords.longitude);body={online:true,latitude:current.coords.latitude,longitude:current.coords.longitude,accuracy:current.coords.accuracy}}
    await request('/api/app/driver/online',{method:'POST',body});
    if(!online)startGps();else stopGps();await pollDriver(true);
  }catch(error){typeof toast==='function'?toast(error.message,'error'):alert(error.message)}finally{if(button?.isConnected)button.disabled=false}
}
function updateStatus(live){
  runtime.lastLive=live;const driver=live.driver||{},online=Boolean(driver.online);const button=$('#cj190-start'),text=$('#cj190-status-text');
  if(button){button.classList.toggle('online',online);button.querySelector('span').textContent=online?'PARAR':'INICIAR'}
  if(text)text.textContent=online?'Você está online':'Você está offline';
  $('#cj190-gain').textContent=money(live.summary?.earnings_today_cents||0);$('#cj190-deliveries').textContent=String(live.summary?.deliveries_today||0);$('#cj190-rating').textContent=`★ ${runtime.rating.toFixed(2).replace('.',',')}`;
  const drawer=$('#cj190-drawer');if(drawer&&!drawer.innerHTML){drawer.innerHTML=driverDrawerHtml(driver);bindDrawer()}
  if(online)startGps();
}
function activeTarget(active){
  if(!active)return null;
  const toDelivery=['picked_up','in_route','at_delivery'].includes(active.status);
  return point(toDelivery?active.delivery_lat:active.pickup_lat,toDelivery?active.delivery_lng:active.pickup_lng);
}
async function renderDriverMap(live,force=false){
  const host=$('#cj190-driver-map');if(!host||!live)return;
  const driverPoint=runtime.lastPosition||point(live.driver?.current_lat,live.driver?.current_lng),active=live.active||null,target=activeTarget(active);
  const signature=JSON.stringify([driverPoint,target,active?.id,active?.status]);if(!force&&signature===runtime.lastDriverSignature)return;runtime.lastDriverSignature=signature;
  const markers=[];if(validPoint(driverPoint))markers.push({lat:driverPoint.lat,lng:driverPoint.lng,label:'EU',title:'Sua localização'});if(active){const pickup=point(active.pickup_lat,active.pickup_lng),delivery=point(active.delivery_lat,active.delivery_lng);if(validPoint(pickup))markers.push({lat:pickup.lat,lng:pickup.lng,label:'C',title:'Coleta'});if(validPoint(delivery))markers.push({lat:delivery.lat,lng:delivery.lng,label:'E',title:'Entrega'})}
  await mountInteractiveMap(host,{center:validPoint(driverPoint)?driverPoint:target,origin:active&&validPoint(driverPoint)?driverPoint:null,destination:active&&validPoint(target)?target:null,markers,route:active?.route_geometry,zoom:16});
}
function activeCard(live){
  const host=$('#cj190-active-card'),active=live.active;if(!host)return;
  if(!active){host.innerHTML='';host.classList.remove('visible','open');return}
  const target=['picked_up','in_route','at_delivery'].includes(active.status)?active.delivery_address:active.pickup_address;
  host.classList.add('visible');host.innerHTML=`<div><small>${esc(STATUS[active.status]||active.status)}</small><strong>${esc(active.display_code||'Entrega')}</strong><span>${esc(target||'')}</span></div><button id="cj190-nav-action">NAVEGAR</button>`;
  $('#cj190-nav-action').onclick=()=>renderDriverMap(live,true);
}
async function pollDriver(force=false){
  if(!isDriver()||appState()?.page!=='dashboard'||document.hidden||runtime.driverBusy)return;runtime.driverBusy=true;
  try{await loadRating();const live=await request('/api/app/driver/live',{timeout:5000});updateStatus(live);activeCard(live);await renderDriverMap(live,force);if(live.call)showOffer(live.call);else hideOffer()}catch{}finally{runtime.driverBusy=false}
}
function offerHtml(item){return `<section id="cj190-offer"><div id="cj190-offer-map" class="cj190-map-host"></div><button id="cj190-offer-close">×</button><article><header><span>ChegaJá</span><strong>${money(item.driver_net_cents||item.driver_earnings_cents)}</strong><small>Valor para o cooperado</small></header><div class="cj190-offer-stats"><span>★ ${runtime.rating.toFixed(2).replace('.',',')}</span><span>${Math.max(1,Math.round(Number(item.duration_seconds||0)/60))} min</span><span>${(Number(item.distance_meters||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} km</span></div><div class="cj190-offer-route"><div><i>C</i><span><small>COLETA</small><strong>${esc(item.pickup_address||'')}</strong></span></div><em></em><div><i>E</i><span><small>ENTREGA</small><strong>${esc(item.delivery_address||'')}</strong></span></div></div><footer><button id="cj190-decline">RECUSAR</button><button id="cj190-accept">ACEITAR</button></footer><p id="cj190-offer-message"></p></article></section>`}
async function showOffer(item){
  if(runtime.offerId===item.id&&$('#cj190-offer'))return;hideOffer();runtime.offerId=item.id;document.body.insertAdjacentHTML('beforeend',offerHtml(item));startRing(item.id);
  const pickup=point(item.pickup_lat,item.pickup_lng),delivery=point(item.delivery_lat,item.delivery_lng),host=$('#cj190-offer-map');
  await mountInteractiveMap(host,{center:pickup,origin:pickup,destination:delivery,markers:[{lat:pickup.lat,lng:pickup.lng,label:'C'},{lat:delivery.lat,lng:delivery.lng,label:'E'}],route:item.route_geometry,zoom:14});
  $('#cj190-offer-close').onclick=()=>{};
  $('#cj190-decline').onclick=async()=>{const message=$('#cj190-offer-message');try{message.textContent='Recusando…';await request(`/api/app/driver/live/${item.id}/decline`,{method:'POST',body:{}});hideOffer();await pollDriver(true)}catch(error){message.textContent=error.message}};
  $('#cj190-accept').onclick=async()=>{const button=$('#cj190-accept'),message=$('#cj190-offer-message');button.disabled=true;message.textContent='Aceitando…';try{await request(`/api/app/driver/live/${item.id}/accept`,{method:'POST',body:{}});hideOffer();await pollDriver(true)}catch(error){message.textContent=error.message;button.disabled=false}};
}
function hideOffer(){stopRing();runtime.offerId=null;const offer=$('#cj190-offer');if(offer)offer.remove()}

function installDriverPages(){
  if(typeof pages==='undefined')return;
  if(!runtime.originalDashboard)runtime.originalDashboard=pages.dashboard;
  pages.dashboard=async function(){if(isDriver())return renderDriverDashboard();return runtime.originalDashboard?.apply(this,arguments)};
  if(!runtime.originalNavigate&&typeof navigate==='function'){
    runtime.originalNavigate=navigate;
    navigate=async function(page,...rest){
      if(isDriver()&&page!=='dashboard'){stopDriverLoop();hideOffer();document.body.classList.remove('cj190-driver-home');document.body.classList.add('cj190-driver-page');}
      const result=await runtime.originalNavigate.call(this,page,...rest);
      if(isDriver()&&page!=='dashboard')ensurePageMenu();
      return result;
    };
  }
}
function ensurePageMenu(){
  if(!isDriver()||appState()?.page==='dashboard')return;
  let button=$('#cj190-page-menu');if(!button){button=document.createElement('button');button.id='cj190-page-menu';button.textContent='☰';button.onclick=openDrawer;document.body.appendChild(button)}
  let drawerElement=$('#cj190-drawer');if(!drawerElement){drawerElement=document.createElement('div');drawerElement.id='cj190-drawer';drawerElement.className='cj190-drawer';drawerElement.innerHTML=driverDrawerHtml({});document.body.appendChild(drawerElement);bindDrawer()}
}

async function refreshCustomerMap(){
  const app=$('.v32-client-app');if(!app||!customerToken())return;
  await applyTheme();let stage=$('.v32-map-stage');if(!stage)return;
  let host=$('#cj190-client-map');if(!host){host=document.createElement('div');host.id='cj190-client-map';stage.prepend(host)}
  try{
    const orders=await clientRequest('/orders'),active=(orders.items||[]).find(item=>ACTIVE.has(String(item.delivery_status||item.status)));
    if(active?.tracking_token){const item=(await request(`/api/public/tracking/${encodeURIComponent(active.tracking_token)}`,{auth:false})).item;const driver=point(item.driver_lat,item.driver_lng),pickup=point(item.pickup_lat,item.pickup_lng),delivery=point(item.delivery_lat,item.delivery_lng);let origin=validPoint(driver)?driver:pickup;let destination=['picked_up','in_route'].includes(item.status)?delivery:pickup;const markers=[{lat:pickup.lat,lng:pickup.lng,label:'C'},{lat:delivery.lat,lng:delivery.lng,label:'E'}];if(validPoint(driver))markers.push({lat:driver.lat,lng:driver.lng,photo:item.driver_photo_url,label:'CJ',title:item.driver_name});await mountInteractiveMap(host,{center:origin,origin,destination,markers,route:item.route_geometry,zoom:14});return}
    await mountInteractiveMap(host,{center:{lat:-5.7945,lng:-35.211},markers:[],zoom:12});
  }catch{mountEmbed(host,{center:{lat:-5.7945,lng:-35.211},zoom:12})}
}
function formObjectLocal(form){const body={};new FormData(form).forEach((value,key)=>{if(key.endsWith('[]'))(body[key.slice(0,-2)]??=[]).push(value);else body[key]=value});return body}
async function drawCustomerQuote(){const form=$('#v32-order-form'),host=$('#cj190-client-map');if(!form||!host)return;const pickup=point(form.elements.pickup_lat?.value,form.elements.pickup_lng?.value),delivery=point(form.elements.delivery_lat?.value,form.elements.delivery_lng?.value);if(!validPoint(pickup)||!validPoint(delivery))return;try{const quote=await clientRequest('/quote',{method:'POST',body:formObjectLocal(form)});await mountInteractiveMap(host,{center:pickup,origin:pickup,destination:delivery,markers:[{lat:pickup.lat,lng:pickup.lng,label:'C'},{lat:delivery.lat,lng:delivery.lng,label:'E'}],route:quote.quote?.route_geometry||quote.quote?.geometry,zoom:14})}catch{await mountInteractiveMap(host,{center:pickup,origin:pickup,destination:delivery,markers:[{lat:pickup.lat,lng:pickup.lng,label:'C'},{lat:delivery.lat,lng:delivery.lng,label:'E'}],zoom:14})}}
function bindCustomerFormMap(){const form=$('#v32-order-form');if(!form||form.dataset.cj190Map==='1')return;form.dataset.cj190Map='1';let timer;const schedule=()=>{clearTimeout(timer);timer=setTimeout(drawCustomerQuote,350)};form.addEventListener('change',schedule);form.addEventListener('click',event=>{if(event.target.closest('[data-confirm-address],#v32-calc-quote'))schedule()})}
function installCustomerMap(){if(runtime.clientTimer)return;runtime.clientTimer=setInterval(()=>{if(!document.hidden){refreshCustomerMap();bindCustomerFormMap()}},5000);refreshCustomerMap();bindCustomerFormMap()}

function trackingToken(){return location.pathname.match(/^\/r\/([^/]+)/)?.[1]||''}
async function renderTracking(){
  const tokenValue=trackingToken();if(!tokenValue||runtime.trackingBusy)return;runtime.trackingBusy=true;
  try{
    const item=(await request(`/api/public/tracking/${encodeURIComponent(tokenValue)}`,{auth:false})).item;await applyTheme(item.primary_color);
    $('#auth-screen')?.classList.add('hidden');$('#app-shell')?.classList.add('hidden');$('#customer-screen')?.classList.add('hidden');const screen=$('#tracking-screen');screen.classList.remove('hidden');
    if(['delivered','cancelled'].includes(item.status)){screen.innerHTML=`<main class="cj190-ended"><section><img src="/icons/logo-official.png" alt="ChegaJá"><b>${item.status==='cancelled'?'×':'✓'}</b><h1>${item.status==='cancelled'?'Corrida cancelada':'Corrida encerrada'}</h1><p>${item.status==='cancelled'?'Esta solicitação foi cancelada.':'O recebimento foi confirmado e a entrega foi concluída.'}</p>${item.rating_available?`<form id="cj190-rating-form"><h2>Avalie o cooperado</h2><div>${[1,2,3,4,5].map(value=>`<button type="button" data-score="${value}" class="selected">★</button>`).join('')}</div><textarea name="comment" placeholder="Escreva seu comentário (opcional)"></textarea><button type="submit">Enviar avaliação</button></form>`:''}<a href="/">Voltar ao início</a></section></main>`;bindPublicRating(tokenValue);clearInterval(runtime.trackingTimer);return}
    if(!$('.cj190-tracking',screen))screen.innerHTML=`<main class="cj190-tracking"><header><img src="/icons/logo-official.png" alt="ChegaJá"><div><small>ACOMPANHAMENTO</small><h1 id="cj190-track-code"></h1><span id="cj190-track-status"></span></div></header><div id="cj190-track-map"></div><section class="cj190-track-sheet"><div id="cj190-track-driver"></div><div id="cj190-track-route"></div><div id="cj190-track-codebox"></div><button id="cj190-received">Confirmar que recebi</button><div id="cj190-track-chat"></div></section></main>`;
    $('#cj190-track-code').textContent=item.display_code||'Entrega';$('#cj190-track-status').textContent=STATUS[item.status]||item.status;
    $('#cj190-track-driver').innerHTML=`<span>${item.driver_photo_url?`<img src="${esc(item.driver_photo_url)}">`:'CJ'}</span><div><small>COOPERADO</small><strong>${esc(item.driver_name||'Aguardando')}</strong><em>${esc([item.vehicle_model,item.vehicle_plate].filter(Boolean).join(' • '))}</em></div>`;
    $('#cj190-track-route').innerHTML=`<div><i>C</i><span><small>COLETA</small><strong>${esc(item.pickup_address||'')}</strong></span></div><em></em><div><i>E</i><span><small>ENTREGA</small><strong>${esc(item.delivery_address||'')}</strong></span></div>`;
    $('#cj190-track-codebox').innerHTML=item.confirmation_code?`<small>CÓDIGO PARA CONFIRMAR</small><strong>${esc(item.confirmation_code)}</strong><span>Informe somente quando o pedido estiver em suas mãos.</span>`:'';
    const receive=$('#cj190-received');receive.hidden=['new','offered','assigned'].includes(item.status);receive.onclick=async()=>{if(!confirm('Confirmar que você recebeu a entrega?'))return;receive.disabled=true;try{await request(`/api/public/tracking/${encodeURIComponent(tokenValue)}/received`,{auth:false,method:'POST',body:{}});await renderTracking()}catch(error){alert(error.message);receive.disabled=false}};
    const driver=point(item.driver_lat,item.driver_lng),pickup=point(item.pickup_lat,item.pickup_lng),delivery=point(item.delivery_lat,item.delivery_lng),origin=validPoint(driver)?driver:pickup,destination=['picked_up','in_route'].includes(item.status)?delivery:pickup,markers=[{lat:pickup.lat,lng:pickup.lng,label:'C'},{lat:delivery.lat,lng:delivery.lng,label:'E'}];if(validPoint(driver))markers.push({lat:driver.lat,lng:driver.lng,photo:item.driver_photo_url,label:'CJ',title:item.driver_name});await mountInteractiveMap($('#cj190-track-map'),{center:origin,origin,destination,markers,route:item.route_geometry,zoom:14});await renderTrackingChat(tokenValue,item);
  }catch(error){const screen=$('#tracking-screen');screen.classList.remove('hidden');screen.innerHTML=`<div class="cj190-error"><strong>Não foi possível abrir o acompanhamento</strong><span>${esc(error.message)}</span></div>`}finally{runtime.trackingBusy=false}
}
async function renderTrackingChat(tokenValue,item){
  const host=$('#cj190-track-chat');if(!host||!item.customer_chat_enabled||!ACTIVE.has(item.status)){if(host)host.innerHTML='';return}
  const conversation=item.driver_name?'customer_driver':'customer_place';try{const data=await request(`/api/public/tracking/${encodeURIComponent(tokenValue)}/messages?conversation=${conversation}`,{auth:false});host.innerHTML=`<header><strong>Conversa da entrega</strong></header><div class="messages">${(data.items||[]).map(message=>`<div class="${message.sender_type==='customer'?'mine':''}"><small>${esc(message.sender_name)}</small><p>${esc(message.message)}</p></div>`).join('')||'<p>Nenhuma mensagem.</p>'}</div>${data.active?'<form><input name="message" maxlength="500" required placeholder="Digite uma mensagem"><button>Enviar</button></form>':''}`;const form=host.querySelector('form');if(form)form.onsubmit=async event=>{event.preventDefault();const text=form.message.value.trim();if(!text)return;await request(`/api/public/tracking/${encodeURIComponent(tokenValue)}/messages`,{auth:false,method:'POST',body:{conversation,message:text}});form.reset();await renderTrackingChat(tokenValue,item)}}catch{host.innerHTML=''}
}
function bindPublicRating(tokenValue){const form=$('#cj190-rating-form');if(!form)return;let score=5;form.querySelectorAll('[data-score]').forEach(button=>button.onclick=()=>{score=Number(button.dataset.score);form.querySelectorAll('[data-score]').forEach(star=>star.classList.toggle('selected',Number(star.dataset.score)<=score))});form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;try{await request(`/api/public/tracking/${encodeURIComponent(tokenValue)}/rating`,{auth:false,method:'POST',body:{driver_score:score,establishment_score:5,comment:form.comment.value}});form.outerHTML='<p class="cj190-rating-done">Avaliação enviada. Obrigado!</p>'}catch(error){alert(error.message);button.disabled=false}}}
function installTracking(){const tokenValue=trackingToken();if(!tokenValue)return;window.publicTracking=renderTracking;clearInterval(runtime.trackingTimer);renderTracking();runtime.trackingTimer=setInterval(()=>{if(!document.hidden)renderTracking()},4000)}

async function refreshOperationalMaps(){
  const current=appState();if(!current||!['cooperative_admin','dispatcher','establishment'].includes(current.user?.role))return;
  const hosts=[...document.querySelectorAll('#v31-base-map,#cj14-est-map')].filter(host=>host.offsetWidth>40&&host.offsetHeight>40);if(!hosts.length)return;
  try{const data=await request('/api/app/map/drivers',{timeout:6000}),items=(data.items||[]).filter(item=>Number(item.online)===1&&item.current_lat!=null&&item.current_lng!=null);const signature=JSON.stringify(items.map(item=>[item.id,item.current_lat,item.current_lng,item.photo_url,item.location_updated_at]));if(signature===runtime.operationalSignature)return;runtime.operationalSignature=signature;for(const host of hosts){const markers=items.map(item=>({lat:item.current_lat,lng:item.current_lng,photo:item.photo_url,label:'CJ',title:item.name,popup:`<strong>${esc(item.name)}</strong><br>${esc(item.vehicle_plate||'')}`}));const center=markers[0]?point(markers[0].lat,markers[0].lng):{lat:-5.7945,lng:-35.211};await mountInteractiveMap(host,{center,markers,zoom:13})}}catch{}
}
function installOperationalMaps(){clearInterval(runtime.operationalTimer);runtime.operationalTimer=setInterval(()=>{if(!document.hidden)refreshOperationalMaps()},4000);refreshOperationalMaps()}

function fastBaseOrder(event){const button=event.target.closest('#v31-new-delivery');if(!button)return;event.preventDefault();event.stopImmediatePropagation();const cached=appState()?.cache||{};Promise.resolve(window.ChegaJaV16?.baseOrderForm?.(cached)).catch(error=>typeof toast==='function'&&toast(error.message,'error'))}
document.addEventListener('click',fastBaseOrder,true);

function cleanupLegacy(){
  for(const selector of ['#cj143-driver-nav','#cj143-driver-menu','#cj173-nav','#cj180-driver-nav','#cj183-driver-top','#cj144-sos-floating'])$(selector)?.remove();
  $$('.toast,.notification-toast').forEach(node=>{const text=node.textContent.toLowerCase();if(text.includes('você está online')||text.trim()==='online')node.remove()});
}
function observe(){
  runtime.driverObserver?.disconnect();runtime.driverObserver=new MutationObserver(()=>requestAnimationFrame(()=>{
    cleanupLegacy();if(isDriver()&&appState()?.page==='dashboard'&&!$('#cj190-driver-app'))renderDriverDashboard();if($('.v32-client-app')&&!runtime.clientTimer)installCustomerMap();ensurePageMenu();refreshOperationalMaps();
  }));runtime.driverObserver.observe(document.documentElement,{childList:true,subtree:true});
}
function boot(){applyTheme();installDriverPages();observe();installTracking();installOperationalMaps();cleanupLegacy();if(isDriver()&&appState()?.page==='dashboard')renderDriverDashboard();if($('.v32-client-app'))installCustomerMap()}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();
