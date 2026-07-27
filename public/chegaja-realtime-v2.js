/* ChegaJá 14.17.0 — mapas estáveis, frota com foto e cliente estilo aplicativo */
(()=>{
'use strict';

const byId=id=>document.getElementById(id);
const core=()=>typeof state!=='undefined'?state:null;
const pageApi=()=>typeof api==='function'?api:null;
const safe=value=>String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const money=cents=>`R$ ${(Number(cents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const km=meters=>`${(Number(meters||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} km`;
const mins=seconds=>`${Math.max(1,Math.round(Number(seconds||0)/60))} min`;
const runtime={google:null,publicTimer:null,fleetTimer:null,driverTimer:null,sosTimer:null,activeMap:null,customer:null};

function token(){
  const s=core();
  return s?.token||localStorage.getItem('lg_token')||'';
}
async function request(url,opt={}){
  if(pageApi()&&opt.useCore!==false){
    try{return await pageApi()(url,{method:opt.method||'GET',body:opt.body,headers:opt.headers})}
    catch(error){if(!opt.fallback)throw error}
  }
  const headers={...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})};
  if(opt.auth!==false&&token())headers.Authorization=`Bearer ${token()}`;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Number(opt.timeout||9000));
  try{
    const response=await fetch(url,{method:opt.method||'GET',headers,body:opt.body?JSON.stringify(opt.body):undefined,signal:controller.signal,cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
    return data;
  }finally{clearTimeout(timer)}
}
function stopTimer(name){if(runtime[name])clearInterval(runtime[name]);runtime[name]=null}
function stopLive(){
  stopTimer('publicTimer');stopTimer('fleetTimer');stopTimer('driverTimer');
  try{runtime.activeMap?.remove?.()}catch{}
  runtime.activeMap=null;
}
function point(value){
  if(Array.isArray(value))return{lat:Number(value[0]),lng:Number(value[1])};
  return{lat:Number(value?.lat??value?.latitude),lng:Number(value?.lng??value?.longitude)};
}
function valid(p){return Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180}
function pinSvg(color,label=''){
  const text=safe(label).slice(0,2);
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="54" viewBox="0 0 44 54"><path fill="${color}" stroke="white" stroke-width="3" d="M22 1C10.4 1 1 10.4 1 22c0 15.7 21 31 21 31s21-15.3 21-31C43 10.4 33.6 1 22 1z"/><circle cx="22" cy="21" r="11" fill="white"/><text x="22" y="25" text-anchor="middle" font-family="Arial" font-size="10" font-weight="700" fill="${color}">${text}</text></svg>`)}`;
}
function leafletPhoto(url,label='CJ'){
  return `<div class="cj17-photo-pin">${url?`<img src="${safe(url)}" alt="Foto do cooperado" onerror="this.remove()">`:`<b>${safe(label).slice(0,2)}</b>`}<span></span></div>`;
}
async function mapsConfig(publicMode=false){
  try{return (await request(publicMode?'/api/public/maps-config':'/api/auth/maps-config',{auth:!publicMode,useCore:false,timeout:6000})).item||{}}
  catch{return{provider:'openstreetmap',enabled:false}}
}
async function loadGoogle(key){
  if(window.google?.maps)return;
  if(runtime.google)return runtime.google;
  runtime.google=new Promise((resolve,reject)=>{
    const callback=`__cj17gm${Date.now()}`;
    const timeout=setTimeout(()=>{delete window[callback];runtime.google=null;reject(new Error('Tempo esgotado ao carregar o Google Maps.'))},9000);
    window[callback]=()=>{clearTimeout(timeout);delete window[callback];resolve()};
    const script=document.createElement('script');
    script.async=true;script.defer=true;
    script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=pt-BR&region=BR&callback=${callback}`;
    script.onerror=()=>{clearTimeout(timeout);delete window[callback];runtime.google=null;reject(new Error('Google Maps indisponível.'))};
    document.head.appendChild(script);
  });
  return runtime.google;
}
function googleAdapter(host,options={}){
  host.innerHTML='';
  const center=valid(point(options.center))?point(options.center):{lat:-5.7945,lng:-35.211};
  const map=new google.maps.Map(host,{center,zoom:Number(options.zoom||13),mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'greedy',clickableIcons:true});
  const groups=new Map();
  const put=(group,item)=>{const list=groups.get(group)||[];list.push(item);groups.set(group,list);return item};
  const marker=(raw,group)=>{
    const wrapper={
      raw,
      setLatLng(value){const p=point(value);if(valid(p))raw.setPosition(p);return wrapper},
      getLatLng(){const p=raw.getPosition();return{lat:p.lat(),lng:p.lng()}},
      bindPopup(html){const info=new google.maps.InfoWindow({content:String(html||'')});raw.addListener('click',()=>info.open({map,anchor:raw}));return wrapper},
      remove(){raw.setMap(null)}
    };
    put(group,wrapper);return wrapper;
  };
  const adapter={
    provider:'google',
    addMarker(value,opt={}){
      const p=point(value);if(!valid(p))return marker(new google.maps.Marker({map:null}),opt.group||'default');
      const icon=opt.photo?{url:opt.photo,scaledSize:new google.maps.Size(46,46),anchor:new google.maps.Point(23,23)}:{url:pinSvg(opt.color||'#0d45d8',opt.label||''),scaledSize:new google.maps.Size(44,54),anchor:new google.maps.Point(22,52)};
      const raw=new google.maps.Marker({map,position:p,title:opt.title||'',icon,zIndex:opt.photo?1000:100});
      const wrapped=marker(raw,opt.group||'default');if(opt.popup)wrapped.bindPopup(opt.popup);return wrapped
    },
    addCircleMarker(value,opt={}){return adapter.addMarker(value,opt)},
    addPolyline(values,opt={}){
      const path=(values||[]).map(point).filter(valid);
      const raw=new google.maps.Polyline({map,path,strokeColor:opt.color||'#0d45d8',strokeWeight:Number(opt.weight||6),strokeOpacity:Number(opt.opacity??.9)});
      const wrapper={raw,remove(){raw.setMap(null)}};put(opt.group||'default',wrapper);return wrapper
    },
    clearGroup(group){for(const item of groups.get(group)||[])item.remove?.();groups.delete(group)},
    setView(value,zoom){const p=point(value);if(valid(p))map.setCenter(p);if(zoom)map.setZoom(Number(zoom))},
    panTo(value){const p=point(value);if(valid(p))map.panTo(p)},
    fitBounds(values,opt={}){
      const pts=(values||[]).map(point).filter(valid);if(!pts.length)return;
      const bounds=new google.maps.LatLngBounds();pts.forEach(p=>bounds.extend(p));map.fitBounds(bounds,Number(opt.padding?.[0]||45));
      google.maps.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>Number(opt.maxZoom||17))map.setZoom(Number(opt.maxZoom||17))})
    },
    on(event,fn){return google.maps.event.addListener(map,event,fn)},
    invalidateSize(){google.maps.event.trigger(map,'resize')},
    resize(){google.maps.event.trigger(map,'resize')},
    remove(){for(const group of [...groups.keys()])adapter.clearGroup(group);host.innerHTML=''}
  };
  return adapter
}
function leafletAdapter(host,options={}){
  if(!window.L)throw new Error('Mapa alternativo não carregou.');
  try{if(host._leaflet_id)host._leaflet_id=null}catch{}
  host.innerHTML='';
  const center=valid(point(options.center))?point(options.center):{lat:-5.7945,lng:-35.211};
  const map=L.map(host,{zoomControl:options.zoomControl!==false,attributionControl:options.attributionControl!==false}).setView([center.lat,center.lng],Number(options.zoom||13));
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  const groups=new Map();
  const put=(group,item)=>{const list=groups.get(group)||[];list.push(item);groups.set(group,list);return item};
  const adapter={
    provider:'openstreetmap',
    addMarker(value,opt={}){
      const p=point(value);if(!valid(p))return null;
      let icon;
      if(opt.photo||opt.isDriver)icon=L.divIcon({className:'cj17-leaflet-photo',html:leafletPhoto(opt.photo,opt.label||'CJ'),iconSize:[48,55],iconAnchor:[24,48]});
      else icon=L.icon({iconUrl:pinSvg(opt.color||'#0d45d8',opt.label||''),iconSize:[44,54],iconAnchor:[22,52]});
      const marker=L.marker([p.lat,p.lng],{icon,title:opt.title||''}).addTo(map);if(opt.popup)marker.bindPopup(opt.popup);return put(opt.group||'default',marker)
    },
    addCircleMarker(value,opt={}){return adapter.addMarker(value,opt)},
    addPolyline(values,opt={}){
      const pts=(values||[]).map(point).filter(valid).map(p=>[p.lat,p.lng]);
      if(!pts.length)return null;return put(opt.group||'default',L.polyline(pts,{color:opt.color||'#0d45d8',weight:Number(opt.weight||6),opacity:Number(opt.opacity??.9)}).addTo(map))
    },
    clearGroup(group){for(const item of groups.get(group)||[])try{map.removeLayer(item)}catch{}groups.delete(group)},
    setView(value,zoom){const p=point(value);if(valid(p))map.setView([p.lat,p.lng],Number(zoom||map.getZoom()))},
    panTo(value,opt){const p=point(value);if(valid(p))map.panTo([p.lat,p.lng],opt)},
    fitBounds(values,opt={}){
      const pts=(values||[]).map(point).filter(valid).map(p=>[p.lat,p.lng]);if(pts.length)map.fitBounds(pts,{padding:opt.padding||[45,45],maxZoom:Number(opt.maxZoom||17)})
    },
    on(event,fn){map.on(event,fn)},
    invalidateSize(){setTimeout(()=>map.invalidateSize(),40)},
    resize(){setTimeout(()=>map.invalidateSize(),40)},
    remove(){try{map.remove()}catch{}}
  };
  return adapter
}
async function createMap(hostOrId,options={}){
  const host=typeof hostOrId==='string'?byId(hostOrId):hostOrId;
  if(!host)throw new Error('Área do mapa não encontrada.');
  host.classList.add('cj17-map-host');host.innerHTML='<div class="cj17-map-loading">Carregando mapa…</div>';
  const config=await mapsConfig(Boolean(options.public));
  if(config.provider==='google'&&config.enabled&&config.api_key){
    try{await loadGoogle(config.api_key);return googleAdapter(host,options)}
    catch(error){console.warn('Google Maps falhou; usando mapa alternativo.',error)}
  }
  return leafletAdapter(host,options)
}
window.ChegaJaMaps={createMap};

function profilePhoto(driver){return driver?.photo_url||''}
function fleetCard(driver){
  const online=Number(driver.online)===1;
  return `<button type="button" class="cj17-driver-row" data-driver="${safe(driver.id)}"><span class="cj17-driver-avatar">${driver.photo_url?`<img src="${safe(driver.photo_url)}" alt="">`:`<b>${safe(String(driver.name||'CJ').split(/\s+/).slice(0,2).map(x=>x[0]).join(''))}</b>`}</span><span><strong>${safe(driver.name||'Cooperado')}</strong><small>${safe([driver.vehicle_model,driver.vehicle_plate].filter(Boolean).join(' • ')||'Moto não informada')}</small></span><em class="${online?'online':''}">${online?'Online':'Offline'}</em></button>`
}
async function fleetData(){
  const s=core();const params=new URLSearchParams();
  if(s?.user?.role==='platform_admin'&&s.selectedCoop)params.set('cooperative_id',s.selectedCoop);
  return (await request(`/api/app/map/drivers${params.size?`?${params}`:''}`,{useCore:false})).items||[]
}
async function renderFleetPage(){
  stopLive();
  const content=byId('page-content');if(!content)return;
  content.innerHTML=`<section class="cj17-live-page"><header><div><p class="eyebrow">ACOMPANHAMENTO EM TEMPO REAL</p><h2>Cooperados no mapa</h2><p>As fotos e posições são atualizadas sem recarregar a tela.</p></div><button type="button" class="btn" id="cj17-fleet-refresh">Atualizar</button></header><div class="cj17-live-layout"><div id="cj17-fleet-map" class="cj17-main-map"></div><aside><div id="cj17-fleet-count"></div><div id="cj17-fleet-list"></div></aside></div></section>`;
  const map=await createMap('cj17-fleet-map',{zoom:12});runtime.activeMap=map;
  let first=true,busy=false;
  const refresh=async()=>{
    if(busy||core()?.page!=='tracking')return;busy=true;
    try{
      const items=await fleetData();map.clearGroup('drivers');
      const points=[];
      for(const d of items){
        const p={lat:Number(d.current_lat),lng:Number(d.current_lng)};if(!valid(p))continue;points.push(p);
        const popup=`<div class="cj17-map-popup">${d.photo_url?`<img src="${safe(d.photo_url)}" alt="">`:''}<strong>${safe(d.name)}</strong><small>${safe([d.vehicle_model,d.vehicle_plate].filter(Boolean).join(' • '))}</small></div>`;
        map.addMarker(p,{group:'drivers',photo:profilePhoto(d),isDriver:true,label:'CJ',title:d.name,popup});
      }
      byId('cj17-fleet-count').innerHTML=`<strong>${items.filter(d=>Number(d.online)===1).length}</strong><span>online de ${items.length} com localização</span>`;
      byId('cj17-fleet-list').innerHTML=items.map(fleetCard).join('')||'<div class="cj17-empty">Nenhum cooperado enviando localização.</div>';
      document.querySelectorAll('[data-driver]').forEach(button=>button.onclick=()=>{const d=items.find(x=>String(x.id)===String(button.dataset.driver));const p={lat:Number(d?.current_lat),lng:Number(d?.current_lng)};if(valid(p))map.setView(p,17)});
      if(first&&points.length){map.fitBounds(points,{maxZoom:16});first=false}map.invalidateSize()
    }catch(error){byId('cj17-fleet-list').innerHTML=`<div class="cj17-map-error">${safe(error.message)}</div>`}
    finally{busy=false}
  };
  byId('cj17-fleet-refresh').onclick=refresh;await refresh();runtime.fleetTimer=setInterval(()=>{if(!document.hidden)refresh()},7000)
}
function parseGeometry(raw){
  if(Array.isArray(raw))return raw;
  try{const value=JSON.parse(raw||'[]');if(value?.type==='LineString')return(value.coordinates||[]).map(x=>[x[1],x[0]]);return value}catch{return[]}
}
async function renderDriverMapPage(hostId='cj17-driver-map',standalone=true){
  if(standalone){
    stopLive();const content=byId('page-content');if(!content)return;
    content.innerHTML=`<section class="cj17-live-page cj17-driver-map-page"><header><div><p class="eyebrow">MEU MAPA</p><h2>Localização e rota</h2><p>Seu marcador usa a foto aprovada no perfil.</p></div><button type="button" class="btn" id="cj17-driver-center">Centralizar</button></header><div id="${hostId}" class="cj17-main-map"></div><div id="cj17-driver-map-info" class="cj17-route-info"></div></section>`
  }
  const host=byId(hostId);if(!host)return;
  const map=await createMap(host,{zoom:16});runtime.activeMap=map;
  let ownMarker=null,first=true,busy=false;
  const refresh=async()=>{
    if(busy)return;busy=true;
    try{
      const [profile,home]=await Promise.all([request('/api/app/map/self',{useCore:false}),request('/api/app/v6/driver/home',{useCore:false}).catch(()=>({active_deliveries:[]}))]);
      const d=profile.driver||{},p={lat:Number(d.current_lat),lng:Number(d.current_lng)},delivery=(home.active_deliveries||[])[0];
      map.clearGroup('delivery');map.clearGroup('route');
      if(valid(p)){if(!ownMarker)ownMarker=map.addMarker(p,{group:'self',photo:d.photo_url,isDriver:true,label:'EU',title:d.name,popup:`<strong>${safe(d.name)}</strong>`});else ownMarker.setLatLng?.(p)}
      const points=[];if(valid(p))points.push(p);
      if(delivery){
        const pickup={lat:Number(delivery.pickup_lat),lng:Number(delivery.pickup_lng)},drop={lat:Number(delivery.delivery_lat),lng:Number(delivery.delivery_lng)};
        if(valid(pickup)){points.push(pickup);map.addMarker(pickup,{group:'delivery',color:'#f59e0b',label:'C',title:'Coleta',popup:safe(delivery.pickup_address)})}
        if(valid(drop)){points.push(drop);map.addMarker(drop,{group:'delivery',color:'#16a34a',label:'E',title:'Entrega',popup:safe(delivery.delivery_address)})}
        const geometry=parseGeometry(delivery.route_geometry);if(geometry.length)map.addPolyline(geometry,{group:'route',color:'#0d45d8',weight:7});
      }
      if(standalone&&byId('cj17-driver-map-info'))byId('cj17-driver-map-info').innerHTML=delivery?`<strong>${safe(delivery.display_code||'Entrega ativa')}</strong><span>${safe(delivery.status||'')}</span><small>${km(delivery.distance_meters)} • ${mins(delivery.duration_seconds)}</small>`:'<span>Nenhuma entrega ativa. Sua posição continua visível.</span>';
      if(first&&points.length){map.fitBounds(points,{maxZoom:17});first=false}map.invalidateSize()
    }catch(error){host.innerHTML=`<div class="cj17-map-error">${safe(error.message)}</div>`}
    finally{busy=false}
  };
  byId('cj17-driver-center')?.addEventListener('click',async()=>{const d=(await request('/api/app/map/self',{useCore:false})).driver||{};const p={lat:Number(d.current_lat),lng:Number(d.current_lng)};if(valid(p))map.setView(p,17)});
  await refresh();runtime.driverTimer=setInterval(()=>{if(!document.hidden)refresh()},7000)
}
async function enhanceVisibleMaps(){
  const s=core();if(!s?.user)return;
  if(s.user.role==='driver'){
    const host=byId('v31-driver-map');if(host&&!host.dataset.cj17){host.dataset.cj17='1';try{await renderDriverMapPage('v31-driver-map',false)}catch{}}
  }else{
    const host=byId('v31-base-map')||byId('cj14-est-map');
    if(host&&!host.dataset.cj17){
      host.dataset.cj17='1';
      try{
        const map=await createMap(host,{zoom:12});runtime.activeMap=map;const items=await fleetData(),pts=[];
        for(const d of items){const p={lat:Number(d.current_lat),lng:Number(d.current_lng)};if(valid(p)){pts.push(p);map.addMarker(p,{group:'drivers',photo:d.photo_url,isDriver:true,title:d.name,popup:`<strong>${safe(d.name)}</strong>`})}}
        if(pts.length)map.fitBounds(pts,{maxZoom:16});map.invalidateSize()
      }catch{}
    }
  }
}
function installPageOverrides(){
  if(typeof pages==='undefined')return;
  pages.tracking=renderFleetPage;
  const oldRoutes=pages.routes;
  pages.routes=async function(){if(core()?.user?.role==='driver')return renderDriverMapPage();return typeof oldRoutes==='function'?oldRoutes():renderFleetPage()};
  if(typeof navigate==='function'&&!navigate.__cj17){
    const previous=navigate;
    const wrapped=async function(...args){stopLive();const result=await previous.apply(this,args);setTimeout(enhanceVisibleMaps,180);return result};
    wrapped.__cj17=true;navigate=wrapped
  }
}

function customerCoop(){
  const params=new URLSearchParams(location.search);
  return params.get('coop')||params.get('cooperative_id')||localStorage.getItem('cj_customer_coop')||''
}
function customerToken(coop){return localStorage.getItem(`cj_customer_token_${coop}`)||localStorage.getItem('ligerim_customer_token')||''}
function saveCustomerSession(coop,data){
  localStorage.setItem('cj_customer_coop',coop);localStorage.setItem(`cj_customer_token_${coop}`,data.token);localStorage.setItem('ligerim_customer_token',data.token);runtime.customer=data.customer||null
}
async function clientRequest(path,opt={}){
  const coop=runtime.customer?.cooperative_id||customerCoop(),jwt=customerToken(coop);
  return request(`/api/client${path}`,{...opt,useCore:false,auth:false,headers:{...(opt.headers||{}),...(jwt?{Authorization:`Bearer ${jwt}`}:{})}})
}
function showCustomerScreen(){
  byId('auth-screen')?.classList.add('hidden');byId('app-shell')?.classList.add('hidden');byId('tracking-screen')?.classList.add('hidden');byId('customer-screen')?.classList.remove('hidden');
}
async function chooseCooperative(mode){
  showCustomerScreen();const root=byId('customer-content');root.innerHTML='<div class="cj17-customer-loading">Carregando cooperativas…</div>';
  try{
    const catalog=await clientRequest('/catalog');
    root.innerHTML=`<section class="cj17-coop-picker"><img src="/icons/logo-official.png" alt="ChegaJá"><h1>Escolha a cooperativa</h1><p>Depois você poderá entrar, cadastrar-se ou pedir sem cadastro.</p><div>${(catalog.cooperatives||[]).map(c=>`<button data-coop="${safe(c.id)}"><span>${c.logo_url?`<img src="${safe(c.logo_url)}" alt="">`:''}<strong>${safe(c.name)}</strong></span><b>Continuar</b></button>`).join('')}</div></section>`;
    root.querySelectorAll('[data-coop]').forEach(button=>button.onclick=()=>{const coop=button.dataset.coop;localStorage.setItem('cj_customer_coop',coop);const url=new URL(location.href);url.searchParams.set('cliente','1');url.searchParams.set('coop',coop);history.replaceState({},'',url);openCustomer(mode)})
  }catch(error){root.innerHTML=`<div class="cj17-map-error">${safe(error.message)}</div>`}
}
async function loadCustomerCatalog(coop){
  const data=await clientRequest(`/catalog?coop=${encodeURIComponent(coop)}`);
  const cooperative=(data.cooperatives||[])[0];if(!cooperative)throw new Error('Link da cooperativa inválido ou indisponível.');
  return{...data,cooperative}
}
function customerBrand(c){
  return `<div class="cj17-customer-brand">${c.logo_url?`<img src="${safe(c.logo_url)}" alt="${safe(c.name)}">`:`<img src="/icons/logo-official.png" alt="ChegaJá">`}<div><small>ENTREGAS PELO CHEGAJÁ</small><strong>${safe(c.name)}</strong></div></div>`
}
function customerAccess(catalog,mode='hub'){
  const root=byId('customer-content'),c=catalog.cooperative;
  root.style.setProperty('--customer-color',c.primary_color||'#0D257A');
  if(new URLSearchParams(location.search).has('customer_reset'))return customerReset(catalog);
  const forms={
    login:`<form id="cj17-customer-form"><h1>Entrar como cliente</h1><p>Acompanhe pedidos e use seus dados salvos.</p><label>Celular ou e-mail<input name="login" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="current-password" required></label><button class="cj17-primary">Entrar</button><button type="button" class="cj17-link" data-forgot>Esqueci minha senha</button></form>`,
    register:`<form id="cj17-customer-form"><h1>Criar conta</h1><p>Cadastre-se para guardar histórico e créditos.</p><label>Nome<input name="name" autocomplete="name" required></label><label>Celular<input name="phone" type="tel" autocomplete="tel"></label><label>E-mail<input name="email" type="email" autocomplete="email"></label><label>Senha<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="cj17-primary">Criar conta e pedir</button></form>`,
    guest:`<form id="cj17-customer-form"><h1>Pedir sem cadastro</h1><p>Informe somente seus dados de contato para esta solicitação.</p><label>Nome<input name="name" autocomplete="name" required></label><label>Celular<input name="phone" type="tel" autocomplete="tel"></label><label>E-mail opcional<input name="email" type="email" autocomplete="email"></label><button class="cj17-primary">Continuar para o pedido</button></form>`,
    forgot:`<form id="cj17-customer-form"><h1>Recuperar senha</h1><p>Enviaremos um link para o e-mail cadastrado.</p><label>E-mail<input name="email" type="email" required></label><button class="cj17-primary">Enviar instruções</button></form>`
  };
  root.innerHTML=`<section class="cj17-customer-access">${customerBrand(c)}<div class="cj17-access-card">${mode==='hub'?`<div class="cj17-access-title"><small>CLIENTE</small><h1>Como deseja pedir?</h1><p>Escolha uma opção para continuar.</p></div><div class="cj17-access-options"><button data-mode="login"><b>Entrar</b><span>Já tenho cadastro</span></button><button data-mode="guest" class="primary"><b>Pedir agora</b><span>Sem criar senha</span></button><button data-mode="register"><b>Criar conta</b><span>Salvar histórico e créditos</span></button></div>`:`${forms[mode]||forms.login}<button type="button" class="cj17-back" data-mode="hub">← Voltar às opções</button><p id="cj17-customer-message"></p>`}</div></section>`;
  root.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>customerAccess(catalog,button.dataset.mode));
  root.querySelector('[data-forgot]')?.addEventListener('click',()=>customerAccess(catalog,'forgot'));
  const form=byId('cj17-customer-form');if(!form)return;
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button[type="submit"],button:not([type])'),message=byId('cj17-customer-message');button.disabled=true;message.textContent='Aguarde…';
    const body=Object.fromEntries(new FormData(form));body.cooperative_id=c.id;
    try{
      if(mode==='forgot'){
        const result=await clientRequest('/forgot-password',{method:'POST',body});message.textContent=result.message||'Confira seu e-mail.';button.disabled=false;return
      }
      const result=await clientRequest(`/${mode}`,{method:'POST',body});saveCustomerSession(c.id,result);await customerRequestApp(catalog)
    }catch(error){message.textContent=error.message;button.disabled=false}
  }
}
async function customerReset(catalog){
  const root=byId('customer-content'),c=catalog.cooperative,reset=new URLSearchParams(location.search).get('customer_reset');
  root.innerHTML=`<section class="cj17-customer-access">${customerBrand(c)}<div class="cj17-access-card"><form id="cj17-customer-reset"><h1>Criar nova senha</h1><label>Nova senha<input name="password" type="password" minlength="8" required></label><label>Confirmar senha<input name="confirm" type="password" minlength="8" required></label><button class="cj17-primary">Atualizar senha</button><p id="cj17-customer-message"></p></form></div></section>`;
  byId('cj17-customer-reset').onsubmit=async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget)),message=byId('cj17-customer-message');if(values.password!==values.confirm){message.textContent='As senhas não são iguais.';return}try{await clientRequest('/reset-password',{method:'POST',body:{token:reset,password:values.password,cooperative_id:c.id}});const url=new URL(location.href);url.searchParams.delete('customer_reset');history.replaceState({},'',url);customerAccess(catalog,'login')}catch(error){message.textContent=error.message}}
}
function customerMapPopup(title,address){return `<div class="cj17-map-popup"><strong>${safe(title)}</strong><small>${safe(address)}</small></div>`}
async function customerRequestApp(catalog){
  const root=byId('customer-content'),c=catalog.cooperative,bases=catalog.bases||[];
  if(!bases.length){root.innerHTML=`<div class="cj17-map-error">Nenhuma Base está disponível para pedidos.</div>`;return}
  const base=bases[0],session={base,step:1,pickup:null,delivery:null,quote:null,map:null,markers:{},customer:runtime.customer||{},catalog};
  root.style.setProperty('--customer-color',c.primary_color||'#0D257A');
  root.innerHTML=`<section class="cj17-ride-app"><header>${customerBrand(c)}<button type="button" id="cj17-customer-menu">Meus pedidos</button></header><div id="cj17-customer-map" class="cj17-customer-map"></div><section class="cj17-ride-sheet"><div class="cj17-sheet-handle"></div><div id="cj17-ride-content"></div></section></section>`;
  session.map=await createMap('cj17-customer-map',{public:true,zoom:13});runtime.activeMap=session.map;
  const renderStep=()=>{
    const box=byId('cj17-ride-content');if(!box)return;
    if(session.step===1){
      box.innerHTML=`<div class="cj17-step-title"><small>1 DE 3</small><h1>Para onde vamos?</h1><p>Pesquise rua, número ou nome do local.</p></div>${bases.length>1?`<label class="cj17-base-select">Base de atendimento<select id="cj17-base">${bases.map(x=>`<option value="${safe(x.id)}" ${x.id===session.base.id?'selected':''}>${safe(x.name)}</option>`).join('')}</select></label>`:''}<div class="cj17-address-stack"><div class="cj17-address-field pickup"><i></i><label>Coletar em<input id="cj17-pickup-input" autocomplete="off" placeholder="Ex.: Midway Mall ou Rua A, 120"></label><div id="cj17-pickup-results" class="cj17-suggestions"></div></div><div class="cj17-address-line"></div><div class="cj17-address-field delivery"><i></i><label>Entregar em<input id="cj17-delivery-input" autocomplete="off" placeholder="Digite o destino"></label><div id="cj17-delivery-results" class="cj17-suggestions"></div></div></div><div id="cj17-quote" class="cj17-quote"><span>Escolha coleta e entrega</span></div><button id="cj17-next" class="cj17-primary" disabled>Continuar</button>`;
      byId('cj17-pickup-input').value=session.pickup?.formatted_address||'';byId('cj17-delivery-input').value=session.delivery?.formatted_address||'';
      bindSearch('pickup');bindSearch('delivery');
      byId('cj17-base')?.addEventListener('change',event=>{session.base=bases.find(x=>x.id===event.target.value)||base;session.pickup=null;session.delivery=null;session.quote=null;session.map.clearGroup('route');session.map.clearGroup('addresses');renderStep()});
      byId('cj17-next').onclick=()=>{session.step=2;renderStep()}
    }else if(session.step===2){
      box.innerHTML=`<div class="cj17-step-title"><small>2 DE 3</small><h1>Detalhes da entrega</h1><p>${money(session.quote?.charge_cents)} • ${km(session.quote?.distance_meters)}</p></div><form id="cj17-details"><div class="cj17-two"><label>Nome de quem recebe<input name="recipient_name"></label><label>Telefone<input name="recipient_phone" type="tel"></label></div><label>O que será transportado<input name="item_description" placeholder="Documento, pacote, compra…"></label><label>Forma de pagamento<select name="payment_method"><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option>${runtime.customer?.guest?'':`<option value="credit">Crédito pré-pago</option>`}</select></label><label id="cj17-cash" class="hidden">Dinheiro será pago em<select name="cash_payment_location"><option value="pickup">Na coleta</option><option value="delivery">Na entrega</option></select></label><label>Complemento da coleta<input name="pickup_complement" placeholder="Bloco, loja, referência"></label><label>Complemento da entrega<input name="delivery_complement" placeholder="Apto, torre, referência"></label><label>Observações<textarea name="notes" rows="2"></textarea></label><div class="cj17-actions"><button type="button" class="cj17-secondary" id="cj17-back-step">Voltar</button><button class="cj17-primary">Revisar pedido</button></div></form>`;
      const form=byId('cj17-details');const payment=form.elements.payment_method,update=()=>byId('cj17-cash').classList.toggle('hidden',payment.value!=='dinheiro');payment.onchange=update;update();
      byId('cj17-back-step').onclick=()=>{session.step=1;renderStep()};
      form.onsubmit=event=>{event.preventDefault();session.details=Object.fromEntries(new FormData(form));session.step=3;renderStep()}
    }else{
      box.innerHTML=`<div class="cj17-step-title"><small>3 DE 3</small><h1>Confirmar solicitação</h1></div><div class="cj17-review"><div><small>Coleta</small><strong>${safe(session.pickup.formatted_address)}</strong></div><div><small>Entrega</small><strong>${safe(session.delivery.formatted_address)}</strong></div><div><small>Valor calculado</small><strong>${money(session.quote.charge_cents)}</strong><span>${km(session.quote.distance_meters)} • ${mins(session.quote.duration_seconds)}</span></div></div><div class="cj17-actions"><button type="button" class="cj17-secondary" id="cj17-back-step">Voltar</button><button type="button" class="cj17-primary" id="cj17-confirm-order">Confirmar pedido</button></div><p id="cj17-order-message"></p>`;
      byId('cj17-back-step').onclick=()=>{session.step=2;renderStep()};
      byId('cj17-confirm-order').onclick=async event=>{const button=event.currentTarget,message=byId('cj17-order-message');button.disabled=true;message.textContent='Enviando pedido…';try{const body={...session.details,cooperative_id:c.id,base_id:session.base.id,pickup_confirmation_token:session.pickup.confirmation_token,delivery_confirmation_token:session.delivery.confirmation_token,service_ids:[]};const result=await clientRequest('/orders',{method:'POST',body});orderSuccess(result.order,c)}catch(error){message.textContent=error.message;button.disabled=false}}
    }
  };
  function bindSearch(kind){
    const input=byId(`cj17-${kind}-input`),results=byId(`cj17-${kind}-results`);let timer=0,sequence=0;
    input.oninput=()=>{session[kind]=null;session.quote=null;byId('cj17-next').disabled=true;byId('cj17-quote').innerHTML='<span>Continue digitando…</span>';clearTimeout(timer);const value=input.value.trim();if(value.length<3){results.innerHTML='';return}const current=++sequence;timer=setTimeout(async()=>{results.innerHTML='<div class="cj17-searching">Buscando endereços…</div>';try{const data=await request('/api/public/address/autocomplete',{method:'POST',useCore:false,auth:false,body:{query:value,base_id:session.base.id,cooperative_id:c.id,state:session.base.state||'RN'}});if(current!==sequence)return;const items=(data.items||[]).filter(x=>x.confirmable&&x.confirmation_token).slice(0,7);if(items.length===1&&input.value.trim()===value){select(items[0]);return}results.innerHTML=items.map((item,index)=>`<button type="button" data-address="${index}"><i>⌖</i><span><strong>${safe(item.place_name||item.street||'Endereço')}</strong><small>${safe(item.formatted_address)}</small></span></button>`).join('')||'<div class="cj17-no-result">Nenhum endereço encontrado. Digite rua, número, bairro ou nome do local.</div>';results.querySelectorAll('[data-address]').forEach(button=>button.onclick=()=>select(items[Number(button.dataset.address)]))}catch(error){results.innerHTML=`<div class="cj17-no-result">${safe(error.message)}</div>`}},300)};
    function select(item){session[kind]=item;input.value=item.formatted_address;results.innerHTML='';drawAddresses();autoQuote()}
  }
  function drawAddresses(){
    session.map.clearGroup('addresses');
    const pts=[];
    if(session.pickup){const p={lat:Number(session.pickup.lat),lng:Number(session.pickup.lng)};if(valid(p)){pts.push(p);session.map.addMarker(p,{group:'addresses',color:'#0d45d8',label:'C',popup:customerMapPopup('Coleta',session.pickup.formatted_address)})}}
    if(session.delivery){const p={lat:Number(session.delivery.lat),lng:Number(session.delivery.lng)};if(valid(p)){pts.push(p);session.map.addMarker(p,{group:'addresses',color:'#16a34a',label:'E',popup:customerMapPopup('Entrega',session.delivery.formatted_address)})}}
    if(pts.length)session.map.fitBounds(pts,{maxZoom:16})
  }
  async function autoQuote(){
    if(!session.pickup||!session.delivery)return;
    const quoteBox=byId('cj17-quote');quoteBox.innerHTML='<span>Calculando rota e valor…</span>';
    try{
      const result=await clientRequest('/quote',{method:'POST',body:{cooperative_id:c.id,base_id:session.base.id,pickup_confirmation_token:session.pickup.confirmation_token,delivery_confirmation_token:session.delivery.confirmation_token,service_ids:[]}});
      session.quote=result.quote;quoteBox.innerHTML=`<div><small>Valor da entrega</small><strong>${money(session.quote.charge_cents)}</strong></div><span>${km(session.quote.distance_meters)} • ${mins(session.quote.duration_seconds)}</span>`;
      session.map.clearGroup('route');const geometry=parseGeometry(session.quote.geometry);if(geometry.length)session.map.addPolyline(geometry,{group:'route',color:c.primary_color||'#0D257A',weight:7});byId('cj17-next').disabled=false
    }catch(error){quoteBox.innerHTML=`<div class="cj17-no-result">${safe(error.message)}</div>`}
  }
  function orderSuccess(order,c){
    stopLive();root.innerHTML=`<section class="cj17-order-success">${customerBrand(c)}<div><b>✓</b><h1>Pedido enviado</h1><p>Seu pedido <strong>${safe(order.display_code)}</strong> foi criado.</p><section><small>Valor</small><strong>${money(order.charge_cents)}</strong></section>${order.confirmation_code?`<section><small>Código de entrega</small><strong>${safe(order.confirmation_code)}</strong></section>`:''}${order.tracking_url?`<a href="${safe(order.tracking_url)}">Acompanhar entrega no mapa</a>`:''}<button type="button" id="cj17-new-order">Fazer outro pedido</button></div></section>`;byId('cj17-new-order').onclick=()=>customerRequestApp(catalog)
  }
  byId('cj17-customer-menu').onclick=()=>customerOrders(catalog);
  renderStep()
}
async function customerOrders(catalog){
  const root=byId('customer-content'),c=catalog.cooperative;root.innerHTML=`<section class="cj17-orders">${customerBrand(c)}<header><div><small>MINHA CONTA</small><h1>Meus pedidos</h1></div><button id="cj17-order-back">Novo pedido</button></header><div id="cj17-order-list">Carregando…</div></section>`;byId('cj17-order-back').onclick=()=>customerRequestApp(catalog);
  try{const data=await clientRequest('/orders');byId('cj17-order-list').innerHTML=(data.items||[]).map(item=>`<article><div><strong>${safe(item.display_code||'Pedido')}</strong><small>${safe(item.delivery_address||'')}</small></div><span>${safe(item.delivery_status||item.status||'')}</span>${item.tracking_url?`<a href="${safe(item.tracking_url)}">Acompanhar</a>`:''}</article>`).join('')||'<div class="cj17-empty">Nenhum pedido ainda.</div>'}catch(error){byId('cj17-order-list').innerHTML=`<div class="cj17-map-error">${safe(error.message)}</div>`}
}
async function openCustomer(mode='hub'){
  stopLive();showCustomerScreen();const coop=customerCoop();if(!coop)return chooseCooperative(mode);
  const root=byId('customer-content');root.innerHTML='<div class="cj17-customer-loading">Abrindo atendimento…</div>';
  try{
    const catalog=await loadCustomerCatalog(coop),jwt=customerToken(coop);
    if(jwt){try{const me=await clientRequest('/me');runtime.customer=me.customer;return customerRequestApp(catalog)}catch{localStorage.removeItem(`cj_customer_token_${coop}`);localStorage.removeItem('ligerim_customer_token')}}
    customerAccess(catalog,mode)
  }catch(error){root.innerHTML=`<div class="cj17-map-error">${safe(error.message)}</div>`}
}
window.chegajaOpenCustomer=openCustomer;

async function publicTrackingFast(tokenValue){
  stopLive();
  byId('auth-screen')?.classList.add('hidden');byId('app-shell')?.classList.add('hidden');byId('customer-screen')?.classList.add('hidden');
  const screen=byId('tracking-screen');if(!screen)return;screen.classList.remove('hidden');
  screen.innerHTML=`<section class="cj17-public-track"><header><img src="/icons/icon-official.png" alt=""><div><small>ACOMPANHAMENTO EM TEMPO REAL</small><h1 id="cj17-track-code">Sua entrega</h1><span id="cj17-track-status">Aguardando</span></div></header><div id="cj17-public-map" class="cj17-public-map"></div><div class="cj17-track-sheet"><div id="cj17-track-driver" class="cj17-track-driver"></div><div class="cj17-track-addresses"><div><small>Coleta</small><strong id="cj17-track-pickup">—</strong></div><div><small>Entrega</small><strong id="cj17-track-delivery">—</strong></div></div><div id="cj17-track-meta"></div></div></section>`;
  const map=await createMap('cj17-public-map',{public:true,zoom:13});runtime.activeMap=map;let first=true,busy=false,driverMarker=null;
  const refresh=async()=>{
    if(busy)return;busy=true;
    try{
      const x=(await request(`/api/public/tracking/${encodeURIComponent(tokenValue)}`,{useCore:false,auth:false,timeout:7000})).item||{};
      byId('cj17-track-code').textContent=x.display_code||'Sua entrega';byId('cj17-track-status').textContent=typeof statusText!=='undefined'?(statusText[x.status]||x.status):x.status;byId('cj17-track-pickup').textContent=x.pickup_address||'—';byId('cj17-track-delivery').textContent=x.delivery_address||'—';
      byId('cj17-track-driver').innerHTML=`<span class="cj17-driver-avatar">${x.driver_photo_url?`<img src="${safe(x.driver_photo_url)}" alt="">`:`<b>CJ</b>`}</span><span><small>Seu cooperado</small><strong>${safe(x.driver_name||'Aguardando atribuição')}</strong><em>${safe([x.vehicle_model,x.vehicle_plate].filter(Boolean).join(' • '))}</em></span>`;
      byId('cj17-track-meta').innerHTML=`<span><small>Distância</small><strong>${km(x.distance_meters)}</strong></span><span><small>Previsão</small><strong>${mins(x.duration_seconds)}</strong></span><span><small>Atualizado</small><strong>${x.location_updated_at?new Date(x.location_updated_at).toLocaleTimeString('pt-BR'):'—'}</strong></span>`;
      map.clearGroup('fixed');map.clearGroup('route');
      const pickup={lat:Number(x.pickup_lat),lng:Number(x.pickup_lng)},drop={lat:Number(x.delivery_lat),lng:Number(x.delivery_lng)},driver={lat:Number(x.driver_lat),lng:Number(x.driver_lng)},pts=[];
      if(valid(pickup)){pts.push(pickup);map.addMarker(pickup,{group:'fixed',color:'#0d45d8',label:'C',popup:customerMapPopup('Coleta',x.pickup_address)})}
      if(valid(drop)){pts.push(drop);map.addMarker(drop,{group:'fixed',color:'#16a34a',label:'E',popup:customerMapPopup('Entrega',x.delivery_address)})}
      const geometry=parseGeometry(x.route_geometry);if(geometry.length)map.addPolyline(geometry,{group:'route',color:x.primary_color||'#0D257A',weight:7});
      if(valid(driver)){pts.push(driver);if(!driverMarker)driverMarker=map.addMarker(driver,{group:'driver',photo:x.driver_photo_url,isDriver:true,label:'CJ',popup:`<strong>${safe(x.driver_name||'Cooperado')}</strong>`});else driverMarker.setLatLng?.(driver)}
      if(first&&pts.length){map.fitBounds(pts,{maxZoom:16});first=false}map.invalidateSize()
    }catch(error){byId('cj17-track-meta').innerHTML=`<div class="cj17-map-error">${safe(error.message)}</div>`}
    finally{busy=false}
  };
  await refresh();runtime.publicTimer=setInterval(()=>{if(!document.hidden)refresh()},6000)
}
window.publicTracking=publicTrackingFast;

function fastGps(){
  if(typeof startLocation==='undefined')return;
  startLocation=function(){
    const s=core();if(!s||s.watchId!==null||!navigator.geolocation||!s.online)return;
    let sent=0,busy=false;
    s.watchId=navigator.geolocation.watchPosition(position=>{
      window.ChegaJaLastDriverLocation={lat:position.coords.latitude,lng:position.coords.longitude,accuracy:position.coords.accuracy,at:Date.now()};
      if(!s.online||busy||Date.now()-sent<8000)return;sent=Date.now();busy=true;
      request('/api/app/map/location',{method:'POST',useCore:false,timeout:6000,body:{latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,speed:position.coords.speed,heading:position.coords.heading}}).catch(()=>{}).finally(()=>busy=false)
    },error=>{if(error.code===1&&typeof toast==='function')toast('Ative a localização do celular para aparecer no mapa.','error')},{enableHighAccuracy:true,maximumAge:5000,timeout:15000})
  }
}
function fastSos(){
  stopTimer('sosTimer');
  runtime.sosTimer=setInterval(()=>{const s=core();if(!document.hidden&&s?.user?.role==='driver')window.ChegaJaV145?.pollDriverSos?.()},3000)
}
function captureCustomerButtons(){
  document.addEventListener('click',event=>{
    const register=event.target.closest('#customer-app-link'),guest=event.target.closest('#customer-guest-link');
    if(!register&&!guest)return;event.preventDefault();event.stopImmediatePropagation();openCustomer(guest?'guest':'register')
  },true)
}
function boot(){
  installPageOverrides();fastGps();fastSos();captureCustomerButtons();
  const params=new URLSearchParams(location.search),track=location.pathname.match(/^\/r\/([^/]+)/)?.[1];
  if(track)setTimeout(()=>publicTrackingFast(track),80);
  else if(location.pathname==='/cliente'||params.has('cliente'))setTimeout(()=>openCustomer(params.get('mode')||'hub'),80);
  setTimeout(enhanceVisibleMaps,300)
}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',boot,{once:true}):boot()
})();
