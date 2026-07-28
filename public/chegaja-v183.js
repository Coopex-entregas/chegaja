/* ChegaJá 14.18.3 — tema único, rastreamento público e painel do cooperado */
(()=>{
'use strict';
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0)/100);
const statusNames={new:'Solicitada',offered:'Buscando cooperado',assigned:'Aguardando aceite',accepted:'Aceita',to_pickup:'Indo para coleta',at_pickup:'Na coleta',picked_up:'Pedido coletado',in_route:'Em rota',problem:'Atenção necessária',delivered:'Entregue',cancelled:'Cancelada'};
const activeStatuses=new Set(['new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem']);
const runtime={theme:null,driverTimer:null,driverBusy:false,audio:null,ringTimer:null,ringDelivery:null,trackingTimer:null,trackingBusy:false,trackingMap:null,trackingToken:null,photoTimer:null,photoSignature:'',toastWrapped:false};

function appState(){return typeof state!=='undefined'?state:null}
function token(){return localStorage.getItem('lg_token')||''}
async function request(url,options={}){
  const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  if(options.auth!==false&&token())headers.Authorization=`Bearer ${token()}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeout||7000);
  try{
    const response=await fetch(url,{method:options.method||'GET',headers,body:options.body?JSON.stringify(options.body):undefined,cache:'no-store',signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
    return data;
  }finally{clearTimeout(timer)}
}
function normalizeHex(value){
  let color=String(value||'').trim();
  if(/^#[0-9a-f]{3}$/i.test(color))color='#'+[...color.slice(1)].map(x=>x+x).join('');
  if(!/^#[0-9a-f]{6}$/i.test(color))return'#0D257A';
  const upper=color.toUpperCase();
  return ['#721536','#6B1238','#800020'].includes(upper)?'#0D257A':upper;
}
function shade(hex,amount){
  const value=normalizeHex(hex).slice(1),rgb=[0,2,4].map(i=>parseInt(value.slice(i,i+2),16));
  const target=amount<0?0:255,p=Math.abs(amount);
  return '#'+rgb.map(c=>Math.round(c+(target-c)*p).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function themeValues(primary){
  const color=normalizeHex(primary),isDefault=color==='#0D257A';
  return{primary:color,dark:shade(color,-.24),soft:shade(color,.88),accent:isDefault?'#F97316':color,accentSoft:isDefault?'#FFF0E5':shade(color,.88)};
}
function applyTheme(primary){
  const theme=themeValues(primary);runtime.theme=theme;
  const root=document.documentElement;
  root.style.setProperty('--cj-brand',theme.primary);
  root.style.setProperty('--cj-brand-dark',theme.dark);
  root.style.setProperty('--cj-brand-soft',theme.soft);
  root.style.setProperty('--cj-accent',theme.accent);
  root.style.setProperty('--cj-accent-soft',theme.accentSoft);
  root.style.setProperty('--customer-color',theme.primary);
  root.dataset.cjTheme=theme.primary;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme.primary);
  return theme;
}
function cooperativeId(){
  const stateNow=appState(),params=new URLSearchParams(location.search);
  return String(params.get('coop')||params.get('cooperative_id')||localStorage.getItem('chegaja_customer_cooperative')||stateNow?.user?.cooperative_id||stateNow?.user?.cooperativeId||'').trim();
}
async function loadTheme(fallback){
  let primary=fallback||'';const id=cooperativeId();
  if(id)try{primary=(await request(`/api/public/branding/${encodeURIComponent(id)}`,{auth:false,timeout:5000})).item?.primary_color||primary}catch{}
  return applyTheme(primary||'#0D257A');
}

async function unlockAudio(){
  try{
    if(!runtime.audio)runtime.audio=new(window.AudioContext||window.webkitAudioContext)();
    if(runtime.audio.state==='suspended')await runtime.audio.resume();
    const oscillator=runtime.audio.createOscillator(),gain=runtime.audio.createGain();gain.gain.value=.0001;oscillator.connect(gain).connect(runtime.audio.destination);oscillator.start();oscillator.stop(runtime.audio.currentTime+.02);
    localStorage.setItem('cj_audio_armed','1');
  }catch{}
}
function tone(frequency,start,duration=.2){
  if(!runtime.audio||runtime.audio.state!=='running')return;
  const oscillator=runtime.audio.createOscillator(),gain=runtime.audio.createGain();oscillator.type='square';oscillator.frequency.value=frequency;
  gain.gain.setValueAtTime(.0001,runtime.audio.currentTime+start);gain.gain.exponentialRampToValueAtTime(.24,runtime.audio.currentTime+start+.015);gain.gain.exponentialRampToValueAtTime(.0001,runtime.audio.currentTime+start+duration);
  oscillator.connect(gain).connect(runtime.audio.destination);oscillator.start(runtime.audio.currentTime+start);oscillator.stop(runtime.audio.currentTime+start+duration+.03);
}
function playAlert(){unlockAudio().then(()=>{tone(720,0,.2);tone(930,.24,.22);tone(1180,.52,.25)});navigator.vibrate?.([450,130,450,130,650])}
function startAlert(deliveryId){
  if(runtime.ringDelivery===deliveryId&&runtime.ringTimer)return;
  stopAlert();runtime.ringDelivery=deliveryId;playAlert();runtime.ringTimer=setInterval(playAlert,1050);
}
function stopAlert(){if(runtime.ringTimer)clearInterval(runtime.ringTimer);runtime.ringTimer=null;runtime.ringDelivery=null;navigator.vibrate?.(0)}
document.addEventListener('pointerdown',unlockAudio,{capture:true});

function isDriver(){return appState()?.user?.role==='driver'}
function drawer(){return $('#cj143-driver-drawer')||$('#v32-driver-drawer')||$('#sidebar')}
function openDriverMenu(){const menu=drawer();if(menu)menu.classList.add('open');else if(typeof navigate==='function')navigate('profile')}
function ensureDriverNav(){
  if(!isDriver())return;
  let nav=$('#cj180-driver-nav');if(!nav){nav=document.createElement('nav');nav.id='cj180-driver-nav';document.body.appendChild(nav)}
  if(nav.dataset.cj183!=='1'){
    nav.dataset.cj183='1';nav.innerHTML=`<button data-go="dashboard"><i>⌂</i><span>Início</span></button><button data-go="deliveries"><i>▣</i><span>Entregas</span></button><button data-go="schedules"><i>▦</i><span>Escala</span></button><button data-go="financial"><i>R$</i><span>Ganhos</span></button><button data-menu><i>☰</i><span>Menu</span></button>`;
    nav.querySelectorAll('[data-go]').forEach(button=>button.onclick=()=>typeof navigate==='function'&&navigate(button.dataset.go));nav.querySelector('[data-menu]').onclick=openDriverMenu;
  }
  nav.querySelectorAll('[data-go]').forEach(button=>button.classList.toggle('active',button.dataset.go===appState()?.page));
}
function ensureDriverTop(){
  if(!isDriver()||appState()?.page!=='dashboard'){ $('#cj183-driver-top')?.remove();return }
  let top=$('#cj183-driver-top');
  if(!top){
    top=document.createElement('section');top.id='cj183-driver-top';top.innerHTML=`<div class="earnings"><small>GANHOS HOJE</small><strong id="cj183-earnings">R$ 0,00</strong><span id="cj183-count">0 entregas</span></div><button id="cj183-online"><i></i><span>Offline</span></button>`;document.body.appendChild(top);
    $('#cj183-online').onclick=toggleOnline;
  }
}
async function position(){return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:15000}):reject(new Error('GPS indisponível.')))}
async function toggleOnline(){
  const stateNow=appState(),turningOn=!Boolean(stateNow?.online);const button=$('#cj183-online');if(button?.disabled)return;
  if(button)button.disabled=true;await unlockAudio();
  try{
    let body={online:turningOn};if(turningOn){const current=await position();body={online:true,latitude:current.coords.latitude,longitude:current.coords.longitude,accuracy:current.coords.accuracy}}
    await request('/api/app/v6/driver/online',{method:'POST',body});if(stateNow)stateNow.online=turningOn;
    if(turningOn&&typeof startLocation==='function')startLocation();if(!turningOn&&typeof stopLocation==='function')stopLocation();
    await pollDriver();
  }catch(error){if(typeof toast==='function')toast(error.message,'error');else alert(error.message)}finally{if(button?.isConnected)button.disabled=false}
}
function updateDriverTop(live){
  ensureDriverTop();const button=$('#cj183-online'),online=Boolean(live?.driver?.online);if(appState())appState().online=online;
  if(button){button.classList.toggle('online',online);button.querySelector('span').textContent=online?'Online':'Ficar online'}
  const summary=live?.summary||{};const earnings=$('#cj183-earnings'),count=$('#cj183-count');if(earnings)earnings.textContent=money(summary.earnings_today_cents||0);if(count){const total=Number(summary.deliveries_today||0);count.textContent=`${total} entrega${total===1?'':'s'}`}
  const oldToday=$('#cj180-today');if(oldToday)oldToday.classList.add('cj183-hidden-today');
}
function wrapToasts(){
  if(runtime.toastWrapped||typeof toast!=='function')return;runtime.toastWrapped=true;
  try{const original=toast;toast=function(message,type,...rest){const text=String(message||'').toLowerCase();if(type!=='error'&&(text.includes('você está online')||text==='online'||text.includes('status online')))return;return original(message,type,...rest)}}catch{}
}
function cleanOnlineMessages(){
  $$('.toast,.notification-toast,.notice-toast').forEach(node=>{const text=node.textContent.toLowerCase();if(text.includes('você está online')||text.trim()==='online')node.remove()});
}
async function pollDriver(){
  if(!isDriver()||!token()||document.hidden||runtime.driverBusy)return;runtime.driverBusy=true;
  try{
    const live=await request('/api/app/driver/live',{timeout:5000});updateDriverTop(live);ensureDriverNav();
    if(live.call)startAlert(live.call.id);else stopAlert();
  }catch{}finally{runtime.driverBusy=false}
}
function installDriver(){
  if(!isDriver()){clearInterval(runtime.driverTimer);runtime.driverTimer=null;stopAlert();$('#cj183-driver-top')?.remove();return}
  ensureDriverNav();ensureDriverTop();wrapToasts();clearInterval(runtime.driverTimer);runtime.driverTimer=setInterval(pollDriver,1000);pollDriver();
}

async function syncPhotos(){
  const stateNow=appState();if(!stateNow||!['cooperative_admin','dispatcher','establishment'].includes(stateNow.user?.role))return;
  try{
    const data=await request('/api/app/map/drivers',{timeout:6000}),byName={},byId={};for(const item of data.items||[]){if(item.photo_url){byName[String(item.name||'')]=String(item.photo_url);byId[String(item.id||'')]=String(item.photo_url)}}
    const signature=JSON.stringify(byId);window.ChegaJaDriverPhotosByName=byName;window.ChegaJaDriverPhotosById=byId;
    if(signature!==runtime.photoSignature){runtime.photoSignature=signature;if(stateNow.page==='bases')window.ChegaJaV31?.loadBaseDashboard?.(false);if(stateNow.role==='establishment'||stateNow.user?.role==='establishment')window.ChegaJaV36?.loadEstablishment?.(false)}
  }catch{}
}

function trackingToken(){return location.pathname.match(/^\/r\/([^/]+)/)?.[1]||''}
function trackingTheme(item){return loadTheme(item?.primary_color||'#0D257A')}
function markerPoints(item){const points=[];const add=(lat,lng,opt)=>{lat=Number(lat);lng=Number(lng);if(Number.isFinite(lat)&&Number.isFinite(lng))points.push({point:[lat,lng],opt})};add(item.pickup_lat,item.pickup_lng,{label:'C',color:'var(--cj-brand)'});add(item.delivery_lat,item.delivery_lng,{label:'E',color:'#16A34A'});if(item.driver_lat!=null)add(item.driver_lat,item.driver_lng,{label:'CJ',photo:item.driver_photo_url,title:item.driver_name});return points}
async function drawTrackingMap(item){
  const host=$('#cj183-track-map');if(!host||!window.ChegaJaMaps?.createMap)return;
  try{
    if(!runtime.trackingMap)runtime.trackingMap=await window.ChegaJaMaps.createMap(host,{center:[Number(item.pickup_lat)||-5.7945,Number(item.pickup_lng)||-35.211],zoom:13});
    runtime.trackingMap.clearGroup('track');runtime.trackingMap.clearGroup('route');const points=markerPoints(item);
    points.forEach(entry=>runtime.trackingMap.addMarker(entry.point,{group:'track',...entry.opt,color:entry.opt.color==='var(--cj-brand)'?(runtime.theme?.primary||'#0D257A'):entry.opt.color}));
    if(item.route_geometry)runtime.trackingMap.addGeoJSON(item.route_geometry,{group:'route',color:runtime.theme?.primary||'#0D257A',weight:7,opacity:.9});if(points.length)runtime.trackingMap.fitBounds(points.map(x=>x.point),{padding:45,maxZoom:16});runtime.trackingMap.invalidateSize?.();
  }catch(error){host.innerHTML=`<div class="cj183-map-error"><strong>Google Maps não carregou</strong><span>${esc(error.message)}</span></div>`}
}
function driverInfo(item){return `<div class="cj183-track-driver"><span>${item.driver_photo_url?`<img src="${esc(item.driver_photo_url)}" alt="Foto do cooperado">`:'<b>CJ</b>'}</span><div><small>SEU COOPERADO</small><strong>${esc(item.driver_name||'Aguardando cooperado')}</strong><em>${esc([item.vehicle_model,item.vehicle_plate].filter(Boolean).join(' • '))}</em></div></div>`}
function routeInfo(item){return `<div class="cj183-track-route"><div><i>C</i><span><small>COLETA</small><strong>${esc(item.pickup_address||'—')}</strong></span></div><em></em><div><i>E</i><span><small>ENTREGA</small><strong>${esc(item.delivery_address||'—')}</strong></span></div></div>`}
async function trackingChat(item){
  const host=$('#cj183-track-chat');if(!host||!item.customer_chat_enabled||!activeStatuses.has(item.status)){if(host)host.innerHTML='';return}
  const conversation=item.driver_name?'customer_driver':'customer_place';
  try{
    const data=await request(`/api/public/tracking/${encodeURIComponent(runtime.trackingToken)}/messages?conversation=${encodeURIComponent(conversation)}`,{auth:false});
    host.innerHTML=`<header><strong>Conversa da entrega</strong><span>${conversation==='customer_driver'?'Cooperado':'Base / estabelecimento'}</span></header><div class="messages">${(data.items||[]).map(message=>`<div class="${message.sender_type==='customer'?'mine':''}"><small>${esc(message.sender_name||message.sender_type)}</small><p>${esc(message.message)}</p></div>`).join('')||'<p class="empty">Envie uma mensagem para iniciar.</p>'}</div>${data.active?`<form id="cj183-chat-form"><input name="message" maxlength="500" required placeholder="Digite uma mensagem"><button>Enviar</button></form>`:''}`;
    const form=$('#cj183-chat-form');if(form)form.onsubmit=async event=>{event.preventDefault();const text=form.message.value.trim();if(!text)return;const button=form.querySelector('button');button.disabled=true;try{await request(`/api/public/tracking/${encodeURIComponent(runtime.trackingToken)}/messages`,{auth:false,method:'POST',body:{conversation,message:text}});form.reset();await trackingChat(item)}catch(error){alert(error.message);button.disabled=false}};
  }catch{host.innerHTML=''}
}
function starButtons(){return[1,2,3,4,5].map(value=>`<button type="button" data-score="${value}" class="selected">★</button>`).join('')}
function bindRating(token){
  const form=$('#cj183-rating-form');if(!form)return;let score=5;form.querySelectorAll('[data-score]').forEach(button=>button.onclick=()=>{score=Number(button.dataset.score);form.querySelectorAll('[data-score]').forEach(star=>star.classList.toggle('selected',Number(star.dataset.score)<=score))});
  form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent='Enviando…';try{await request(`/api/public/tracking/${encodeURIComponent(token)}/rating`,{auth:false,method:'POST',body:{driver_score:score,establishment_score:5,comment:form.comment.value}});form.outerHTML='<div class="cj183-rating-success"><strong>✓ Avaliação enviada</strong><span>Obrigado por avaliar o cooperado.</span></div>'}catch(error){alert(error.message);submit.disabled=false;submit.textContent='Enviar avaliação'}};
}
function renderEnded(item){
  runtime.trackingMap?.remove?.();runtime.trackingMap=null;clearInterval(runtime.trackingTimer);runtime.trackingTimer=null;
  const cancelled=item.status==='cancelled';$('#tracking-screen').innerHTML=`<main class="cj183-ended"><section><img src="/icons/logo-official.png" alt="ChegaJá"><div class="done ${cancelled?'cancelled':''}">${cancelled?'×':'✓'}</div><small>${esc(item.display_code||'ENTREGA')}</small><h1>${cancelled?'Corrida cancelada':'Corrida encerrada'}</h1><p>${cancelled?'Esta solicitação foi cancelada.':'O recebimento foi confirmado e a entrega foi concluída.'}</p>${!cancelled&&item.rating_available?`<form id="cj183-rating-form" class="cj183-rating"><h2>Avalie o cooperado</h2><p>Dê uma nota e escreva um comentário sobre o atendimento.</p><div class="stars">${starButtons()}</div><textarea name="comment" maxlength="1000" placeholder="Escreva seu comentário (opcional)"></textarea><button type="submit">Enviar avaliação</button></form>`:!cancelled&&item.rated?'<div class="cj183-rating-success"><strong>✓ Avaliação já enviada</strong></div>':''}<a href="/">Voltar ao início</a></section></main>`;bindRating(runtime.trackingToken);
}
async function renderTracking(force=false){
  const tokenValue=trackingToken();if(!tokenValue||runtime.trackingBusy)return;runtime.trackingBusy=true;runtime.trackingToken=tokenValue;
  try{
    const item=(await request(`/api/public/tracking/${encodeURIComponent(tokenValue)}`,{auth:false,timeout:6500})).item;await trackingTheme(item);
    $('#auth-screen')?.classList.add('hidden');$('#app-shell')?.classList.add('hidden');$('#customer-screen')?.classList.add('hidden');const screen=$('#tracking-screen');screen.classList.remove('hidden');
    if(['delivered','cancelled'].includes(item.status)){renderEnded(item);return}
    if(force||!$('.cj183-track',screen))screen.innerHTML=`<main class="cj183-track"><header><img src="/icons/logo-official.png" alt="ChegaJá"><div><small>ACOMPANHAMENTO</small><h1 id="cj183-track-code"></h1><span id="cj183-track-status"></span></div></header><section id="cj183-track-map"></section><section class="sheet"><div id="cj183-track-driver"></div><div id="cj183-track-route"></div><div id="cj183-track-confirm"></div><div id="cj183-track-actions"></div><div id="cj183-track-meta"></div><section id="cj183-track-chat"></section></section></main>`;
    $('#cj183-track-code').textContent=item.display_code||'Entrega';$('#cj183-track-status').textContent=statusNames[item.status]||item.status;$('#cj183-track-driver').innerHTML=driverInfo(item);$('#cj183-track-route').innerHTML=routeInfo(item);
    $('#cj183-track-confirm').innerHTML=item.confirmation_code?`<div class="confirmation"><small>CÓDIGO PARA CONFIRMAR</small><strong>${esc(item.confirmation_code)}</strong><span>Informe somente quando o pedido estiver em suas mãos.</span></div>`:'';
    const canReceive=!['new','offered','assigned'].includes(item.status);$('#cj183-track-actions').innerHTML=canReceive?'<button id="cj183-received">Confirmar que recebi</button><small>Ao confirmar, a corrida será encerrada.</small>':'';
    const received=$('#cj183-received');if(received)received.onclick=async()=>{if(!confirm('Confirmar que você recebeu a entrega?'))return;received.disabled=true;try{await request(`/api/public/tracking/${encodeURIComponent(tokenValue)}/received`,{auth:false,method:'POST',body:{}});await renderTracking(true)}catch(error){alert(error.message);received.disabled=false}};
    $('#cj183-track-meta').innerHTML=`<span><small>Distância</small><strong>${(Number(item.distance_meters||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} km</strong></span><span><small>Previsão</small><strong>${Math.max(1,Math.round(Number(item.duration_seconds||0)/60))} min</strong></span><span><small>Atualizado</small><strong>${item.location_updated_at?new Date(item.location_updated_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—'}</strong></span>`;
    await drawTrackingMap(item);await trackingChat(item);
  }catch(error){const screen=$('#tracking-screen');screen?.classList.remove('hidden');if(screen)screen.innerHTML=`<div class="cj183-map-error full"><strong>Não foi possível abrir o acompanhamento</strong><span>${esc(error.message)}</span></div>`}finally{runtime.trackingBusy=false}
}
function installTracking(){
  const tokenValue=trackingToken();if(!tokenValue)return;window.publicTracking=()=>renderTracking(true);clearInterval(runtime.trackingTimer);renderTracking(true);runtime.trackingTimer=setInterval(()=>{if(!document.hidden)renderTracking(false)},4000);
}

function themeVisiblePanels(){
  const customer=$('.v32-client-app,.v32-client-access');if(customer)loadTheme();
  if(isDriver())loadTheme();
}
function apply(){
  themeVisiblePanels();installDriver();cleanOnlineMessages();
  if(!runtime.photoTimer){syncPhotos();runtime.photoTimer=setInterval(()=>{if(!document.hidden)syncPhotos()},5000)}
}
const observer=new MutationObserver(()=>requestAnimationFrame(apply));observer.observe(document.documentElement,{childList:true,subtree:true});
function boot(){applyTheme('#0D257A');installTracking();apply()}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();
