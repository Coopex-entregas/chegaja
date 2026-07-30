/* ChegaJá 14.30.0 — seta persistente, posição exata e bússola */
(()=>{
'use strict';
if(window.__CJ224_DRIVER_GPS_MARKERS_14300__)return;
window.__CJ224_DRIVER_GPS_MARKERS_14300__=true;

const G={map:null,arrow:null,position:null,last:null,heading:0,gpsHeading:null,compassHeading:null,compassAt:0,timer:null,permissionAsked:false};
const isDriver=()=>window.state?.user?.role==='driver';
const valid=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
const normalize=value=>((Number(value)||0)%360+360)%360;

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
 if(!G.arrow)G.arrow=L.marker([G.last.lat,G.last.lng],{icon:arrowIcon(),interactive:false,keyboard:false,zIndexOffset:1500}).addTo(map);
 if(!G.position)G.position=L.marker([G.last.lat,G.last.lng],{icon:positionIcon(),interactive:false,keyboard:false,zIndexOffset:1450}).addTo(map);
 G.arrow.bringToFront?.();G.position.bringToFront?.();
 return true;
}
function currentHeading(){
 if(G.compassHeading!=null&&Date.now()-G.compassAt<3500)return G.compassHeading;
 if(G.gpsHeading!=null)return G.gpsHeading;
 return G.heading;
}
function mapBearing(){
 const host=document.querySelector('#cj199-map');
 const value=Number.parseFloat(getComputedStyle(host||document.documentElement).getPropertyValue('--cj-map-bearing'));
 return Number.isFinite(value)?value:0;
}
function rotate(){
 const node=G.arrow?.getElement?.()?.querySelector('.cj224-heading');
 if(node)node.style.transform=`rotate(${normalize(currentHeading()-mapBearing())}deg)`;
}
function update(raw){
 const lat=Number(raw?.lat??raw?.latitude),lng=Number(raw?.lng??raw?.longitude);
 if(!valid(lat,lng))return;
 const next={lat,lng};
 const supplied=Number(raw?.heading);
 if(Number.isFinite(supplied)&&supplied>=0){G.gpsHeading=normalize(supplied);G.heading=G.gpsHeading}
 else if(G.last&&distance(G.last,next)>3){const derived=bearing(G.last,next);if(Number.isFinite(derived)){G.gpsHeading=derived;G.heading=derived}}
 G.last=next;
 if(!ensure())return;
 G.arrow.setLatLng([lat,lng]);
 G.position.setLatLng([lat,lng]);
 G.arrow.bringToFront?.();
 rotate();
}
function orientation(event){
 let heading=Number(event.webkitCompassHeading);
 if(!Number.isFinite(heading)){
  const alpha=Number(event.alpha);
  if(!Number.isFinite(alpha))return;
  heading=event.absolute===true?360-alpha:360-alpha;
 }
 G.compassHeading=normalize(heading);
 G.compassAt=Date.now();
 G.heading=G.compassHeading;
 rotate();
}
async function requestCompassPermission(){
 if(G.permissionAsked)return;
 G.permissionAsked=true;
 try{
  const request=window.DeviceOrientationEvent?.requestPermission;
  if(typeof request==='function'){
   const result=await request.call(window.DeviceOrientationEvent);
   if(result!=='granted')return;
  }
  window.addEventListener('deviceorientationabsolute',orientation,true);
  window.addEventListener('deviceorientation',orientation,true);
 }catch{}
}
function hook(){
 const api=window.ChegaJaDriverMap;
 if(!api||typeof api.move!=='function'||api.__cj224GpsMarkers)return;
 api.__cj224GpsMarkers=true;
 const original=api.move.bind(api);
 api.move=function(position){const result=original(position);update(position);return result};
}
function bindPermission(){
 if(document.documentElement.dataset.cj224CompassBound==='1')return;
 document.documentElement.dataset.cj224CompassBound='1';
 window.addEventListener('deviceorientationabsolute',orientation,true);
 window.addEventListener('deviceorientation',orientation,true);
 document.addEventListener('click',event=>{
  if(event.target?.closest?.('#cj199-start,#cj199-center,#cj199-map'))requestCompassPermission();
 },{capture:true,passive:true});
}
function health(){
 if(!isDriver()){clear();return}
 hook();
 const cached=window.ChegaJaLastDriverLocation;
 if(cached)update(cached);else if(G.last)ensure();
 rotate();
}
function boot(){
 bindPermission();
 clearInterval(G.timer);
 G.timer=setInterval(health,450);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)health()});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();
