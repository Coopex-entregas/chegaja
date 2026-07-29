/* ChegaJá 14.20.1 — Leaflet nos mapas visíveis; Google somente em endereços */
(()=>{
'use strict';
if(window.__cj201Operational)return;window.__cj201Operational=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const point=(a,b)=>Array.isArray(a)?{lat:Number(a[0]),lng:Number(a[1])}:{lat:Number(a?.lat??a?.latitude??a),lng:Number(a?.lng??a?.longitude??b)};
const runtime={instances:new Map(),est:null,estHost:null,estLayer:null,estTimer:null};
function photoIcon(url,name='CJ',size=34){const initials=String(name||'CJ').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();return L.divIcon({className:'cj201-photo-icon',html:`<span style="--s:${size}px">${url?`<img src="${esc(url)}" alt="">`:`<b>${esc(initials||'CJ')}</b>`}</span>`,iconSize:[size,size],iconAnchor:[size/2,size/2]})}
function geometry(raw){let data=raw;try{if(typeof data==='string')data=JSON.parse(data)}catch{return[]}if(data?.type==='Feature')data=data.geometry;if(data?.type==='LineString')data=data.coordinates;if(data?.type==='MultiLineString')data=(data.coordinates||[]).flat();if(!Array.isArray(data))return[];return data.map(item=>{if(!Array.isArray(item))return null;const a=Number(item[0]),b=Number(item[1]);return Math.abs(a)<=35&&Math.abs(b)>=32?[a,b]:[b,a]}).filter(item=>Number.isFinite(item?.[0])&&Number.isFinite(item?.[1]))}
function createLeaflet(host,options={}){
 if(!host||typeof L==='undefined')throw new Error('Mapa Leaflet indisponível.');
 const old=runtime.instances.get(host);if(old)try{old.remove()}catch{}
 host.replaceChildren();host.classList.remove('cj180-google-host','gm-style');host.classList.add('cj201-leaflet-host');
 const center=point(options.center||[-5.7945,-35.211]);
 const map=L.map(host,{zoomControl:options.zoomControl!==false,attributionControl:true,preferCanvas:true,zoomSnap:.5}).setView(valid(center)?[center.lat,center.lng]:[-5.7945,-35.211],Number(options.zoom||13));
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,updateWhenIdle:true,keepBuffer:5,attribution:'© OpenStreetMap'}).addTo(map);
 const groups=new Map();const remember=(group,item)=>{const key=group||'default';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);return item};
 const adapter={provider:'leaflet',raw:map,host,
  clearGroup(group){for(const item of groups.get(group)||[])try{map.removeLayer(item)}catch{}groups.delete(group)},
  addMarker(value,opt={}){const p=point(value);if(!valid(p))return null;const marker=L.marker([p.lat,p.lng],{icon:photoIcon(opt.photo,opt.title||opt.label||'CJ',Number(opt.size||34)),title:opt.title||''}).addTo(map);if(opt.popup)marker.bindPopup(opt.popup);return remember(opt.group,marker)},
  addCircleMarker(value,opt={}){const p=point(value);if(!valid(p))return null;const marker=L.circleMarker([p.lat,p.lng],{radius:Number(opt.radius||8),weight:Number(opt.weight||3),color:opt.color||'#0d45d8',fillColor:opt.color||'#0d45d8',fillOpacity:1}).addTo(map);if(opt.popup)marker.bindPopup(opt.popup);return remember(opt.group,marker)},
  addPolyline(values,opt={}){const path=(values||[]).map(item=>point(item)).filter(valid).map(p=>[p.lat,p.lng]);if(!path.length)return null;return remember(opt.group,L.polyline(path,{color:opt.color||'#0d45d8',weight:Number(opt.weight||6),opacity:Number(opt.opacity??.85)}).addTo(map))},
  addGeoJSON(raw,opt={}){return adapter.addPolyline(geometry(raw),opt)},
  setView(value,zoom){const p=point(value);if(valid(p))map.setView([p.lat,p.lng],Number(zoom||map.getZoom()))},panTo(value){const p=point(value);if(valid(p))map.panTo([p.lat,p.lng])},
  fitBounds(values,opt={}){const pts=(values||[]).map(item=>point(item)).filter(valid).map(p=>[p.lat,p.lng]);if(pts.length)map.fitBounds(pts,{padding:[Number(opt.padding||35),Number(opt.padding||35)],maxZoom:Number(opt.maxZoom||16),animate:false})},
  invalidateSize(){setTimeout(()=>map.invalidateSize(false),0)},resize(){setTimeout(()=>map.invalidateSize(false),0)},on(event,fn){map.on(event,fn)},
  remove(){for(const key of [...groups.keys()])adapter.clearGroup(key);try{map.remove()}catch{}runtime.instances.delete(host)}
 };
 runtime.instances.set(host,adapter);setTimeout(()=>map.invalidateSize(false),80);return adapter;
}
function forceMapEngine(){
 if(!window.ChegaJaMaps)return;
 window.ChegaJaMaps.createMap=async(hostOrId,options={})=>{const host=typeof hostOrId==='string'?document.getElementById(hostOrId):hostOrId;if(!host)throw new Error('Área do mapa não encontrada.');return createLeaflet(host,options)};
}
function removeSoundButtons(){
 $$('button').forEach(button=>{if(/ativar sons|sons ativos/i.test(button.textContent||''))button.remove()});
}
async function api(path){const token=String(window.state?.token||localStorage.getItem('lg_token')||'');const response=await fetch(path,{headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);return data}
function ensureEstablishmentLeaflet(){
 const source=$('#cj14-est-map');if(!source||window.state?.user?.role!=='establishment'||window.state?.page!=='dashboard'){destroyEst();return}
 const parent=source.parentElement;if(!parent)return;parent.classList.add('cj201-map-parent');let host=$('.cj201-est-map',parent);
 if(!host){host=document.createElement('div');host.className='cj201-est-map';parent.appendChild(host)}
 source.style.visibility='hidden';
 if(runtime.estHost!==host){destroyEst();runtime.estHost=host;runtime.est=createLeaflet(host,{center:[-5.7945,-35.211],zoom:13,zoomControl:true});runtime.estLayer=L.layerGroup().addTo(runtime.est.raw)}
 refreshEstablishment();
}
async function refreshEstablishment(){
 if(!runtime.est||runtime.est.busy)return;runtime.est.busy=true;
 try{const [drivers,deliveries]=await Promise.all([api('/api/app/tenant/online-drivers'),api('/api/app/tenant/deliveries')]);runtime.estLayer.clearLayers();const points=[];
  for(const item of drivers.items||[]){if(Number(item.online)!==1)continue;const p=point(item.current_lat,item.current_lng);if(!valid(p))continue;points.push([p.lat,p.lng]);L.marker([p.lat,p.lng],{icon:photoIcon(item.photo_url,item.name,32)}).addTo(runtime.estLayer).bindPopup(`<strong>${esc(item.name||'Cooperado')}</strong><br>${esc(item.vehicle_plate||'Online')}`)}
  for(const item of deliveries.items||[]){if(['delivered','cancelled'].includes(String(item.status)))continue;for(const [lat,lng,label,color] of [[item.pickup_lat,item.pickup_lng,'Coleta','#16a05e'],[item.delivery_lat,item.delivery_lng,'Entrega','#ff643f']]){const p=point(lat,lng);if(!valid(p))continue;points.push([p.lat,p.lng]);L.circleMarker([p.lat,p.lng],{radius:7,weight:3,color,fillColor:color,fillOpacity:1}).addTo(runtime.estLayer).bindPopup(`<strong>${esc(item.display_code||'Entrega')}</strong><br>${label}`)}}
  if(!runtime.est.fitted&&points.length){runtime.est.raw.fitBounds(points,{padding:[35,35],maxZoom:15,animate:false});runtime.est.fitted=true}runtime.est.raw.invalidateSize(false)
 }catch{}finally{runtime.est.busy=false}
}
function destroyEst(){clearInterval(runtime.estTimer);runtime.estTimer=null;if(runtime.est)try{runtime.est.remove()}catch{}runtime.est=runtime.estHost=runtime.estLayer=null;$$('.cj201-est-map').forEach(node=>node.remove());const source=$('#cj14-est-map');if(source)source.style.visibility=''}
function tick(){forceMapEngine();removeSoundButtons();ensureEstablishmentLeaflet()}
function boot(){tick();setInterval(tick,1600);runtime.estTimer=setInterval(()=>{if(!document.hidden)refreshEstablishment()},6000);new MutationObserver(()=>requestAnimationFrame(tick)).observe(document.documentElement,{childList:true,subtree:true})}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();