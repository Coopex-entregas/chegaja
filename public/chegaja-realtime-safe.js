/* ChegaJá 14.16.3 — mapas persistentes, foto no marcador e SOS rápido */
(()=>{
  'use strict';
  const byId=id=>document.getElementById(id);
  const escSafe=value=>String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const runtime={profilePromise:null,publicTimer:null,publicMap:null,publicBusy:false,sosPoll:null,sosBusy:false};

  async function jsonFetch(url,options={}){
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(window.state?.token)headers.Authorization=`Bearer ${window.state.token}`;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),Number(options.timeout||10000));
    try{
      const response=await fetch(url,{...options,headers,signal:controller.signal,body:options.body&&typeof options.body!=='string'?JSON.stringify(options.body):options.body});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
      return data;
    }finally{clearTimeout(timeout)}
  }

  function profile(){
    if(!runtime.profilePromise)runtime.profilePromise=jsonFetch('/api/app/map/self').then(x=>x.driver||{}).catch(()=>({}));
    return runtime.profilePromise;
  }

  function photoNode(url,label='EU'){
    const node=document.createElement('div');node.className='cj-live-photo-marker';
    if(url){const img=document.createElement('img');img.src=url;img.alt='Foto do cooperado';img.loading='eager';img.onerror=()=>{node.textContent=label};node.appendChild(img)}else node.textContent=label;
    const pulse=document.createElement('span');node.appendChild(pulse);return node;
  }

  function decorateMarker(result,opts={}){
    const apply=url=>{
      if(!url)return;
      try{
        if(result?.raw&&'content'in result.raw){result.raw.content=photoNode(url,opts.label||'EU');return}
        if(result?.setIcon&&window.L){result.setIcon(L.divIcon({className:'cj-live-leaflet-icon',html:`<div class="cj-live-photo-marker"><img src="${escSafe(url)}" alt="Foto do cooperado"><span></span></div>`,iconSize:[46,52],iconAnchor:[23,46]}));}
      }catch{}
    };
    if(opts.photo)apply(opts.photo);
    else if(opts.label==='EU'||opts.isDriver)profile().then(x=>apply(x.photo_url));
    return result;
  }

  function patchMapAdapter(){
    const maps=window.ChegaJaMaps;if(!maps?.createMap||maps.createMap.__cjLive)return;
    const original=maps.createMap.bind(maps);
    const patched=async(...args)=>{
      const adapter=await original(...args);
      if(adapter.__cjLive)return adapter;
      adapter.__cjLive=true;
      const addMarker=adapter.addMarker?.bind(adapter),addCircle=adapter.addCircleMarker?.bind(adapter);
      if(addMarker)adapter.addMarker=(point,opts={})=>decorateMarker(addMarker(point,opts),opts);
      if(addCircle)adapter.addCircleMarker=(point,opts={})=>decorateMarker(addCircle(point,opts),opts);
      return adapter;
    };
    patched.__cjLive=true;maps.createMap=patched;
  }

  let googlePromise=null;
  async function loadPublicGoogle(config){
    if(window.google?.maps?.importLibrary)return;
    if(googlePromise)return googlePromise;
    googlePromise=new Promise((resolve,reject)=>{
      const callback=`__cjPublicMap${Date.now()}`;window[callback]=()=>{delete window[callback];resolve()};
      const script=document.createElement('script');script.async=true;script.defer=true;
      script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.api_key)}&v=weekly&loading=async&libraries=marker&language=pt-BR&region=BR&callback=${callback}`;
      script.onerror=()=>{googlePromise=null;reject(new Error('Google Maps não carregou. Verifique a chave e o domínio autorizado.'))};document.head.appendChild(script);
    });
    return googlePromise;
  }

  async function makePublicMap(host){
    const config=(await jsonFetch('/api/public/maps-config')).item||{};
    if(config.provider==='google'&&config.enabled&&config.api_key){
      await loadPublicGoogle(config);const {Map}=await google.maps.importLibrary('maps');const {AdvancedMarkerElement}=await google.maps.importLibrary('marker');
      const map=new Map(host,{center:{lat:-5.7945,lng:-35.211},zoom:13,mapId:config.map_id||'DEMO_MAP_ID',mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'greedy'});
      const markers=new Map(),info=new google.maps.InfoWindow();
      return {provider:'google',update(key,lat,lng,options={}){lat=Number(lat);lng=Number(lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;let marker=markers.get(key);const position={lat,lng};if(!marker){marker=new AdvancedMarkerElement({map,position,title:options.title||'',content:options.photo?photoNode(options.photo,options.label):undefined});if(options.popup)marker.addListener('click',()=>{info.setContent(options.popup);info.open({map,anchor:marker})});markers.set(key,marker)}else{marker.position=position;if(options.photo)marker.content=photoNode(options.photo,options.label)}},fit(points){const valid=points.filter(p=>Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1])));if(!valid.length)return;const bounds=new google.maps.LatLngBounds();valid.forEach(p=>bounds.extend({lat:Number(p[0]),lng:Number(p[1])}));map.fitBounds(bounds,50);google.maps.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>16)map.setZoom(16)})},resize(){google.maps.event.trigger(map,'resize')}};
    }
    if(!window.L)throw new Error('Mapa alternativo não carregou.');
    const map=L.map(host,{zoomControl:true}).setView([-5.7945,-35.211],13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);const markers=new Map();
    return {provider:'openstreetmap',update(key,lat,lng,options={}){lat=Number(lat);lng=Number(lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;let marker=markers.get(key);if(!marker){const icon=options.photo?L.divIcon({className:'cj-live-leaflet-icon',html:`<div class="cj-live-photo-marker"><img src="${escSafe(options.photo)}" alt="Foto do cooperado"><span></span></div>`,iconSize:[46,52],iconAnchor:[23,46]}):undefined;marker=L.marker([lat,lng],icon?{icon}:{}).addTo(map);if(options.popup)marker.bindPopup(options.popup);markers.set(key,marker)}else marker.setLatLng([lat,lng])},fit(points){const valid=points.filter(p=>Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1])));if(valid.length)map.fitBounds(valid,{padding:[45,45],maxZoom:16})},resize(){map.invalidateSize()}};
  }

  function trackingShell(){
    const screen=byId('tracking-screen');if(!screen)return null;
    screen.innerHTML=`<div class="tracking-card cj-live-tracking"><header class="tracking-head"><div><p class="eyebrow">ChegaJá em tempo real</p><h1 id="cj-live-code">Sua entrega</h1><p id="cj-live-place"></p></div><span id="cj-live-status" class="badge">Aguardando</span></header><div class="tracking-body"><div class="tracking-address"><div class="address-box"><small>Coleta</small><strong id="cj-live-pickup">—</strong></div><div class="address-box"><small>Entrega</small><strong id="cj-live-delivery">—</strong></div></div><div id="cj-live-public-map" class="map small"><div class="cj-live-map-loading">Carregando mapa…</div></div><div class="cj-live-driver-card"><div id="cj-live-driver-photo" class="cj-live-driver-photo">CJ</div><span><small>Cooperado</small><strong id="cj-live-driver">Aguardando atribuição</strong><em id="cj-live-vehicle"></em></span></div><div class="tracking-info"><span><small>Distância</small><strong id="cj-live-distance">—</strong></span><span><small>Previsão</small><strong id="cj-live-duration">—</strong></span><span><small>Atualizado</small><strong id="cj-live-updated">—</strong></span></div></div></div>`;
    return byId('cj-live-public-map');
  }

  async function startPublicTracking(token){
    clearInterval(window.state?.timer);clearInterval(runtime.publicTimer);
    const host=trackingShell();if(!host)return;
    try{runtime.publicMap=await makePublicMap(host);host.querySelector('.cj-live-map-loading')?.remove()}catch(error){host.innerHTML=`<div class="cj-live-map-error"><strong>Mapa indisponível</strong><span>${escSafe(error.message)}</span></div>`}
    let fitted=false;
    const refresh=async()=>{
      if(runtime.publicBusy)return;runtime.publicBusy=true;
      try{
        const x=(await jsonFetch(`/api/public/tracking/${encodeURIComponent(token)}`,{timeout:8000})).item||{};
        byId('cj-live-code').textContent=x.display_code||'Sua entrega';byId('cj-live-place').textContent=x.establishment_name||x.base_name||'';byId('cj-live-status').textContent=window.statusText?.[x.status]||x.status||'Aguardando';byId('cj-live-status').className=`badge ${x.status||''}`;
        byId('cj-live-pickup').textContent=x.pickup_address||'—';byId('cj-live-delivery').textContent=x.delivery_address||'—';byId('cj-live-driver').textContent=x.driver_name||'Aguardando atribuição';byId('cj-live-vehicle').textContent=[x.vehicle_model,x.vehicle_plate].filter(Boolean).join(' • ');
        byId('cj-live-distance').textContent=`${(Number(x.distance_meters||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} km`;byId('cj-live-duration').textContent=`${Math.max(1,Math.round(Number(x.duration_seconds||0)/60))} min`;byId('cj-live-updated').textContent=x.location_updated_at?new Date(x.location_updated_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
        const photo=byId('cj-live-driver-photo');if(x.driver_photo_url&&photo&&!photo.querySelector('img'))photo.innerHTML=`<img src="${escSafe(x.driver_photo_url)}" alt="Foto do cooperado">`;
        if(runtime.publicMap){runtime.publicMap.update('pickup',x.pickup_lat,x.pickup_lng,{title:'Coleta',popup:'Coleta'});runtime.publicMap.update('delivery',x.delivery_lat,x.delivery_lng,{title:'Entrega',popup:'Entrega'});runtime.publicMap.update('driver',x.driver_lat,x.driver_lng,{title:x.driver_name||'Cooperado',popup:x.driver_name||'Cooperado',photo:x.driver_photo_url,label:'EU'});if(!fitted){runtime.publicMap.fit([[x.pickup_lat,x.pickup_lng],[x.delivery_lat,x.delivery_lng],[x.driver_lat,x.driver_lng]]);fitted=true}runtime.publicMap.resize()}
      }catch(error){console.warn('Rastreamento:',error.message)}finally{runtime.publicBusy=false}
    };
    await refresh();runtime.publicTimer=setInterval(()=>{if(!document.hidden)refresh()},8000);
  }

  function lastPosition(){
    if(window.ChegaJaLastDriverLocation)return Promise.resolve({coords:{latitude:window.ChegaJaLastDriverLocation.lat,longitude:window.ChegaJaLastDriverLocation.lng,accuracy:window.ChegaJaLastDriverLocation.accuracy||0}});
    return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('GPS indisponível.'));navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:4500,maximumAge:15000})});
  }

  function dial(number){navigator.clipboard?.writeText(number).catch(()=>{});window.location.href=`tel:${number}`}

  function emergencyModal(){
    if(window.state?.user?.role!=='driver')return;
    const old=byId('cj-live-emergency');if(old){old.classList.add('open');return}
    const modal=document.createElement('section');modal.id='cj-live-emergency';modal.className='cj-live-emergency open';modal.innerHTML=`<div class="backdrop" data-close-emergency></div><article><header><div><small>AJUDA E EMERGÊNCIA</small><h2>Como você precisa de ajuda?</h2></div><button type="button" data-close-emergency>×</button></header><button type="button" id="cj-live-internal-sos" class="internal"><b>!</b><span><strong>Enviar SOS para a cooperativa</strong><small>Envia sua localização imediatamente.</small></span></button><div class="cj-live-public-help"><button type="button" data-dial="190"><b>190</b><span>Polícia Militar<small>Copiar e ligar</small></span></button><button type="button" data-dial="192"><b>192</b><span>SAMU<small>Copiar e ligar</small></span></button><button type="button" data-dial="193"><b>193</b><span>Bombeiros<small>Copiar e ligar</small></span></button><button type="button" data-dial="191"><b>191</b><span>Polícia Rodoviária<small>Copiar e ligar</small></span></button><button type="button" data-dial="199"><b>199</b><span>Defesa Civil<small>Copiar e ligar</small></span></button></div><p id="cj-live-sos-message"></p></article>`;document.body.appendChild(modal);
    modal.querySelectorAll('[data-close-emergency]').forEach(x=>x.addEventListener('click',()=>modal.classList.remove('open')));modal.querySelectorAll('[data-dial]').forEach(x=>x.addEventListener('click',()=>dial(x.dataset.dial)));
    byId('cj-live-internal-sos').onclick=async event=>{const button=event.currentTarget,message=byId('cj-live-sos-message');if(button.disabled)return;button.disabled=true;button.classList.add('sending');message.textContent='Obtendo sua localização e enviando…';try{const p=await lastPosition();const result=await jsonFetch('/api/app/v15/driver/sos',{method:'POST',timeout:7000,body:{occurrence:'Solicitação de ajuda enviada pelo aplicativo.',latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}});message.textContent=`SOS enviado imediatamente${result.base_name?` para ${result.base_name}`:''}.`;button.classList.remove('sending');button.classList.add('sent');button.querySelector('strong').textContent='SOS enviado';if(window.toast)toast('Pedido de socorro enviado para a cooperativa.','success')}catch(error){message.textContent=error.message;button.disabled=false;button.classList.remove('sending');if(window.toast)toast(error.message,'error')}};
  }

  function bindEmergencyButtons(){
    document.addEventListener('click',event=>{const target=event.target.closest('#v31-sos-top,#v31-bottom-sos,#cj144-sos-floating,#cj143-driver-nav .sos,[data-v31-emergency],.cj143-help .internal');if(!target)return;event.preventDefault();event.stopImmediatePropagation();emergencyModal()},true);
  }

  function accelerateSosPoll(){
    clearInterval(runtime.sosPoll);runtime.sosPoll=setInterval(()=>{if(document.hidden||window.state?.user?.role!=='driver')return;window.ChegaJaV145?.pollDriverSos?.()},4000);
  }

  function boot(){
    patchMapAdapter();bindEmergencyButtons();accelerateSosPoll();
    const token=location.pathname.match(/^\/r\/([^/]+)/)?.[1];if(token)setTimeout(()=>startPublicTracking(token),250);
    const observer=new MutationObserver(()=>patchMapAdapter());observer.observe(document.documentElement,{childList:true,subtree:true});
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',boot,{once:true}):boot();
})();
