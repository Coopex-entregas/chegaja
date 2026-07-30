/* ChegaJá 14.30.1 — seta persistente com bússola suave e sem giro completo */
(()=>{
'use strict';
if(window.__CJ224_DRIVER_GPS_MARKERS_14301__)return;
window.__CJ224_DRIVER_GPS_MARKERS_14301__=true;

const G={
 map:null,arrow:null,position:null,last:null,gpsHeading:null,compassHeading:null,
 targetAngle:0,displayAngle:0,mapBearing:0,animation:null,timer:null,
 permissionAsked:false,lastOrientationAt:0
};
const isDriver=()=>window.state?.user?.role==='driver';
const valid=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
const normalize=value=>((Number(value)||0)%360+360)%360;
const signed=value=>{const n=normalize(value);return n>180?n-360:n};
const shortestDelta=(from,to)=>signed(Number(to)-Number(from));
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
 const result=(Math.atan2(y,x)*180/Math.PI+360)%360;
 return Number.isFinite(result)?result:null;
}
function arrowIcon(){
 return L.divIcon({
  className:'cj224-nav-arrow-marker',
  html:'<span class="cj224-heading" aria-hidden="true"><svg viewBox="0 0 58 58"><path d="M29 2 L54 55 L29 43 L4 55 Z"/></svg></span>',
  iconSize:[58,58],iconAnchor:[29,46]
 });
}
function positionIcon(){
 return L.divIcon({
  className:'cj224-position-marker',
  html:'<span class="cj224-position-dot" aria-hidden="true"><i></i></span><b>VOCÊ</b>',
  iconSize:[72,42],iconAnchor:[36,10]
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
 if(G.compassHeading!=null)return G.compassHeading;
 if(G.gpsHeading!=null)return G.gpsHeading;
 return 0;
}
function setTarget(){
 const desired=normalize(currentHeading()-G.mapBearing);
 G.targetAngle=G.displayAngle+shortestDelta(normalize(G.displayAngle),desired);
 if(G.animation==null)G.animation=requestAnimationFrame(animateArrow);
}
function animateArrow(){
 G.animation=null;
 const node=G.arrow?.getElement?.()?.querySelector('.cj224-heading');
 const diff=G.targetAngle-G.displayAngle;
 if(Math.abs(diff)<.08)G.displayAngle=G.targetAngle;
 else G.displayAngle+=diff*.24;
 if(node)node.style.transform=`rotate(${G.displayAngle}deg)`;
 if(Math.abs(G.targetAngle-G.displayAngle)>=.08)G.animation=requestAnimationFrame(animateArrow);
}
function smoothCompass(next){
 const normalized=normalize(next);
 if(G.compassHeading==null)G.compassHeading=normalized;
 else G.compassHeading=normalize(G.compassHeading+shortestDelta(G.compassHeading,normalized)*.28);
 setTarget();
}
function update(raw){
 const lat=Number(raw?.lat??raw?.latitude),lng=Number(raw?.lng??raw?.longitude);
 if(!valid(lat,lng))return;
 const next={lat,lng};
 const supplied=Number(raw?.heading),speed=Number(raw?.speed);
 if(Number.isFinite(supplied)&&supplied>=0&&(Number.isFinite(speed)?speed>.7:true))G.gpsHeading=normalize(supplied);
 else if(G.last&&distance(G.last,next)>4){const derived=bearing(G.last,next);if(Number.isFinite(derived))G.gpsHeading=derived}
 G.last=next;
 if(!ensure())return;
 G.arrow.setLatLng([lat,lng]);
 G.position.setLatLng([lat,lng]);
 G.arrow.bringToFront?.();
 setTarget();
}
function screenAngle(){
 const value=Number(screen.orientation?.angle??window.orientation??0);
 return Number.isFinite(value)?value:0;
}
function orientation(event){
 const now=performance.now();
 if(now-G.lastOrientationAt<12)return;
 G.lastOrientationAt=now;
 let heading=Number(event.webkitCompassHeading);
 if(!Number.isFinite(heading)){
  const alpha=Number(event.alpha);
  if(!Number.isFinite(alpha)||event.absolute!==true)return;
  heading=normalize(360-alpha+screenAngle());
 }
 smoothCompass(heading);
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
 window.addEventListener('cj:driver-map-bearing',event=>{
  G.mapBearing=Number(event.detail?.bearing)||0;
  setTarget();
 });
 screen.orientation?.addEventListener?.('change',setTarget);
}
function health(){
 if(!isDriver()){clear();return}
 hook();
 const cached=window.ChegaJaLastDriverLocation;
 if(cached)update(cached);else if(G.last)ensure();
 setTarget();
}
function boot(){
 bindPermission();
 clearInterval(G.timer);G.timer=setInterval(health,800);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)health()});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();