/* ChegaJá 14.32.0 — motor único Leaflet/OpenStreetMap, persistente e sem Google */
(()=>{
'use strict';
if(window.__cjLeafletOnly14320)return;
window.__cjLeafletOnly14320=true;

const instances=new Map();
const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const initials=name=>String(name||'CJ').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'CJ';

function point(value,lng){
 let lat;
 if(Array.isArray(value)){lat=Number(value[0]);lng=Number(value[1])}
 else if(value&&typeof value==='object'){lat=Number(value.lat??value.latitude);lng=Number(value.lng??value.longitude)}
 else lat=Number(value);
 const brazil=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=-35&&a<=7&&b>=-75&&b<=-32;
 if(!brazil(lat,lng)&&brazil(Number(lng),lat))[lat,lng]=[Number(lng),lat];
 return{lat,lng:Number(lng)};
}
const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
function geometryPoints(raw){
 let value=raw;
 for(let i=0;i<2&&typeof value==='string';i++){try{value=JSON.parse(value)}catch{return[]}}
 if(value?.type==='Feature')value=value.geometry;
 if(value?.type==='LineString')value=value.coordinates;
 if(value?.type==='MultiLineString')value=(value.coordinates||[]).flat();
 if(!Array.isArray(value))return[];
 return value.map(item=>Array.isArray(item)?point(Number(item[1]),Number(item[0])):point(item)).filter(valid);
}
function statusClass(opt={}){
 const status=String(opt.status||'').toLowerCase();
 if(opt.base||status==='base')return'base';
 if(opt.delivering||['in_route','picked_up','delivery','em_entrega'].includes(status))return'delivery';
 if(opt.online===false||status==='offline')return'offline';
 return'online';
}
function baseDriverMeta(opt={}){
 const name=String(opt.title||opt.name||'').trim();if(!name)return null;
 const items=window.ChegaJaBasePhotos?.items?.()||[];
 const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
 return items.find(item=>norm(item?.name)===norm(name))||null;
}
function markerHtml(opt={}){
 const name=String(opt.title||opt.name||opt.label||'CJ'),meta=baseDriverMeta(opt),photo=String(opt.photo||opt.photo_url||meta?.photo_url||meta?.url||'').trim();
 const base=Boolean(opt.base||String(opt.label||'').toUpperCase()==='B'&&/base/i.test(name));
 const state=statusClass({...opt,online:opt.online??(meta?Number(meta.online)===1:undefined),delivering:opt.delivering??Boolean(Number(meta?.active_delivery_count||0))}),label=initials(name);
 if(base)return`<span class="cj-map-base-marker"><b>Base</b><i></i></span>`;
 return `<span class="cj-map-driver-marker ${state}">${photo?`<img src="${esc(photo)}" alt=""><b>${esc(label)}</b>`:`<b>${esc(label)}</b>`}<i></i></span>`;
}
function enrichedPopup(opt={}){
 const meta=baseDriverMeta(opt);if(!meta)return opt.popup?String(opt.popup):'';
 const updated=meta.location_updated_at?new Date(meta.location_updated_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
 const accuracy=Number.isFinite(Number(meta.location_accuracy))?`${Math.round(Number(meta.location_accuracy))} m`:'—';
 const queue=Number(meta.queue_position||0)>0?` • ${Number(meta.queue_position)}º na fila`:'';
 return `<section class="cj-map-card"><strong>${esc(meta.name||opt.title||'Cooperado')}</strong><span>${Number(meta.online)===1?'Online':'Offline'}${queue}</span><small>Atualizado: ${esc(updated)} • Precisão: ${esc(accuracy)}</small></section>`;
}
function layerKey(type,opt={},fallback='item'){
 return String(opt.key??opt.id??opt.driver_id??opt.delivery_id??opt.title??opt.name??`${type}:${fallback}`);
}
function isFinePointer(){return matchMedia?.('(pointer:fine)')?.matches===true}
function bindPopupBehavior(marker,opt={}){
 const popup=enrichedPopup(opt);if(!popup)return;
 marker.bindPopup(popup,{closeButton:false,autoPan:false,className:'cj-map-popup'});
 if(isFinePointer()){
  marker.on('mouseover',()=>marker.openPopup());
  marker.on('mouseout',()=>marker.closePopup());
 }
}
function installImageFallback(marker){
 requestAnimationFrame(()=>{
  const el=marker?.getElement?.(),img=el?.querySelector?.('img');
  if(!img||img.dataset.cjFallback)return;
  img.dataset.cjFallback='1';
  img.addEventListener('error',()=>el.classList.add('image-error'),{once:true});
 });
}
function createMap(hostOrId,options={}){
 const host=typeof hostOrId==='string'?document.getElementById(hostOrId):hostOrId;
 if(!host)throw new Error('Área do mapa não encontrada.');
 if(!window.L)throw new Error('Leaflet não carregado.');
 const previous=instances.get(host);
 if(previous&&previous.raw?._container===host){
  previous.invalidateSize();
  return Promise.resolve(previous);
 }
 if(previous)try{previous.remove()}catch{}
 host.replaceChildren();host.classList.remove('gm-style');host.classList.add('cj-leaflet-only');
 const center=point(options.center||[-5.7945,-35.211]);
 const map=L.map(host,{zoomControl:options.zoomControl!==false,attributionControl:true,preferCanvas:true,zoomSnap:.5,zoomDelta:.5,fadeAnimation:false,markerZoomAnimation:false}).setView(valid(center)?[center.lat,center.lng]:[-5.7945,-35.211],Number(options.zoom||13));
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,maxNativeZoom:19,updateWhenIdle:true,keepBuffer:6,attribution:'© OpenStreetMap'}).addTo(map);

 const groups=new Map();
 let manual=false,programmatic=false,resizeObserver=null;
 const group=(name='default')=>{if(!groups.has(name))groups.set(name,new Map());return groups.get(name)};
 const touch=(groupName,key,entry)=>{const items=group(groupName);items.set(key,entry);entry.stale=false;return entry.layer};
 const scheduleSweep=(groupName)=>{
  const items=group(groupName);
  clearTimeout(items._timer);
  items._timer=setTimeout(()=>{for(const [key,entry] of [...items]){if(entry?.stale){try{entry.layer.remove()}catch{}items.delete(key)}}},180);
 };
 map.on('dragstart zoomstart',()=>{if(!programmatic)manual=true});
 map.on('click',()=>map.closePopup?.());

 const adapter={provider:'leaflet',raw:map,host,
  clearGroup(groupName='default'){
   const items=group(groupName);
   for(const entry of items.values())if(entry&&entry.layer)entry.stale=true;
   scheduleSweep(groupName);
  },
  removeGroup(groupName='default'){
   const items=groups.get(groupName);if(!items)return;
   clearTimeout(items._timer);for(const entry of items.values())try{entry.layer.remove()}catch{}
   groups.delete(groupName);
  },
  addMarker(value,opt={}){
   const p=point(value);if(!valid(p))return null;
   const groupName=opt.group||'default',key=layerKey('marker',opt,`${p.lat}:${p.lng}`),items=group(groupName),existing=items.get(key);
   const icon=L.divIcon({className:'cj-leaflet-icon',html:markerHtml(opt),iconSize:opt.base?[44,50]:[40,46],iconAnchor:opt.base?[22,46]:[20,40]});
   if(existing?.kind==='marker'){
    existing.layer.setLatLng([p.lat,p.lng]);existing.layer.setIcon(icon);existing.stale=false;
    if(opt.popup||baseDriverMeta(opt)){const popup=enrichedPopup(opt);if(existing.layer.getPopup())existing.layer.setPopupContent(popup);else bindPopupBehavior(existing.layer,opt)}
    installImageFallback(existing.layer);return existing.layer;
   }
   const marker=L.marker([p.lat,p.lng],{icon,title:opt.title||opt.name||'',keyboard:false,zIndexOffset:Number(opt.zIndexOffset||0)}).addTo(map);
   bindPopupBehavior(marker,opt);installImageFallback(marker);
   return touch(groupName,key,{kind:'marker',layer:marker,stale:false});
  },
  addCircleMarker(value,opt={}){
   const p=point(value);if(!valid(p))return null;
   const groupName=opt.group||'default',key=layerKey('circle',opt,`${p.lat}:${p.lng}`),items=group(groupName),existing=items.get(key);
   const style={radius:Number(opt.radius||8),color:opt.color||'#0D45D8',fillColor:opt.fillColor||opt.color||'#0D45D8',fillOpacity:Number(opt.fillOpacity??1),weight:Number(opt.weight||3)};
   if(existing?.kind==='circle'){existing.layer.setLatLng([p.lat,p.lng]);existing.layer.setStyle(style);existing.stale=false;if(opt.popup||baseDriverMeta(opt)){const popup=enrichedPopup(opt);if(existing.layer.getPopup())existing.layer.setPopupContent(popup);else bindPopupBehavior(existing.layer,opt)}return existing.layer}
   const marker=L.circleMarker([p.lat,p.lng],style).addTo(map);bindPopupBehavior(marker,opt);
   return touch(groupName,key,{kind:'circle',layer:marker,stale:false});
  },
  addPolyline(values,opt={}){
   const path=(values||[]).map(v=>point(v)).filter(valid).map(p=>[p.lat,p.lng]);if(path.length<2)return null;
   const groupName=opt.group||'default',key=layerKey('line',opt,'route'),items=group(groupName),existing=items.get(key);
   const style={color:opt.color||'#0D45D8',weight:Number(opt.weight||6),opacity:Number(opt.opacity??.9),lineCap:'round',lineJoin:'round',interactive:Boolean(opt.interactive)};
   if(existing?.kind==='line'){existing.layer.setLatLngs(path);existing.layer.setStyle(style);existing.stale=false;return existing.layer}
   return touch(groupName,key,{kind:'line',layer:L.polyline(path,style).addTo(map),stale:false});
  },
  addGeoJSON(raw,opt={}){return adapter.addPolyline(geometryPoints(raw),opt)},
  setView(value,zoom,opt={}){
   const p=point(value);if(!valid(p))return;
   programmatic=true;map.setView([p.lat,p.lng],Number(zoom||map.getZoom()),{animate:false});setTimeout(()=>programmatic=false,80);
   if(opt.follow===true)manual=false;
  },
  panTo(value,opt={}){
   const p=point(value);if(!valid(p)||manual&&!opt.force)return;
   programmatic=true;map.panTo([p.lat,p.lng],{animate:false});setTimeout(()=>programmatic=false,80);
  },
  fitBounds(values,opt={}){
   if(manual&&!opt.force)return;
   const pts=(values||[]).map(v=>point(v)).filter(valid).map(p=>[p.lat,p.lng]);if(!pts.length)return;
   programmatic=true;map.fitBounds(pts,{padding:[Number(opt.padding||35),Number(opt.padding||35)],maxZoom:Number(opt.maxZoom||17),animate:false});setTimeout(()=>programmatic=false,100);
  },
  setFollow(enabled=true){manual=!enabled},
  isManual(){return manual},
  on(event,handler){map.on(event,handler)},
  invalidateSize(){requestAnimationFrame(()=>map.invalidateSize(false))},
  resize(){requestAnimationFrame(()=>map.invalidateSize(false))},
  remove(){
   try{resizeObserver?.disconnect?.()}catch{}
   for(const name of [...groups.keys()])adapter.removeGroup(name);
   try{map.remove()}catch{}instances.delete(host);if(host.isConnected)host.replaceChildren();
  }
 };
 if(typeof ResizeObserver!=='undefined'){resizeObserver=new ResizeObserver(()=>adapter.invalidateSize());resizeObserver.observe(host)}
 instances.set(host,adapter);requestAnimationFrame(()=>requestAnimationFrame(()=>map.invalidateSize(false)));
 return Promise.resolve(adapter);
}

const engine={
 config:async()=>({provider:'openstreetmap',enabled:true,api_key:null,map_id:null}),
 ensureGoogle:async()=>{throw new Error('OPENSTREETMAP_SELECTED')},
 createMap,instances,geometryPoints,geoPoints:geometryPoints,point,
 reset(){},
 testBrowser:async()=>({provider:'openstreetmap',enabled:true,api_key:null,map_id:null})
};
window.ChegaJaLeafletEngine=engine;
window.ChegaJaMaps=engine;
})();