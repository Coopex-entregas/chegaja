/* ChegaJá 14.31.6 — painel único do cooperado com Google Maps */
(()=>{
'use strict';
if(window.__CJ_GOOGLE_DRIVER_14316__)return;
window.__CJ_GOOGLE_DRIVER_14316__=true;

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
 map:null,mapConfig:null,mapLoading:null,self:null,pickup:null,delivery:null,casing:null,line:null,directions:null,
 gps:null,gpsWatch:null,firstGpsCentered:false,manualView:false,programmatic:false,lastSent:0,
 detail:null,online:false,queue:null,summary:null,schedules:[],decision:false,lastOfferId:'',audio:null,audioUnlocked:false,
 pollTimer:null,routeTimer:null,healthTimer:null,routeBusy:false,lastRouteAt:0,routePoints:[],sheetKey:'',touchY:null
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
 <div id="cj199-map" aria-label="Google Maps do cooperado"></div>
 <button id="cj199-metric" type="button"><small id="cj199-metric-label">GANHOS HOJE</small><strong id="cj199-metric-value">R$ 0,00</strong><span id="cj199-metric-hint">Acompanhe sua operação</span></button>
 <button id="cj199-queue" type="button"><small>FILA</small><strong id="cj199-queue-number">+</strong></button>
 <button id="cj199-center" type="button" aria-label="Centralizar na minha localização">◎</button>
 <button id="cj199-start" type="button"><span>INICIAR</span></button>
 <button id="cj199-checkin" type="button"><b>✓</b><small>CHECK-IN</small></button>
 <section id="cj199-bottom"><button id="cj199-up" type="button" aria-label="Abrir painel">⌃</button><div><strong id="cj199-online">Você está offline</strong><small id="cj199-queue-text">Você está fora da fila</small></div><button id="cj199-menu" type="button" aria-label="Abrir menu">☰</button></section>
 <section id="cj199-sheet"><button class="handle" type="button" aria-label="Fechar painel"></button><header><div><small>MINHA ESCALA</small><strong>Datas, horários e locais</strong></div><button id="cj199-down" type="button">⌄</button></header><div id="cj199-schedules"><p class="empty">Carregando…</p></div></section>
 <div id="cj199-drawer"><button class="backdrop" type="button"></button><aside><header><div id="cj199-photo">CJ</div><span><strong id="cj199-name">Cooperado</strong><small>Meu aplicativo</small></span><button data-close type="button">×</button></header><nav><button data-go="dashboard">Início</button><button data-go="deliveries">Entregas</button><button data-go="schedules">Minha escala</button><button data-go="routes">Rotas</button><button data-go="financial">Ganhos e descontos</button><button data-go="advances">Adiantamentos</button><button data-checkin>Fazer check-in</button><button data-go="ratings">Avaliações</button><button data-go="profile">Perfil e configurações</button><button data-go="account">Alterar senha</button><button data-logout>Sair</button></nav></aside></div>
 </main>`}

async function loadGoogleMaps(){
 if(window.google?.maps)return window.google.maps;
 if(A.mapLoading)return A.mapLoading;
 A.mapLoading=(async()=>{
  const cfg=(await api('/api/auth/maps-config',{timeout:7000})).item||{};
  if(!cfg.enabled||!cfg.api_key)throw new Error('Cadastre a chave do Google Maps para navegador no Administrador Principal.');
  A.mapConfig=cfg;
  await new Promise((resolve,reject)=>{
   if(window.google?.maps){resolve();return}
   const callback=`__cjGoogleReady_${Date.now()}`;window[callback]=()=>{delete window[callback];resolve()};
   const script=document.createElement('script');script.async=true;script.defer=true;
   script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.api_key)}&v=weekly&libraries=geometry&callback=${callback}`;
   script.onerror=()=>{delete window[callback];reject(new Error('Não foi possível carregar o Google Maps. Verifique a chave e as APIs ativadas.'))};
   document.head.appendChild(script);
  });
  return window.google.maps;
 })();
 return A.mapLoading;
}
function currentCenter(){try{return A.map?.getCenter?.()?.toJSON?.()||null}catch{return null}}
function ensureSelfMarker(){
 if(!A.map||!A.gps)return;
 const icon={path:google.maps.SymbolPath.CIRCLE,scale:10,fillColor:'#18b85a',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:4};
 if(!A.self)A.self=new google.maps.Marker({map:A.map,position:A.gps,icon,zIndex:1000,title:'Sua localização'});else A.self.setPosition(A.gps);
}
function stopIcon(color,label){return{path:google.maps.SymbolPath.CIRCLE,scale:14,fillColor:color,fillOpacity:1,strokeColor:'#fff',strokeWeight:3,labelOrigin:new google.maps.Point(0,0)}}
function updateStops(){
 if(!A.map)return;const item=A.detail;
 for(const marker of[A.pickup,A.delivery])marker?.setMap?.(null);A.pickup=A.delivery=null;
 if(!item)return;
 const pickup=point(item.pickup_lat,item.pickup_lng),delivery=point(item.delivery_lat,item.delivery_lng);
 if(valid(pickup))A.pickup=new google.maps.Marker({map:A.map,position:pickup,icon:stopIcon('#1459ff','C'),label:{text:'C',color:'#fff',fontWeight:'900'},title:'Coleta'});
 if(valid(delivery))A.delivery=new google.maps.Marker({map:A.map,position:delivery,icon:stopIcon('#ff6a1a','E'),label:{text:'E',color:'#fff',fontWeight:'900'},title:'Entrega'});
}
async function ensureMap(){
 const host=$('#cj199-map');if(!host)return;
 await loadGoogleMaps();
 if(A.map&&A.map.getDiv?.()===host){google.maps.event.trigger(A.map,'resize');return}
 host.replaceChildren();
 const center=A.gps||{lat:-5.7945,lng:-35.211};
 const options={center,zoom:A.gps?17:13,disableDefaultUI:true,zoomControl:true,streetViewControl:false,mapTypeControl:false,fullscreenControl:false,gestureHandling:'greedy',clickableIcons:false,backgroundColor:'#dfe7ef'};
 if(A.mapConfig?.map_id&&A.mapConfig.map_id!=='DEMO_MAP_ID')options.mapId=A.mapConfig.map_id;
 A.map=new google.maps.Map(host,options);A.directions=new google.maps.DirectionsService();
 A.map.addListener('dragstart',()=>{if(!A.programmatic)A.manualView=true});
 A.map.addListener('zoom_changed',()=>{if(!A.programmatic)A.manualView=true});
 ensureSelfMarker();updateStops();
 if(A.routePoints.length)drawRoute(A.routePoints);
}
function clearRoute(){A.casing?.setMap?.(null);A.line?.setMap?.(null);A.casing=A.line=null;A.routePoints=[]}
function drawRoute(points){
 if(!A.map||!Array.isArray(points)||points.length<2)return;
 const path=points.map(p=>({lat:Number(p.lat),lng:Number(p.lng)})).filter(valid);if(path.length<2)return;
 A.casing?.setMap?.(null);A.line?.setMap?.(null);A.routePoints=path;
 A.casing=new google.maps.Polyline({map:A.map,path,strokeColor:'#ffffff',strokeOpacity:1,strokeWeight:13,zIndex:20,clickable:false,geodesic:false});
 A.line=new google.maps.Polyline({map:A.map,path,strokeColor:'#1459ff',strokeOpacity:1,strokeWeight:8,zIndex:21,clickable:false,geodesic:false});
 snapSelfToRoute();
}
function geometryPoints(raw){return Array.isArray(raw)?raw.map(p=>point(p?.[0],p?.[1])).filter(valid):[]}
function targetPoint(){
 const item=A.detail;if(!item)return null;const delivering=['picked_up','in_route','problem'].includes(String(item.status));
 const p=point(delivering?item.delivery_lat:item.pickup_lat,delivering?item.delivery_lng:item.pickup_lng);return valid(p)?p:null;
}
function directionsFallback(origin,destination){
 return new Promise(resolve=>{
  if(!A.directions||!valid(origin)||!valid(destination)){resolve([]);return}
  A.directions.route({origin,destination,travelMode:google.maps.TravelMode.DRIVING,provideRouteAlternatives:false},(result,status)=>{
   if(status!==google.maps.DirectionsStatus.OK){resolve([]);return}
   resolve((result.routes?.[0]?.overview_path||[]).map(p=>({lat:p.lat(),lng:p.lng()})));
  });
 });
}
async function updateRoute(force=false){
 if(!A.detail||!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(A.detail.status))||A.routeBusy||document.hidden)return;
 if(!force&&Date.now()-A.lastRouteAt<7000)return;A.lastRouteAt=Date.now();A.routeBusy=true;
 try{
  const data=await api('/api/app/v32/driver/navigation',{timeout:9000});let points=geometryPoints(data.route?.geometry);
  if(points.length<2&&!data.arrived)points=await directionsFallback(A.gps,targetPoint());
  if(points.length>=2)drawRoute(points);else if(!data.arrived)notice('A rota ainda não foi calculada. Verifique as APIs Routes e Maps JavaScript.',true);
 }catch(error){const points=await directionsFallback(A.gps,targetPoint());if(points.length>=2)drawRoute(points);else notice(error.message,true)}
 finally{A.routeBusy=false}
}
function distance(a,b){
 if(!valid(a)||!valid(b))return Infinity;const rad=v=>v*Math.PI/180,r=6371000,dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;return 2*r*Math.asin(Math.min(1,Math.sqrt(h)));
}
function snapSelfToRoute(){
 if(!A.self||!A.gps||A.routePoints.length<2){ensureSelfMarker();return}
 let best=A.gps,bestDistance=Infinity,step=Math.max(1,Math.floor(A.routePoints.length/350));
 for(let i=0;i<A.routePoints.length;i+=step){const d=distance(A.gps,A.routePoints[i]);if(d<bestDistance){bestDistance=d;best=A.routePoints[i]}}
 A.self.setPosition(bestDistance<=80?best:A.gps);
}
function centralize(){
 if(!A.map||!A.gps)return notice('Aguardando a localização do GPS.',true);
 A.manualView=false;A.programmatic=true;A.map.setCenter(A.gps);A.map.setZoom(18);setTimeout(()=>A.programmatic=false,350);
}
function preserveResize(){
 if(!A.map)return;const center=currentCenter(),zoom=A.map.getZoom();
 for(const delay of[80,260,520])setTimeout(()=>{try{google.maps.event.trigger(A.map,'resize');if(center){A.programmatic=true;A.map.setCenter(center);if(Number.isFinite(zoom))A.map.setZoom(zoom);setTimeout(()=>A.programmatic=false,80)}if(A.routePoints.length)drawRoute(A.routePoints)}catch{}},delay);
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
 host.innerHTML=`<section class="cj217-sheet"><div class="cj217-delivery-head"><div><small>${offer?'NOVA ENTREGA':'ENTREGA ATUAL'}</small><strong>${esc(item.display_code||'Entrega')}</strong></div><span>${esc(statusText(item.status))}</span></div><article class="cj217-address"><b>C</b><div><small>COLETA</small><strong>${esc(item.pickup_address||'Endereço não informado')}</strong>${item.pickup_complement?`<span>${esc(item.pickup_complement)}</span>`:''}</div></article><article class="cj217-address"><b>E</b><div><small>ENTREGA</small><strong>${esc(item.delivery_address||'Endereço não informado')}</strong>${item.delivery_complement?`<span>${esc(item.delivery_complement)}</span>`:''}</div></article><div class="cj217-values"><span><small>VOCÊ RECEBE</small><b>${money(item.driver_net_cents??item.driver_earnings_cents??item.charge_cents??0)}</b></span><span><small>PAGAMENTO</small><b>${esc(String(item.payment_method||'—').toUpperCase())}</b></span><span><small>DISTÂNCIA</small><b>${Number(item.distance_meters||0)>=1000?`${(Number(item.distance_meters)/1000).toFixed(1).replace('.',',')} km`:`${Math.round(Number(item.distance_meters||0))} m`}</b></span><span><small>TEMPO</small><b>${Math.max(1,Math.round(Number(item.duration_seconds||0)/60))} min</b></span></div>${item.notes?`<p class="cj217-notes"><b>Observações:</b> ${esc(item.notes)}</p>`:''}<div class="cj217-secondary-actions"><button id="cj217-secondary" class="danger" type="button">${offer?'RECUSAR':'CANCELAR ENTREGA'}</button><button id="cj217-open-maps" type="button">ABRIR NO MAPS</button></div></section>`;
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
 applyMetric();renderSheet();
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
function openExternalMaps(){const target=targetPoint();if(!valid(target))return;const params=new URLSearchParams({api:'1',travelmode:'driving',destination:`${target.lat},${target.lng}`});if(valid(A.gps))params.set('origin',`${A.gps.lat},${A.gps.lng}`);location.href=`https://www.google.com/maps/dir/?${params}`}

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
  if(A.map&&!A.firstGpsCentered){A.firstGpsCentered=true;A.programmatic=true;A.map.setCenter(A.gps);A.map.setZoom(17);setTimeout(()=>A.programmatic=false,250)}
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
 A.pollTimer=setInterval(()=>poll(false),3000);A.routeTimer=setInterval(()=>updateRoute(false),8000);A.healthTimer=setInterval(()=>{if(isHome()){removeLegacy();if(!$('#cj199-app'))mount();else{renderControls();if(A.routePoints.length&&A.map&&!A.line)drawRoute(A.routePoints)}}},900);
}
window.addEventListener('orientationchange',preserveResize);window.addEventListener('resize',preserveResize);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isHome()){preserveResize();poll(true)}});
window.addEventListener('load',()=>{install();setInterval(()=>{if(!A.installed)install()},700)},{once:true});if(document.readyState==='complete'){install();setInterval(()=>{if(!A.installed)install()},700)}
})();
