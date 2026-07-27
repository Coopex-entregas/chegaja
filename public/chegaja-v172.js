/* ChegaJá 14.17.3 — painel único, Google Maps permanente e fluxo encerrado */
(()=>{
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=v=>`R$ ${(Number(v||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const km=v=>`${(Number(v||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} km`;
const mins=v=>`${Math.max(1,Math.round(Number(v||0)/60))} min`;
const token=()=>localStorage.getItem('lg_token')||'';
const rt={google:null,audio:null,ring:null,poll:null,trackTimer:null,customerTimer:null,current:null,driverMap:null,trackMap:null,lastDriverId:null,gpsWatch:null,lastGps:null,lastGpsSent:0,busy:false};

async function req(url,opt={}){
  const headers={...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})};
  if(opt.auth!==false&&token())headers.Authorization=`Bearer ${token()}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||6500);
  try{
    const response=await fetch(url,{method:opt.method||'GET',headers,body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
    return data;
  }finally{clearTimeout(timer)}
}
function point(lat,lng){let a=Number(lat),b=Number(lng);const br=(x,y)=>x>=-35&&x<=7&&y>=-75&&y<=-32;if(!br(a,b)&&br(b,a))[a,b]=[b,a];return{lat:a,lng:b}}
function valid(p){return Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=-35&&p.lat<=7&&p.lng>=-75&&p.lng<=-32}
function dist(a,b){if(!valid(a)||!valid(b))return Infinity;const r=6371,d=Math.PI/180,dl=(b.lat-a.lat)*d,dg=(b.lng-a.lng)*d,q=Math.sin(dl/2)**2+Math.cos(a.lat*d)*Math.cos(b.lat*d)*Math.sin(dg/2)**2;return 2*r*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))}
function geometry(raw){let value=raw;try{if(typeof value==='string')value=JSON.parse(value)}catch{return[]}if(value?.type==='LineString')value=(value.coordinates||[]).map(x=>[x[1],x[0]]);return(Array.isArray(value)?value:[]).map(x=>Array.isArray(x)?point(x[0],x[1]):point(x.lat,x.lng)).filter(valid)}
function isDriver(){return typeof state!=='undefined'&&state?.user?.role==='driver'}

async function mapsConfig(){return(await req('/api/public/maps-config',{auth:false,timeout:5000})).item||{}}
async function loadGoogle(){
  if(window.google?.maps?.Map)return mapsConfig();
  if(rt.google)return rt.google;
  rt.google=(async()=>{
    const cfg=await mapsConfig();
    if(!cfg.enabled||!cfg.api_key)throw new Error('Google Maps não configurado no Administrador Master.');
    const existing=document.querySelector('script[data-chegaja-google],script[src*="maps.googleapis.com/maps/api/js"]');
    if(existing){
      await new Promise((resolve,reject)=>{const started=Date.now(),check=()=>window.google?.maps?.Map?resolve():Date.now()-started>9000?reject(new Error('O Google Maps não terminou de carregar.')):setTimeout(check,100);check()});
      return cfg;
    }
    await new Promise((resolve,reject)=>{
      const cb=`__cj173gm${Date.now()}`;window[cb]=()=>{delete window[cb];resolve()};
      const script=document.createElement('script');script.dataset.chegajaGoogle='1';script.async=true;script.defer=true;
      script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.api_key)}&v=weekly&language=pt-BR&region=BR&callback=${cb}`;
      script.onerror=()=>{delete window[cb];reject(new Error('O Google Maps não carregou. Confira a chave, o faturamento e a restrição do domínio.'))};
      document.head.appendChild(script);
    });
    return cfg;
  })();
  try{return await rt.google}catch(error){rt.google=null;throw error}
}
function makePhotoNode(url,label='CJ'){
  const node=document.createElement('div');node.className='cj173-photo-pin';
  node.innerHTML=url?`<img src="${esc(url)}" alt="Foto do cooperado"><i></i>`:`<b>${esc(label).slice(0,2)}</b><i></i>`;
  return node;
}
async function createGoogleMap(host,center={lat:-5.7945,lng:-35.211},zoom=14){
  await loadGoogle();host.replaceChildren();
  const map=new google.maps.Map(host,{center:valid(center)?center:{lat:-5.7945,lng:-35.211},zoom,mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'greedy',clickableIcons:true});
  const groups=new Map(),info=new google.maps.InfoWindow();
  class HtmlMarker extends google.maps.OverlayView{
    constructor(position,node){super();this.position=position;this.node=node;this.setMap(map)}
    onAdd(){this.getPanes().overlayMouseTarget.appendChild(this.node)}
    draw(){const p=this.getProjection().fromLatLngToDivPixel(new google.maps.LatLng(this.position));if(p){this.node.style.left=`${p.x}px`;this.node.style.top=`${p.y}px`}}
    onRemove(){this.node.remove()}
    setPosition(position){this.position=position;this.draw()}
  }
  const remember=(group,item)=>{const key=group||'default';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);return item};
  return{
    raw:map,
    clear(group){for(const item of groups.get(group)||[])try{item.setMap?item.setMap(null):item.setMap?.(null)}catch{}groups.set(group,[])},
    marker(p,opt={}){
      if(!valid(p))return null;
      if(opt.photo){const item=new HtmlMarker(p,makePhotoNode(opt.photo,opt.label));return remember(opt.group,item)}
      const item=new google.maps.Marker({map,position:p,title:opt.title||'',label:{text:String(opt.label||'•'),color:'#fff',fontWeight:'800'},icon:{path:google.maps.SymbolPath.CIRCLE,scale:14,fillColor:opt.color||'#0d45d8',fillOpacity:1,strokeColor:'#fff',strokeWeight:3}});
      if(opt.popup)item.addListener('click',()=>{info.setContent(opt.popup);info.open({map,anchor:item})});
      return remember(opt.group,item)
    },
    line(points,opt={}){const path=(points||[]).filter(valid);if(!path.length)return null;return remember(opt.group,new google.maps.Polyline({map,path,strokeColor:opt.color||'#0d45d8',strokeWeight:opt.weight||6,strokeOpacity:.9}))},
    fit(points,maxZoom=16){const pts=(points||[]).filter(valid);if(!pts.length)return;const bounds=new google.maps.LatLngBounds();pts.forEach(p=>bounds.extend(p));map.fitBounds(bounds,45);google.maps.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>maxZoom)map.setZoom(maxZoom)})},
    center(p,z=17){if(valid(p)){map.setCenter(p);map.setZoom(z)}},
    resize(){google.maps.event.trigger(map,'resize')},
    destroy(){for(const key of groups.keys())this.clear(key);host.replaceChildren()}
  }
}

async function unlockAudio(){try{if(!rt.audio)rt.audio=new(window.AudioContext||window.webkitAudioContext)();if(rt.audio.state==='suspended')await rt.audio.resume();const o=rt.audio.createOscillator(),g=rt.audio.createGain();g.gain.value=.0001;o.connect(g).connect(rt.audio.destination);o.start();o.stop(rt.audio.currentTime+.02)}catch{}}
document.addEventListener('pointerdown',unlockAudio,{capture:true});
function tone(freq,start,duration){if(!rt.audio||rt.audio.state!=='running')return;const o=rt.audio.createOscillator(),g=rt.audio.createGain();o.type='square';o.frequency.value=freq;g.gain.setValueAtTime(.0001,rt.audio.currentTime+start);g.gain.exponentialRampToValueAtTime(.22,rt.audio.currentTime+start+.01);g.gain.exponentialRampToValueAtTime(.0001,rt.audio.currentTime+start+duration);o.connect(g).connect(rt.audio.destination);o.start(rt.audio.currentTime+start);o.stop(rt.audio.currentTime+start+duration+.03)}
function startRing(){if(rt.ring)return;const play=()=>{tone(880,0,.18);tone(1100,.24,.2);tone(880,.54,.24)};play();rt.ring=setInterval(play,1100);navigator.vibrate?.([450,160,450])}
function stopRing(){if(rt.ring)clearInterval(rt.ring);rt.ring=null;navigator.vibrate?.(0)}
function callHtml(x){return`<section id="cj173-call"><header><small>NOVA ENTREGA</small><h1>${esc(x.display_code||'Entrega')}</h1><span>${esc(x.base_name||x.establishment_name||'ChegaJá')}</span></header><div class="value"><small>VOCÊ RECEBE</small><strong>${money(x.driver_net_cents||x.driver_earnings_cents)}</strong></div><div class="route"><div><i>C</i><span><small>COLETA</small><strong>${esc(x.pickup_address)}</strong></span></div><em></em><div><i>E</i><span><small>ENTREGA</small><strong>${esc(x.delivery_address)}</strong></span></div></div><div class="meta"><span>${km(x.distance_meters)}</span><span>${mins(x.duration_seconds)}</span><span>${esc(x.payment_method||'Pagamento')}</span></div><footer><button id="cj173-decline">Recusar</button><button id="cj173-accept">Aceitar</button></footer><p id="cj173-call-message"></p></section>`}
function showCall(x){
  if(rt.current===x.id&&$('#cj173-call'))return;
  rt.current=x.id;$('#cj173-call')?.remove();document.body.insertAdjacentHTML('beforeend',callHtml(x));startRing();
  $('#cj173-decline').onclick=async()=>{const msg=$('#cj173-call-message');try{msg.textContent='Recusando…';await req(`/api/app/driver/live/${x.id}/decline`,{method:'POST',body:{}});stopRing();rt.current=null;$('#cj173-call')?.remove();pollDriver()}catch(e){msg.textContent=e.message}};
  $('#cj173-accept').onclick=async()=>{const b=$('#cj173-accept'),msg=$('#cj173-call-message');b.disabled=true;msg.textContent='Aceitando…';try{await req(`/api/app/driver/live/${x.id}/accept`,{method:'POST',body:{}});stopRing();rt.current=null;$('#cj173-call')?.remove();if(typeof navigate==='function'&&state?.page!=='dashboard')await navigate('dashboard',false);const data=await req('/api/app/driver/live');await mountDriverHome(data,true)}catch(e){msg.textContent=e.message;b.disabled=false}};
}
function hideCall(){stopRing();rt.current=null;$('#cj173-call')?.remove()}

function ensureDriverNav(){
  if(!isDriver())return;
  document.body.classList.add('cj173-driver');
  $$('#cj171-nav,#cj143-driver-nav,#v32-driver-nav,.driver-mobile-nav,#cj144-sos-floating').forEach(x=>x.remove());
  if($('#cj173-nav'))return;
  const nav=document.createElement('nav');nav.id='cj173-nav';nav.innerHTML=`<button data-page="dashboard"><b>⌂</b><span>Início</span></button><button data-page="deliveries"><b>▣</b><span>Entregas</span></button><button data-page="map"><b>⌖</b><span>Mapa</span></button><button data-page="financial"><b>R$</b><span>Ganhos</span></button><button data-page="profile"><b>●</b><span>Perfil</span></button>`;document.body.appendChild(nav);
  nav.querySelectorAll('[data-page]').forEach(button=>button.onclick=async()=>{const page=button.dataset.page;if(page==='map'){if(typeof navigate==='function'&&state?.page!=='dashboard')await navigate('dashboard',false);setTimeout(()=>$('#cj173-driver-map')?.scrollIntoView({behavior:'smooth',block:'start'}),100);return}if(typeof navigate==='function')navigate(page)});
}
function navigationUrl(active){
  if(!active)return '#';const toDelivery=['picked_up','in_route','at_delivery'].includes(active.status);const lat=toDelivery?active.delivery_lat:active.pickup_lat,lng=toDelivery?active.delivery_lng:active.pickup_lng,address=toDelivery?active.delivery_address:active.pickup_address;const p=point(lat,lng);const destination=valid(p)?`${p.lat},${p.lng}`:address;return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination||'')}&travelmode=driving`
}
async function mountDriverHome(data,forceFit=false){
  if(!isDriver())return;ensureDriverNav();
  const content=$('#page-content');if(!content)return;
  $$('#v31-driver-map,#cj17-driver-map,.cj31-driver-map,.cj172-map-card').forEach(x=>x.remove());
  let card=$('#cj173-map-card');
  if(!card){card=document.createElement('section');card.id='cj173-map-card';card.innerHTML=`<header><div><small>MAPA GOOGLE EM TEMPO REAL</small><h2 id="cj173-map-title">Sua localização</h2></div><button id="cj173-center">Centralizar</button></header><div id="cj173-driver-map"></div><div id="cj173-map-status"></div>`;content.prepend(card)}
  const host=$('#cj173-driver-map'),own=point(data.driver?.current_lat,data.driver?.current_lng),active=data.active||null,center=valid(own)?own:point(active?.pickup_lat,active?.pickup_lng);
  try{
    if(!rt.driverMap)rt.driverMap=await createGoogleMap(host,valid(center)?center:{lat:-5.7945,lng:-35.211},15);
    rt.driverMap.clear('self');rt.driverMap.clear('stops');rt.driverMap.clear('route');
    const pts=[];
    if(valid(own)){pts.push(own);rt.driverMap.marker(own,{group:'self',photo:data.driver?.photo_url,label:'EU',title:data.driver?.name})}
    if(active){
      const pickup=point(active.pickup_lat,active.pickup_lng),drop=point(active.delivery_lat,active.delivery_lng);if(valid(pickup)){pts.push(pickup);rt.driverMap.marker(pickup,{group:'stops',color:'#e5252a',label:'C',title:'Coleta'})}if(valid(drop)){pts.push(drop);rt.driverMap.marker(drop,{group:'stops',color:'#16a34a',label:'E',title:'Entrega'})}rt.driverMap.line(geometry(active.route_geometry),{group:'route'});
      $('#cj173-map-title').textContent=`Entrega ${active.display_code}`;
      $('#cj173-map-status').innerHTML=`<div><strong>${esc(active.display_code)}</strong><span>${km(active.distance_meters)} • ${mins(active.duration_seconds)}</span></div><a id="cj173-open-google" href="${navigationUrl(active)}" target="_blank" rel="noopener">Abrir no Google Maps</a>`;
      if(forceFit||rt.lastDriverId!==active.id){rt.driverMap.fit(pts,16);rt.lastDriverId=active.id}
    }else{
      $('#cj173-map-title').textContent='Sua localização';$('#cj173-map-status').innerHTML=`<div><strong>${data.driver?.online?'Online':'Offline'}</strong><span>${valid(own)?'GPS atualizado':'Aguardando localização precisa'}</span></div><button id="cj173-online-button">${data.driver?.online?'Ficar offline':'Ficar online'}</button>`;
      $('#cj173-online-button').onclick=()=>toggleOnline(!data.driver?.online);
      if((forceFit||!rt.lastDriverId)&&valid(own))rt.driverMap.center(own,17);rt.lastDriverId=null;
    }
    $('#cj173-center').onclick=()=>valid(own)&&rt.driverMap.center(own,17);rt.driverMap.resize();
  }catch(e){host.innerHTML=`<div class="cj173-map-error"><strong>Google Maps indisponível</strong><span>${esc(e.message)}</span></div>`}
}
async function currentPosition(){return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve(p),reject,{enableHighAccuracy:true,maximumAge:0,timeout:15000}))}
async function toggleOnline(online){
  try{let body={online};if(online){const p=await currentPosition();body={online:true,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}}await req('/api/app/v6/driver/online',{method:'POST',body});if(online)startGps();const data=await req('/api/app/driver/live');if(typeof state!=='undefined'){state.online=Boolean(data.driver?.online);try{updateOnlineControl()}catch{}}await mountDriverHome(data,true)}catch(e){typeof toast==='function'?toast(e.message,'error'):alert(e.message)}
}
function startGps(){
  if(rt.gpsWatch!=null||!navigator.geolocation||!isDriver())return;
  rt.gpsWatch=navigator.geolocation.watchPosition(async position=>{
    const accuracy=Number(position.coords.accuracy||9999),p=point(position.coords.latitude,position.coords.longitude);if(!valid(p))return;if(accuracy>200&&rt.lastGps)return;if(rt.lastGps&&dist(rt.lastGps,p)>8&&Date.now()-rt.lastGpsSent<30000)return;rt.lastGps=p;
    if(Date.now()-rt.lastGpsSent<4000)return;rt.lastGpsSent=Date.now();
    req('/api/app/map/location',{method:'POST',body:{latitude:p.lat,longitude:p.lng,accuracy,speed:position.coords.speed,heading:position.coords.heading},timeout:4500}).catch(()=>{});
  },()=>{}, {enableHighAccuracy:true,maximumAge:0,timeout:15000});
}
async function pollDriver(){
  if(!isDriver()||!token()||document.hidden||rt.busy)return;rt.busy=true;
  try{const data=await req('/api/app/driver/live',{timeout:4500});if(typeof state!=='undefined'){state.online=Boolean(data.driver?.online);try{updateOnlineControl()}catch{}}if(data.driver?.online)startGps();if(data.call)showCall(data.call);else hideCall();ensureDriverNav();if($('#cj173-driver-map'))await mountDriverHome(data)}catch{}finally{rt.busy=false}
}
function installDriver(){
  clearInterval(rt.poll);rt.poll=setInterval(pollDriver,1500);pollDriver();
  if(typeof pages!=='undefined'&&pages.dashboard&&!pages.dashboard.__cj173){const oldDashboard=pages.dashboard;pages.dashboard=async function(){const result=await oldDashboard.apply(this,arguments);if(isDriver()){const data=await req('/api/app/driver/live').catch(()=>null);if(data)await mountDriverHome(data,true)}return result};pages.dashboard.__cj173=true}
  if(typeof pages!=='undefined'&&pages.routes&&!pages.routes.__cj173){pages.routes=async function(){if(!isDriver())return;const old=pages.dashboard;await old();setTimeout(()=>$('#cj173-driver-map')?.scrollIntoView({behavior:'smooth',block:'start'}),80)};pages.routes.__cj173=true}
}

function endedScreen(x){
  clearInterval(rt.trackTimer);rt.trackTimer=null;rt.trackMap?.destroy?.();rt.trackMap=null;
  const cancelled=x.status==='cancelled';const screen=$('#tracking-screen');screen.innerHTML=`<section class="cj173-ended"><img src="/icons/icon-official.png" alt="ChegaJá"><div><small>${esc(x.display_code||'ENTREGA')}</small><b>${cancelled?'×':'✓'}</b><h1>${cancelled?'Corrida cancelada':'Corrida encerrada'}</h1><p>${cancelled?'Esta solicitação foi cancelada e não possui mais acompanhamento ativo.':'O recebimento foi confirmado e esta entrega foi concluída.'}</p>${x.customer_confirmed_received_at?'<strong>Recebimento confirmado pelo cliente</strong>':''}<a href="/">Voltar ao início</a></div></section>`
}
async function renderChat(trackToken,x){
  const host=$('#cj173-chat');if(!host||!x.customer_chat_enabled||['delivered','cancelled'].includes(x.status)){if(host)host.innerHTML='';return}
  const conversation=x.driver_name?'customer_driver':'customer_place';
  try{const data=await req(`/api/public/tracking/${encodeURIComponent(trackToken)}/messages?conversation=${conversation}`,{auth:false,timeout:5000});host.innerHTML=`<header><strong>Conversar sobre a entrega</strong></header><div class="messages">${(data.items||[]).map(m=>`<div class="${m.sender_type==='customer'?'mine':''}"><small>${esc(m.sender_name)}</small><p>${esc(m.message)}</p></div>`).join('')||'<p>Nenhuma mensagem.</p>'}</div>${data.active?`<form id="cj173-chat-form"><input name="message" maxlength="500" placeholder="Digite uma mensagem" required><button>Enviar</button></form>`:''}`;$('#cj173-chat-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{await req(`/api/public/tracking/${encodeURIComponent(trackToken)}/messages`,{auth:false,method:'POST',body:{conversation,message:form.message.value}});form.reset();renderChat(trackToken,x)}catch(e){alert(e.message);button.disabled=false}})}catch{host.innerHTML=''}
}
async function publicTracker(trackToken){
  clearInterval(rt.trackTimer);$('#auth-screen')?.classList.add('hidden');$('#app-shell')?.classList.add('hidden');$('#customer-screen')?.classList.add('hidden');const screen=$('#tracking-screen');if(!screen)return;screen.classList.remove('hidden');screen.innerHTML='<div class="cj173-track-loading">Carregando entrega…</div>';
  let first=true;
  const refresh=async()=>{
    try{
      const x=(await req(`/api/public/tracking/${encodeURIComponent(trackToken)}`,{auth:false,timeout:6000})).item;
      if(['delivered','cancelled'].includes(x.status)){endedScreen(x);return}
      if(!$('#cj173-track-map'))screen.innerHTML=`<section class="cj173-track"><header><img src="/icons/icon-official.png"><div><small>ACOMPANHAMENTO</small><h1 id="cj173-code">Entrega</h1><span id="cj173-status"></span></div></header><div id="cj173-track-map"></div><section class="sheet"><div id="cj173-driver"></div><div class="addresses"><div><small>Coleta</small><strong id="cj173-pickup"></strong></div><div><small>Entrega</small><strong id="cj173-delivery"></strong></div></div><div id="cj173-code-box"></div><div id="cj173-received"></div><div id="cj173-meta"></div><section id="cj173-chat"></section></section></section>`;
      $('#cj173-code').textContent=x.display_code||'Entrega';$('#cj173-status').textContent=x.status||'';$('#cj173-pickup').textContent=x.pickup_address||'—';$('#cj173-delivery').textContent=x.delivery_address||'—';
      $('#cj173-driver').innerHTML=`<span>${x.driver_photo_url?`<img src="${esc(x.driver_photo_url)}">`:'<b>CJ</b>'}</span><div><small>Cooperado</small><strong>${esc(x.driver_name||'Aguardando')}</strong><em>${esc([x.vehicle_model,x.vehicle_plate].filter(Boolean).join(' • '))}</em></div>`;
      $('#cj173-code-box').innerHTML=x.confirmation_code?`<small>CÓDIGO PARA CONFIRMAR</small><strong>${esc(x.confirmation_code)}</strong><span>Informe apenas quando o pedido estiver em suas mãos.</span>`:'';
      const canReceive=!['new','offered','assigned'].includes(x.status);$('#cj173-received').innerHTML=canReceive?'<button id="cj173-received-button">Confirmar que recebi</button><small>Esta ação encerra a corrida imediatamente.</small>':'';
      $('#cj173-received-button')?.addEventListener('click',async()=>{if(!confirm('Confirmar que você recebeu a entrega? A corrida será encerrada.'))return;const b=$('#cj173-received-button');b.disabled=true;try{await req(`/api/public/tracking/${encodeURIComponent(trackToken)}/received`,{auth:false,method:'POST',body:{}});await refresh()}catch(e){alert(e.message);b.disabled=false}});
      $('#cj173-meta').innerHTML=`<span><small>Distância</small><strong>${km(x.distance_meters)}</strong></span><span><small>Previsão</small><strong>${mins(x.duration_seconds)}</strong></span><span><small>Atualizado</small><strong>${x.location_updated_at?new Date(x.location_updated_at).toLocaleTimeString('pt-BR'):'—'}</strong></span>`;
      const pickup=point(x.pickup_lat,x.pickup_lng),drop=point(x.delivery_lat,x.delivery_lng),driver=point(x.driver_lat,x.driver_lng),safeDriver=valid(driver)&&Math.min(dist(driver,pickup),dist(driver,drop))<150?driver:null;
      if(!rt.trackMap)rt.trackMap=await createGoogleMap($('#cj173-track-map'),valid(pickup)?pickup:{lat:-5.7945,lng:-35.211},13);
      rt.trackMap.clear('fixed');rt.trackMap.clear('driver');rt.trackMap.clear('route');const pts=[];
      if(valid(pickup)){pts.push(pickup);rt.trackMap.marker(pickup,{group:'fixed',color:'#e5252a',label:'C'})}if(valid(drop)){pts.push(drop);rt.trackMap.marker(drop,{group:'fixed',color:'#16a34a',label:'E'})}if(safeDriver){pts.push(safeDriver);rt.trackMap.marker(safeDriver,{group:'driver',photo:x.driver_photo_url,label:'CJ'})}rt.trackMap.line(geometry(x.route_geometry),{group:'route'});if(first){rt.trackMap.fit(pts,16);first=false}rt.trackMap.resize();renderChat(trackToken,x)
    }catch(e){screen.innerHTML=`<div class="cj173-map-error"><strong>Não foi possível abrir o acompanhamento</strong><span>${esc(e.message)}</span></div>`}
  };
  await refresh();if($('#cj173-track-map'))rt.trackTimer=setInterval(()=>{if(!document.hidden)refresh()},4000)
}
function enhanceCustomerOrders(){
  if($('#customer-screen')?.classList.contains('hidden'))return;
  $$('#cj17-order-list article').forEach(article=>{if(article.dataset.cj173)return;const link=article.querySelector('a[href*="/r/"]');if(!link)return;const match=link.href.match(/\/r\/([^/?#]+)/);if(!match)return;article.dataset.cj173='1';const trackToken=match[1],actions=document.createElement('div');actions.className='cj173-order-actions';actions.innerHTML=`<a href="/r/${trackToken}#chat">Conversar</a><button>Confirmar que recebi</button>`;article.appendChild(actions);actions.querySelector('button').onclick=async()=>{if(!confirm('Confirmar que você recebeu a entrega?'))return;try{const result=await req(`/api/public/tracking/${trackToken}/received`,{auth:false,method:'POST',body:{}});alert(result.message);location.href=`/r/${trackToken}`}catch(e){alert(e.message)}}})
}
function boot(){
  installDriver();clearInterval(rt.customerTimer);rt.customerTimer=setInterval(enhanceCustomerOrders,1500);enhanceCustomerOrders();
  const trackToken=location.pathname.match(/^\/r\/([^/]+)/)?.[1];if(trackToken){window.publicTracking=publicTracker;setTimeout(()=>publicTracker(trackToken),20)}
  const params=new URLSearchParams(location.search);if(location.pathname==='/cliente'||params.has('cliente'))setTimeout(()=>window.chegajaOpenCustomer?.(params.get('mode')||'hub'),40)
}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();
