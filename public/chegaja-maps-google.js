/* ChegaJá 14.19.1 — Google Maps com contingência funcional */
(()=>{
'use strict';
const runtime={config:null,google:null,instances:new Map(),lastError:''};
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
function point(value,lng){let lat;if(Array.isArray(value)){lat=Number(value[0]);lng=Number(value[1])}else if(value&&typeof value==='object'){lat=Number(value.lat??value.latitude);lng=Number(value.lng??value.longitude)}else lat=Number(value);const brazil=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=-35&&a<=7&&b>=-75&&b<=-32;if(!brazil(lat,lng)&&brazil(lng,lat))[lat,lng]=[lng,lat];return{lat,lng:Number(lng)}}
function valid(p){return Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&p.lat>=-90&&p.lat<=90&&p.lng>=-180&&p.lng<=180}
async function config(force=false){if(runtime.config&&!force)return runtime.config;const response=await fetch('/api/public/maps-config',{cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||'Não foi possível ler a configuração do mapa.');runtime.config=data.item||{};return runtime.config}
async function ensureGoogle(){
  if(window.google?.maps?.Map)return config();
  if(runtime.google)return runtime.google;
  runtime.google=(async()=>{
    const cfg=await config();
    if(cfg.provider!=='google'||!cfg.enabled||!cfg.api_key)throw new Error('Cadastre uma chave Google Maps para navegador no Administrador Master.');
    const existing=document.querySelector('script[data-chegaja-google-maps],script[src*="maps.googleapis.com/maps/api/js"]');
    if(existing){await new Promise((resolve,reject)=>{const started=Date.now(),check=()=>window.google?.maps?.Map?resolve():Date.now()-started>7000?reject(new Error('Google Maps não respondeu.')):setTimeout(check,100);check()});return cfg}
    await new Promise((resolve,reject)=>{
      const callback=`__chegajaGoogle${Date.now()}`;const timeout=setTimeout(()=>{delete window[callback];reject(new Error('Tempo esgotado ao carregar o Google Maps.'))},7000);
      window[callback]=()=>{clearTimeout(timeout);delete window[callback];resolve()};
      const script=document.createElement('script');script.dataset.chegajaGoogleMaps='1';script.async=true;script.defer=true;script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.api_key)}&v=weekly&libraries=places&language=pt-BR&region=BR&callback=${callback}`;script.onerror=()=>{clearTimeout(timeout);delete window[callback];reject(new Error('Chave Google bloqueada, sem faturamento ou domínio não autorizado.'))};document.head.appendChild(script);
    });return cfg;
  })();
  try{return await runtime.google}catch(error){runtime.google=null;runtime.lastError=String(error?.message||error);throw error}
}
function geometryPoints(raw){let value=raw;try{if(typeof value==='string')value=JSON.parse(value)}catch{return[]}if(value?.type==='Feature')value=value.geometry;if(value?.type==='LineString')value=value.coordinates;if(value?.type==='MultiLineString')value=(value.coordinates||[]).flat();if(!Array.isArray(value))return[];return value.map(item=>{if(Array.isArray(item)){const a=Number(item[0]),b=Number(item[1]),asLatLng=point(a,b),asGeo=point(b,a),brazil=p=>p.lat>=-35&&p.lat<=7&&p.lng>=-75&&p.lng<=-32;return brazil(asGeo)&&!brazil(asLatLng)?asGeo:asLatLng}return point(item)}).filter(valid)}
function photoIcon(url,label='CJ'){
  const html=url?`<div class="cj191-photo-marker"><img src="${escapeHtml(url)}" alt=""><i></i></div>`:`<div class="cj191-letter-marker">${escapeHtml(label).slice(0,2)}</div>`;
  return L.divIcon({className:'cj191-leaflet-icon',html,iconSize:[38,46],iconAnchor:[19,43]});
}
function createLeafletMap(host,options={}){
  if(typeof L==='undefined')throw new Error('Mapa de contingência indisponível.');
  host.replaceChildren();host.classList.add('cj191-leaflet-host');
  const center=point(options.center||[-5.7945,-35.211]);
  const map=L.map(host,{zoomControl:true,attributionControl:true}).setView(valid(center)?[center.lat,center.lng]:[-5.7945,-35.211],Number(options.zoom||13));
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'Mapa de contingência © OpenStreetMap'}).addTo(map);
  const groups=new Map();
  const remember=(group,item)=>{const key=group||'default';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);return item};
  const adapter={provider:'contingency',raw:map,host,error:runtime.lastError,
    clearGroup(group){for(const item of groups.get(group)||[])try{map.removeLayer(item)}catch{}groups.delete(group)},
    addMarker(value,opt={}){const p=point(value);if(!valid(p))return null;const marker=L.marker([p.lat,p.lng],{icon:photoIcon(opt.photo,opt.label||'CJ')}).addTo(map);if(opt.title||opt.popup)marker.bindPopup(opt.popup||escapeHtml(opt.title||''));return remember(opt.group,marker)},
    addCircleMarker(value,opt={}){return adapter.addMarker(value,opt)},
    addPolyline(values,opt={}){const points=(values||[]).map(point).filter(valid).map(p=>[p.lat,p.lng]);if(!points.length)return null;return remember(opt.group,L.polyline(points,{color:opt.color||'#0D257A',weight:Number(opt.weight||6),opacity:Number(opt.opacity??.9)}).addTo(map))},
    addGeoJSON(raw,opt={}){return adapter.addPolyline(geometryPoints(raw),opt)},
    setView(value,zoom){const p=point(value);if(valid(p))map.setView([p.lat,p.lng],zoom||map.getZoom())},panTo(value){const p=point(value);if(valid(p))map.panTo([p.lat,p.lng])},
    fitBounds(values,opt={}){const points=(values||[]).map(point).filter(valid).map(p=>[p.lat,p.lng]);if(points.length)map.fitBounds(points,{padding:[Number(opt.padding||35),Number(opt.padding||35)],maxZoom:Number(opt.maxZoom||17)})},
    on(event,handler){map.on(event,handler)},invalidateSize(){setTimeout(()=>map.invalidateSize(),0)},resize(){setTimeout(()=>map.invalidateSize(),0)},remove(){for(const key of [...groups.keys()])adapter.clearGroup(key);try{map.remove()}catch{}runtime.instances.delete(host.id||host);host.replaceChildren()}
  };
  runtime.instances.set(host.id||host,adapter);return adapter;
}
function svgPin(color,label){const text=escapeHtml(String(label||'').slice(0,2));return`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="42" height="52" viewBox="0 0 42 52"><path d="M21 1C10 1 1 10 1 21c0 15 20 30 20 30s20-15 20-30C41 10 32 1 21 1z" fill="${color}" stroke="#fff" stroke-width="3"/><circle cx="21" cy="20" r="10" fill="#fff"/><text x="21" y="24" text-anchor="middle" font-family="Arial" font-size="10" font-weight="800" fill="${color}">${text}</text></svg>`)}`}
function photoNode(url,label='CJ'){const node=document.createElement('div');node.className='cj180-map-photo';node.innerHTML=url?`<img src="${escapeHtml(url)}" alt=""><i></i>`:`<b>${escapeHtml(label).slice(0,2)}</b><i></i>`;return node}
async function createGoogleMap(host,options={}){
  await ensureGoogle();const center=point(options.center||[-5.7945,-35.211]);host.replaceChildren();host.classList.add('cj180-google-host');
  const map=new google.maps.Map(host,{center:valid(center)?center:{lat:-5.7945,lng:-35.211},zoom:Number(options.zoom||13),mapTypeControl:false,streetViewControl:false,fullscreenControl:options.fullscreenControl!==false,zoomControl:options.zoomControl!==false,gestureHandling:'greedy',clickableIcons:true});
  const groups=new Map(),info=new google.maps.InfoWindow();
  class PhotoOverlay extends google.maps.OverlayView{constructor(position,node){super();this.position=position;this.node=node;this.setMap(map)}onAdd(){this.getPanes().overlayMouseTarget.appendChild(this.node)}draw(){const projection=this.getProjection();if(!projection)return;const pixel=projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position));if(pixel){this.node.style.left=`${pixel.x}px`;this.node.style.top=`${pixel.y}px`}}onRemove(){this.node.remove()}setPosition(position){this.position=position;this.draw()}}
  const remember=(group,item)=>{const key=group||'default';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);return item};
  const wrapMarker=(raw,position,group)=>{const wrapper={raw,setLatLng(value){const p=point(value);if(valid(p)){position=p;if(raw instanceof PhotoOverlay)raw.setPosition(p);else raw.setPosition(p)}return wrapper},getLatLng(){return[position.lat,position.lng]},bindPopup(html){const open=()=>{info.setContent(String(html||''));info.setPosition(position);info.open({map})};if(raw instanceof PhotoOverlay)raw.node.addEventListener('click',open);else raw.addListener('click',open);return wrapper},remove(){raw.setMap(null)}};return remember(group,wrapper)};
  const adapter={provider:'google',raw:map,host,
    clearGroup(group){for(const item of groups.get(group)||[])try{item.remove?.()}catch{}groups.delete(group)},
    addMarker(value,opt={}){const p=point(value);if(!valid(p))return null;const photo=opt.photo||(String(opt.label||'')==='EU'?window.ChegaJaCurrentDriverPhoto:null)||window.ChegaJaDriverPhotosByName?.[String(opt.title||'')];let raw;if(photo)raw=new PhotoOverlay(p,photoNode(photo,opt.label||'CJ'));else raw=new google.maps.Marker({map,position:p,title:opt.title||'',icon:{url:svgPin(opt.color||'#0D257A',opt.label||''),scaledSize:new google.maps.Size(42,52),anchor:new google.maps.Point(21,50)}});const wrapped=wrapMarker(raw,p,opt.group||'default');if(opt.popup)wrapped.bindPopup(opt.popup);return wrapped},
    addCircleMarker(value,opt={}){return adapter.addMarker(value,opt)},addPolyline(values,opt={}){const path=(values||[]).map(point).filter(valid);if(!path.length)return null;const raw=new google.maps.Polyline({map,path,strokeColor:opt.color||'#0D257A',strokeWeight:Number(opt.weight||6),strokeOpacity:Number(opt.opacity??.9)});const wrapped={raw,remove(){raw.setMap(null)}};return remember(opt.group||'default',wrapped)},addGeoJSON(raw,opt={}){return adapter.addPolyline(geometryPoints(raw),opt)},setView(value,zoom){const p=point(value);if(valid(p))map.setCenter(p);if(zoom!=null)map.setZoom(Number(zoom))},panTo(value){const p=point(value);if(valid(p))map.panTo(p)},fitBounds(values,opt={}){const pts=(values||[]).map(point).filter(valid);if(!pts.length)return;const bounds=new google.maps.LatLngBounds();pts.forEach(p=>bounds.extend(p));map.fitBounds(bounds,Number(opt.padding||45));google.maps.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>Number(opt.maxZoom||17))map.setZoom(Number(opt.maxZoom||17))})},on(event,handler){return google.maps.event.addListener(map,event,handler)},invalidateSize(){google.maps.event.trigger(map,'resize')},resize(){google.maps.event.trigger(map,'resize')},remove(){for(const key of [...groups.keys()])adapter.clearGroup(key);runtime.instances.delete(host.id||host);host.replaceChildren()}};
  runtime.instances.set(host.id||host,adapter);return adapter;
}
async function createMap(hostOrId,options={}){const host=typeof hostOrId==='string'?document.getElementById(hostOrId):hostOrId;if(!host)throw new Error('Área do mapa não encontrada.');try{return await createGoogleMap(host,options)}catch(error){runtime.lastError=String(error?.message||error);return createLeafletMap(host,options)}}
window.ChegaJaMaps={config,ensureGoogle,createMap,instances:runtime.instances,geometryPoints,point,lastError:()=>runtime.lastError};
})();
