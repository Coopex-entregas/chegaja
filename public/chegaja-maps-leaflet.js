/* ChegaJá 14.21.0 — motor único Leaflet; Google não é carregado no navegador */
(()=>{
'use strict';
if(window.__cjLeafletOnly)return;
window.__cjLeafletOnly=true;
const instances=new Map();
const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function point(value,lng){let lat;if(Array.isArray(value)){lat=Number(value[0]);lng=Number(value[1])}else if(value&&typeof value==='object'){lat=Number(value.lat??value.latitude);lng=Number(value.lng??value.longitude)}else lat=Number(value);const brazil=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=-35&&a<=7&&b>=-75&&b<=-32;if(!brazil(lat,lng)&&brazil(lng,lat))[lat,lng]=[lng,lat];return{lat,lng:Number(lng)}}
const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
function geometryPoints(raw){let value=raw;try{if(typeof value==='string')value=JSON.parse(value)}catch{return[]}if(value?.type==='Feature')value=value.geometry;if(value?.type==='LineString')value=value.coordinates;if(value?.type==='MultiLineString')value=(value.coordinates||[]).flat();if(!Array.isArray(value))return[];return value.map(item=>Array.isArray(item)?point(Number(item[1]),Number(item[0])):point(item)).filter(valid)}
function markerHtml(opt={}){const photo=String(opt.photo||'').trim(),label=String(opt.label||'CJ').slice(0,2);return photo?`<span class="cj-leaflet-photo"><img src="${esc(photo)}" alt=""><i></i></span>`:`<span class="cj-leaflet-pin" style="--pin:${esc(opt.color||'#0D45D8')}">${esc(label)}</span>`}
function createMap(hostOrId,options={}){const host=typeof hostOrId==='string'?document.getElementById(hostOrId):hostOrId;if(!host)throw new Error('Área do mapa não encontrada.');if(!window.L)throw new Error('Leaflet não carregado.');const old=instances.get(host);if(old)try{old.remove()}catch{}host.replaceChildren();host.classList.add('gm-style','cj-leaflet-only');const center=point(options.center||[-5.7945,-35.211]);const map=L.map(host,{zoomControl:options.zoomControl!==false,attributionControl:true,preferCanvas:true,zoomSnap:.5,gestureHandling:false}).setView(valid(center)?[center.lat,center.lng]:[-5.7945,-35.211],Number(options.zoom||13));L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,updateWhenIdle:true,keepBuffer:5,attribution:'© OpenStreetMap'}).addTo(map);const groups=new Map();const remember=(group,item)=>{const key=group||'default';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);return item};const adapter={provider:'leaflet',raw:map,host,
 clearGroup(group){for(const item of groups.get(group)||[])try{map.removeLayer(item)}catch{}groups.delete(group)},
 addMarker(value,opt={}){const p=point(value);if(!valid(p))return null;const icon=L.divIcon({className:'cj-leaflet-icon',html:markerHtml(opt),iconSize:[42,48],iconAnchor:[21,44]});const marker=L.marker([p.lat,p.lng],{icon,title:opt.title||'',keyboard:false}).addTo(map);if(opt.popup)marker.bindPopup(String(opt.popup));return remember(opt.group,marker)},
 addCircleMarker(value,opt={}){const p=point(value);if(!valid(p))return null;const marker=L.circleMarker([p.lat,p.lng],{radius:Number(opt.radius||8),color:opt.color||'#0D45D8',fillColor:opt.color||'#0D45D8',fillOpacity:1,weight:Number(opt.weight||3)}).addTo(map);if(opt.popup)marker.bindPopup(String(opt.popup));return remember(opt.group,marker)},
 addPolyline(values,opt={}){const path=(values||[]).map(v=>point(v)).filter(valid).map(p=>[p.lat,p.lng]);if(path.length<2)return null;return remember(opt.group,L.polyline(path,{color:opt.color||'#0D45D8',weight:Number(opt.weight||6),opacity:Number(opt.opacity??.9)}).addTo(map))},
 addGeoJSON(raw,opt={}){return adapter.addPolyline(geometryPoints(raw),opt)},
 setView(value,zoom){const p=point(value);if(valid(p))map.setView([p.lat,p.lng],Number(zoom||map.getZoom()),{animate:false})},
 panTo(value){const p=point(value);if(valid(p))map.panTo([p.lat,p.lng],{animate:false})},
 fitBounds(values,opt={}){const pts=(values||[]).map(v=>point(v)).filter(valid).map(p=>[p.lat,p.lng]);if(pts.length)map.fitBounds(pts,{padding:[Number(opt.padding||35),Number(opt.padding||35)],maxZoom:Number(opt.maxZoom||17),animate:false})},
 on(event,handler){map.on(event,handler)},invalidateSize(){setTimeout(()=>map.invalidateSize(false),0)},resize(){setTimeout(()=>map.invalidateSize(false),0)},
 remove(){for(const key of [...groups.keys()])adapter.clearGroup(key);try{map.remove()}catch{}instances.delete(host);host.replaceChildren()}
};instances.set(host,adapter);setTimeout(()=>map.invalidateSize(false),60);return Promise.resolve(adapter)}
window.ChegaJaMaps={config:async()=>({provider:'leaflet',enabled:true,api_key:null,map_id:null}),ensureGoogle:async()=>{throw new Error('OPENSTREETMAP_SELECTED')},createMap,instances,geometryPoints,point};
})();
