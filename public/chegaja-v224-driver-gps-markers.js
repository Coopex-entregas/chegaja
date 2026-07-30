/* ChegaJá 14.29.8 — seta de navegação e ponto exato do GPS */
(()=>{
'use strict';
if(window.__CJ224_DRIVER_GPS_MARKERS_14298__)return;
window.__CJ224_DRIVER_GPS_MARKERS_14298__=true;

const G={map:null,arrow:null,position:null,last:null,heading:0,timer:null};
const isDriver=()=>window.state?.user?.role==='driver';
const valid=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;

function distance(a,b){
 if(!a||!b)return Infinity;
 const dLat=(b.lat-a.lat)*111320;
 const dLng=(b.lng-a.lng)*111320*Math.cos(a.lat*Math.PI/180);
 return Math.hypot(dLat,dLng);
}
function bearing(a,b){
 if(!a||!b)return null;
 const lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;
 const y=Math.sin(dLng)*Math.cos(lat2);
 const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
 const value=(Math.atan2(y,x)*180/Math.PI+360)%360;
 return Number.isFinite(value)?value:null;
}
function arrowIcon(){
 return L.divIcon({
  className:'cj224-nav-arrow-marker',
  html:'<span class="cj224-heading" aria-hidden="true"><svg viewBox="0 0 58 58"><path d="M29 2 L54 55 L29 43 L4 55 Z"/></svg></span>',
  iconSize:[58,58],
  iconAnchor:[29,46]
 });
}
function positionIcon(){
 return L.divIcon({
  className:'cj224-position-marker',
  html:'<span class="cj224-position-dot" aria-hidden="true"><i></i></span><b>VOCÊ</b>',
  iconSize:[72,42],
  iconAnchor:[36,10]
 });
}
function clear(){
 for(const layer of [G.arrow,G.position])if(layer)try{layer.remove()}catch{}
 G.arrow=G.position=null;G.map=null;
}
function ensure(){
 const map=window.ChegaJaDriverMap?.map;
 if(!map||typeof L==='undefined')return false;
 if(G.map!==map){clear();G.map=map}
 if(!G.last)return false;
 if(!G.arrow)G.arrow=L.marker([G.last.lat,G.last.lng],{icon:arrowIcon(),interactive:false,keyboard:false,zIndexOffset:1250}).addTo(map);
 if(!G.position)G.position=L.marker([G.last.lat,G.last.lng],{icon:positionIcon(),interactive:false,keyboard:false,zIndexOffset:1300}).addTo(map);
 return true;
}
function rotate(){
 const node=G.arrow?.getElement?.()?.querySelector('.cj224-heading');
 if(node)node.style.transform=`rotate(${Number.isFinite(G.heading)?G.heading:0}deg)`;
}
function update(raw){
 const lat=Number(raw?.lat??raw?.latitude),lng=Number(raw?.lng??raw?.longitude);
 if(!valid(lat,lng))return;
 const next={lat,lng};
 const supplied=Number(raw?.heading);
 if(Number.isFinite(supplied)&&supplied>=0)G.heading=supplied;
 else if(G.last&&distance(G.last,next)>4){const derived=bearing(G.last,next);if(Number.isFinite(derived))G.heading=derived}
 G.last=next;
 if(!ensure())return;
 G.arrow.setLatLng([lat,lng]);
 G.position.setLatLng([lat,lng]);
 rotate();
}
function hook(){
 const api=window.ChegaJaDriverMap;
 if(!api||typeof api.move!=='function'||api.__cj224GpsMarkers)return;
 api.__cj224GpsMarkers=true;
 const original=api.move.bind(api);
 api.move=function(position){const result=original(position);update(position);return result};
}
function health(){
 if(!isDriver()||!document.body.classList.contains('cj199-driver')){clear();return}
 hook();
 const cached=window.ChegaJaLastDriverLocation;
 if(cached)update(cached);else ensure();
}
function boot(){
 clearInterval(G.timer);
 G.timer=setInterval(health,1000);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)health()});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();
