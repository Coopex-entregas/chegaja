/* ChegaJá 14.17.1 — experiência única do cooperado e rastreio público estável */
(()=>{
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=v=>`R$ ${(Number(v||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const km=v=>`${(Number(v||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} km`;
const min=v=>`${Math.max(1,Math.round(Number(v||0)/60))} min`;
const token=()=>localStorage.getItem('lg_token')||'';
const runtime={timer:null,current:null,audio:null,ring:null,map:null,trackTimer:null};

async function req(url,opt={}){
  const headers={...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})};
  if(opt.auth!==false&&token())headers.Authorization=`Bearer ${token()}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||7000);
  try{
    const response=await fetch(url,{method:opt.method||'GET',headers,body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
    return data;
  }finally{clearTimeout(timer)}
}

async function unlockAudio(){
  try{
    if(!runtime.audio)runtime.audio=new (window.AudioContext||window.webkitAudioContext)();
    if(runtime.audio.state==='suspended')await runtime.audio.resume();
    const osc=runtime.audio.createOscillator(),gain=runtime.audio.createGain();
    gain.gain.value=.0001;osc.connect(gain).connect(runtime.audio.destination);osc.start();osc.stop(runtime.audio.currentTime+.02);
    document.body.classList.add('cj171-sound-ready');
  }catch{}
}
document.addEventListener('pointerdown',unlockAudio,{capture:true});
document.addEventListener('click',event=>{if(event.target.closest('#login-form button,#online-toggle,#driver-home-online'))unlockAudio()},{capture:true});

function tone(freq,start=.0,duration=.18,gain=.18){
  if(!runtime.audio||runtime.audio.state!=='running')return;
  const osc=runtime.audio.createOscillator(),amp=runtime.audio.createGain();
  osc.type='square';osc.frequency.value=freq;amp.gain.setValueAtTime(.0001,runtime.audio.currentTime+start);amp.gain.exponentialRampToValueAtTime(gain,runtime.audio.currentTime+start+.01);amp.gain.exponentialRampToValueAtTime(.0001,runtime.audio.currentTime+start+duration);osc.connect(amp).connect(runtime.audio.destination);osc.start(runtime.audio.currentTime+start);osc.stop(runtime.audio.currentTime+start+duration+.02)
}
function ringStart(){
  if(runtime.ring)return;
  const play=()=>{tone(880,0,.18,.16);tone(1040,.24,.18,.17);tone(880,.5,.22,.16)};
  play();runtime.ring=setInterval(play,1150);
  try{navigator.vibrate?.([450,180,450])}catch{}
}
function ringStop(){if(runtime.ring)clearInterval(runtime.ring);runtime.ring=null;try{navigator.vibrate?.(0)}catch{}}

function ensureSingleDriverUi(){
  const isDriver=(typeof state!=='undefined'&&state?.user?.role==='driver')||document.body.classList.contains('cj143-driver')||document.body.classList.contains('driver-app-mode');
  if(!isDriver)return;
  document.body.classList.add('cj171-driver');
  $$('.driver-mobile-nav,#v32-driver-nav,#v32-driver-menu,.v32-driver-drawer,#cj144-sos-floating').forEach(el=>el.remove());
  let nav=$('#cj171-nav');
  if(!nav){
    nav=document.createElement('nav');nav.id='cj171-nav';
    nav.innerHTML=`<button data-go="dashboard"><i>⌂</i><span>Início</span></button><button data-go="deliveries"><i>▣</i><span>Entregas</span></button><button data-go="routes"><i>➜</i><span>Mapa</span></button><button data-go="financial"><i>R$</i><span>Ganhos</span></button><button data-go="profile"><i>●</i><span>Perfil</span></button>`;
    document.body.appendChild(nav);
    nav.querySelectorAll('[data-go]').forEach(button=>button.onclick=()=>typeof navigate==='function'&&navigate(button.dataset.go));
  }
  nav.querySelectorAll('[data-go]').forEach(button=>button.classList.toggle('active',typeof state!=='undefined'&&state.page===button.dataset.go));
}

function callHtml(x){
  const place=x.base_name||x.establishment_name||'ChegaJá';
  return `<section id="cj171-call" role="dialog" aria-modal="true"><div class="cj171-call-top"><span>NOVA ENTREGA</span><strong>${esc(x.display_code||'Entrega')}</strong><small>${esc(place)}</small></div><div class="cj171-call-value"><small>Você recebe</small><strong>${money(x.driver_net_cents||x.driver_earnings_cents)}</strong></div><div class="cj171-call-route"><div><i>C</i><span><small>COLETA</small><strong>${esc(x.pickup_address)}</strong></span></div><div class="line"></div><div><i>E</i><span><small>ENTREGA</small><strong>${esc(x.delivery_address)}</strong></span></div></div><div class="cj171-call-meta"><span>${km(x.distance_meters)}</span><span>${min(x.duration_seconds)}</span><span>${esc(x.payment_method||'Pagamento')}</span></div><div class="cj171-call-actions"><button id="cj171-decline">Recusar</button><button id="cj171-accept">Aceitar entrega</button></div><p id="cj171-call-message"></p></section>`
}
function showCall(x){
  if(runtime.current===x.id&&$('#cj171-call'))return;
  runtime.current=x.id;ringStart();$('#cj171-call')?.remove();document.body.insertAdjacentHTML('beforeend',callHtml(x));
  $('#cj171-decline').onclick=async()=>{const message=$('#cj171-call-message');try{message.textContent='Recusando…';await req(`/api/app/driver/live/${x.id}/decline`,{method:'POST',body:{reason:'Recusada no aplicativo'}});ringStop();runtime.current=null;$('#cj171-call')?.remove();poll()}catch(error){message.textContent=error.message}};
  $('#cj171-accept').onclick=async()=>{const button=$('#cj171-accept'),message=$('#cj171-call-message');try{button.disabled=true;message.textContent='Aceitando…';await req(`/api/app/driver/live/${x.id}/accept`,{method:'POST',body:{}});ringStop();runtime.current=null;$('#cj171-call')?.remove();tone(1200,0,.25,.15);if(typeof navigate==='function')await navigate('routes',false);setTimeout(()=>window.ChegaJa144?.openInternalNavigation?.(),700)}catch(error){message.textContent=error.message;button.disabled=false}};
}
function hideCall(){ringStop();runtime.current=null;$('#cj171-call')?.remove()}
async function poll(){
  const isDriver=typeof state!=='undefined'&&state?.user?.role==='driver';if(!isDriver||!token()||document.hidden)return;
  try{const data=await req('/api/app/driver/live');ensureSingleDriverUi();if(data.call)showCall(data.call);else hideCall()}catch{}
}
function startDriver(){
  clearInterval(runtime.timer);runtime.timer=setInterval(poll,2500);poll();
  const observer=new MutationObserver(()=>ensureSingleDriverUi());observer.observe(document.documentElement,{childList:true,subtree:true});ensureSingleDriverUi()
}

function photoIcon(url,label='CJ'){
  return L.divIcon({className:'cj171-leaflet-icon',html:`<div>${url?`<img src="${esc(url)}" alt="">`:`<b>${esc(label).slice(0,2)}</b>`}</div><span></span>`,iconSize:[34,40],iconAnchor:[17,36]})
}
function stableMap(host,center=[-5.7945,-35.211],zoom=13){
  if(!window.L)throw new Error('Mapa não carregado.');
  try{if(host._leaflet_id){host._leaflet_id=null}}catch{}
  host.innerHTML='';const map=L.map(host,{zoomControl:true,attributionControl:true}).setView(center,zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  setTimeout(()=>map.invalidateSize(),80);return map
}

async function publicTracker(trackToken){
  clearInterval(runtime.trackTimer);
  $('#auth-screen')?.classList.add('hidden');$('#app-shell')?.classList.add('hidden');$('#customer-screen')?.classList.add('hidden');
  const screen=$('#tracking-screen');if(!screen)return;screen.classList.remove('hidden');
  screen.innerHTML=`<section class="cj171-track"><header><img src="/icons/icon-official.png"><div><small>ACOMPANHAMENTO</small><h1 id="cj171-track-code">Sua entrega</h1><span id="cj171-track-status">Carregando</span></div></header><div id="cj171-track-map"></div><section class="cj171-track-sheet"><div id="cj171-track-driver"></div><div class="cj171-track-addresses"><div><small>Coleta</small><strong id="cj171-pickup">—</strong></div><div><small>Entrega</small><strong id="cj171-delivery">—</strong></div></div><div id="cj171-confirmation"></div><div id="cj171-track-meta"></div><section id="cj171-chat"></section></section></section>`;
  const map=stableMap($('#cj171-track-map'));runtime.map=map;const layers=L.layerGroup().addTo(map);let driverMarker=null,first=true;
  const refresh=async()=>{
    try{
      const x=(await req(`/api/public/tracking/${encodeURIComponent(trackToken)}`,{auth:false})).item;
      $('#cj171-track-code').textContent=x.display_code||'Sua entrega';$('#cj171-track-status').textContent=x.status||'';$('#cj171-pickup').textContent=x.pickup_address||'—';$('#cj171-delivery').textContent=x.delivery_address||'—';
      $('#cj171-track-driver').innerHTML=`<span>${x.driver_photo_url?`<img src="${esc(x.driver_photo_url)}">`:'<b>CJ</b>'}</span><div><small>Cooperado</small><strong>${esc(x.driver_name||'Aguardando')}</strong><em>${esc([x.vehicle_model,x.vehicle_plate].filter(Boolean).join(' • '))}</em></div>`;
      $('#cj171-confirmation').innerHTML=x.confirmation_code?`<small>CÓDIGO PARA CONFIRMAR A ENTREGA</small><strong>${esc(x.confirmation_code)}</strong><span>Informe este código ao cooperado somente quando receber o pedido.</span>`:'';
      $('#cj171-track-meta').innerHTML=`<span><small>Distância</small><strong>${km(x.distance_meters)}</strong></span><span><small>Previsão</small><strong>${min(x.duration_seconds)}</strong></span><span><small>Atualizado</small><strong>${x.location_updated_at?new Date(x.location_updated_at).toLocaleTimeString('pt-BR'):'—'}</strong></span>`;
      layers.clearLayers();const pts=[];
      if(Number.isFinite(Number(x.pickup_lat))){pts.push([x.pickup_lat,x.pickup_lng]);L.marker([x.pickup_lat,x.pickup_lng]).addTo(layers).bindPopup('Coleta')}
      if(Number.isFinite(Number(x.delivery_lat))){pts.push([x.delivery_lat,x.delivery_lng]);L.marker([x.delivery_lat,x.delivery_lng]).addTo(layers).bindPopup('Entrega')}
      let geometry=[];try{geometry=JSON.parse(x.route_geometry||'[]')}catch{}if(Array.isArray(geometry)&&geometry.length){L.polyline(geometry.map(p=>[Number(p[0]),Number(p[1])]),{weight:6}).addTo(layers)}
      if(Number.isFinite(Number(x.driver_lat))){const pos=[Number(x.driver_lat),Number(x.driver_lng)];pts.push(pos);if(!driverMarker){driverMarker=L.marker(pos,{icon:photoIcon(x.driver_photo_url,'CJ')}).addTo(map).bindPopup(esc(x.driver_name||'Cooperado'))}else driverMarker.setLatLng(pos)}
      if(first&&pts.length){map.fitBounds(pts,{padding:[35,35],maxZoom:16});first=false}setTimeout(()=>map.invalidateSize(),20);
      renderChat(trackToken,x)
    }catch(error){$('#cj171-track-meta').innerHTML=`<p>${esc(error.message)}</p>`}
  };
  await refresh();runtime.trackTimer=setInterval(()=>{if(!document.hidden)refresh()},6000)
}
async function renderChat(trackToken,x){
  const host=$('#cj171-chat');if(!host||host.dataset.busy==='1')return;
  if(!x.customer_chat_enabled){host.innerHTML='';return}host.dataset.busy='1';
  try{
    const data=await req(`/api/public/tracking/${encodeURIComponent(trackToken)}/messages?conversation=customer_driver`,{auth:false});
    host.innerHTML=`<header><strong>Conversar sobre a entrega</strong></header><div class="cj171-chat-messages">${(data.items||[]).map(m=>`<div class="${m.sender_type==='customer'?'mine':''}"><small>${esc(m.sender_name)}</small><p>${esc(m.message)}</p></div>`).join('')||'<p>Nenhuma mensagem.</p>'}</div>${data.active?`<form id="cj171-chat-form"><input name="message" maxlength="500" placeholder="Digite uma mensagem" required><button>Enviar</button></form>`:''}`;
    $('#cj171-chat-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{await req(`/api/public/tracking/${encodeURIComponent(trackToken)}/messages`,{auth:false,method:'POST',body:{conversation:'customer_driver',message:form.message.value}});form.reset();delete host.dataset.busy;renderChat(trackToken,x)}catch(error){alert(error.message);button.disabled=false}})
  }catch{host.innerHTML=''}finally{delete host.dataset.busy}
}

function forceCustomer(){
  const params=new URLSearchParams(location.search);
  if(location.pathname==='/cliente'||params.has('cliente'))setTimeout(()=>window.chegajaOpenCustomer?.(params.get('mode')||'hub'),120)
}
function boot(){
  startDriver();forceCustomer();
  const track=location.pathname.match(/^\/r\/([^/]+)/)?.[1];if(track){window.publicTracking=publicTracker;setTimeout(()=>publicTracker(track),80)}
}
window.addEventListener('load',boot,{once:true});document.readyState==='complete'&&boot();
})();
