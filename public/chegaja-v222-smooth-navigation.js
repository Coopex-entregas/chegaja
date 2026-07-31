/* ChegaJá 14.30.5 — navegação suave, centralização real, giroscópio móvel e rota azul */
(()=>{
'use strict';
if(window.__CJ222_SMOOTH_NAV_14305__)return;
window.__CJ222_SMOOTH_NAV_14305__=true;

const $=(s,r=document)=>r.querySelector(s);
const MOBILE=matchMedia('(pointer:coarse)').matches&&((navigator.maxTouchPoints||0)>0||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
const N={
 map:null,mapBound:null,rawSetView:null,rawPanTo:null,rawPanBy:null,
 route:null,routeKey:'',line:null,casing:null,detail:null,
 gps:null,lastGpsKey:'',speed:0,routeIndex:0,
 gpsHeading:null,gyroHeading:null,displayHeading:0,targetHeading:0,
 following:true,programmaticUntil:0,userUntil:0,lastCameraAt:0,
 arrow:null,recenter:null,lastFrame:0,raf:0,permissionAsked:false
};

const active=()=>window.ChegaJaDriverActiveDelivery||null;
const home=()=>window.state?.user?.role==='driver'&&window.state?.page==='dashboard'&&!!$('#cj199-app');
const valid=p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lng));
const norm=v=>((Number(v)||0)%360+360)%360;
const delta=(a,b)=>((norm(b)-norm(a)+540)%360)-180;

function distance(a,b){
 if(!valid(a)||!valid(b))return Infinity;
 const rad=x=>x*Math.PI/180,R=6371000;
 const dLat=rad(Number(b.lat)-Number(a.lat)),dLng=rad(Number(b.lng)-Number(a.lng));
 const q=Math.sin(dLat/2)**2+Math.cos(rad(Number(a.lat)))*Math.cos(rad(Number(b.lat)))*Math.sin(dLng/2)**2;
 return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
}
function bearing(a,b){
 if(!valid(a)||!valid(b))return null;
 const rad=x=>x*Math.PI/180,lat1=rad(Number(a.lat)),lat2=rad(Number(b.lat)),dLng=rad(Number(b.lng)-Number(a.lng));
 const y=Math.sin(dLng)*Math.cos(lat2);
 const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
 return norm(Math.atan2(y,x)*180/Math.PI);
}
function points(route=N.route){
 return(route?.geometry||[]).map(p=>Array.isArray(p)&&p.length>1?{lat:Number(p[0]),lng:Number(p[1])}:null).filter(valid);
}
function routeKey(list){
 if(list.length<2)return'';
 const a=list[0],b=list.at(-1);
 return`${list.length}:${a.lat.toFixed(5)}:${a.lng.toFixed(5)}:${b.lat.toFixed(5)}:${b.lng.toFixed(5)}`;
}
function currentGps(){
 const raw=window.ChegaJaLastDriverLocation;
 const p={lat:Number(raw?.lat??raw?.latitude),lng:Number(raw?.lng??raw?.longitude)};
 return valid(p)?p:N.gps;
}

function removeLines(){
 for(const layer of[N.line,N.casing])if(layer)try{layer.remove()}catch{}
 N.line=N.casing=null;
}
function removeCompetingLines(){
 if(!N.map||typeof L==='undefined')return;
 try{
  N.map.eachLayer(layer=>{
   if(layer?._cjSmoothRoute)return;
   if(!(layer instanceof L.Polyline)||layer instanceof L.Polygon)return;
   const color=String(layer.options?.color||'').toLowerCase(),weight=Number(layer.options?.weight||0);
   if(layer.options?.interactive===false&&weight>=6&&['#1459ff','#fff','#ffffff'].includes(color))N.map.removeLayer(layer);
  });
 }catch{}
}
function drawRoute(force=false){
 if(!N.map||!N.route||typeof L==='undefined')return;
 const list=points(),key=routeKey(list);
 if(!key)return;
 if(!force&&key===N.routeKey&&N.line&&N.casing)return;
 removeLines();N.routeKey=key;
 const latlngs=list.map(p=>[p.lat,p.lng]);
 N.casing=L.polyline(latlngs,{color:'#fff',weight:11,opacity:.96,lineCap:'round',lineJoin:'round',interactive:false,smoothFactor:.7}).addTo(N.map);
 N.line=L.polyline(latlngs,{color:'#1459ff',weight:7,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,smoothFactor:.7}).addTo(N.map);
 N.casing._cjSmoothRoute=N.line._cjSmoothRoute=true;
 removeCompetingLines();
 N.casing.bringToFront?.();N.line.bringToFront?.();
}

function nearestIndex(position){
 const list=points();if(list.length<2||!valid(position))return 0;
 const start=Math.max(0,N.routeIndex-15),end=Math.min(list.length-1,N.routeIndex+100);
 let best=start,bestD=Infinity;
 for(let i=start;i<=end;i++){const d=distance(position,list[i]);if(d<bestD){bestD=d;best=i}}
 if(bestD>100)for(let i=0;i<list.length;i+=Math.max(1,Math.floor(list.length/240))){const d=distance(position,list[i]);if(d<bestD){bestD=d;best=i}}
 N.routeIndex=best;return best;
}
function aheadPoint(position){
 const list=points();if(list.length<2)return null;
 let i=nearestIndex(position),remaining=Math.max(30,Math.min(90,38+N.speed*6)),previous=list[i];
 for(i+=1;i<list.length;i++){
  const part=distance(previous,list[i]);
  if(part>=remaining)return list[i];
  remaining-=part;previous=list[i];
 }
 return list.at(-1)||null;
}
function calculateHeading(){
 const ahead=aheadPoint(N.gps),routeHeading=ahead?bearing(N.gps,ahead):null;
 if(Number.isFinite(routeHeading))return routeHeading;
 if(Number.isFinite(N.gpsHeading))return norm(N.gpsHeading);
 if(MOBILE&&Number.isFinite(N.gyroHeading))return norm(N.gyroHeading);
 return N.displayHeading;
}

function ensureUi(){
 const app=$('#cj199-app');if(!app)return;
 if(!N.arrow||!N.arrow.isConnected){
  N.arrow=document.createElement('div');N.arrow.id='cj222-nav-arrow';N.arrow.setAttribute('aria-hidden','true');
  N.arrow.innerHTML='<span><svg viewBox="0 0 72 72"><path class="shadow" d="M36 4 62 66 36 54 10 66Z"/><path class="body" d="M36 7 58 61 36 51 14 61Z"/><path class="center" d="M36 16 44 51 36 47 28 51Z"/></svg></span>';
  app.appendChild(N.arrow);
 }
 if(!N.recenter||!N.recenter.isConnected){
  N.recenter=document.createElement('button');N.recenter.id='cj222-recenter';N.recenter.type='button';N.recenter.setAttribute('aria-label','Centralizar navegação');
  N.recenter.innerHTML='<b>⌖</b><small>CENTRALIZAR</small>';app.appendChild(N.recenter);
 }
}

function mapZoom(){return Math.max(18,Math.min(19.5,Number(N.map?.getZoom?.()||18.5)))}
function exactCenter(force=true){
 if(!N.map)return;
 const gps=currentGps();if(!valid(gps))return;
 N.gps=gps;N.following=true;N.programmaticUntil=performance.now()+1200;N.userUntil=0;
 N.recenter?.classList.remove('show');$('#cj199-center')?.classList.remove('manual');
 try{N.map.stop?.()}catch{}
 try{N.map.invalidateSize(true)}catch{}
 const zoom=mapZoom();
 try{
  if(N.rawSetView)N.rawSetView([gps.lat,gps.lng],zoom,{animate:false,noMoveStart:true,cjSmoothNav:true});
  else N.map.setView([gps.lat,gps.lng],zoom,{animate:false,noMoveStart:true,cjSmoothNav:true});
 }catch{
  try{N.map._resetView?.(L.latLng(gps.lat,gps.lng),zoom,false)}catch{}
 }
 requestAnimationFrame(()=>{
  try{N.map.invalidateSize(true)}catch{}
  try{N.rawSetView?.([gps.lat,gps.lng],zoom,{animate:false,noMoveStart:true,cjSmoothNav:true})}catch{}
  requestAnimationFrame(()=>{try{N.map.invalidateSize(false)}catch{}});
 });
}
function smoothFollow(){
 if(!N.map||!N.following||!active()||!valid(N.gps))return;
 const now=performance.now();if(now-N.lastCameraAt<420)return;N.lastCameraAt=now;N.programmaticUntil=now+900;
 try{
  N.rawPanTo?.([N.gps.lat,N.gps.lng],{animate:true,duration:.52,easeLinearity:.18,noMoveStart:true,cjSmoothNav:true});
 }catch{}
}

function patchMap(){
 if(!N.map||N.map.__cjSmooth14305)return;
 N.map.__cjSmooth14305=true;
 N.rawSetView=N.map.setView.bind(N.map);
 N.rawPanTo=typeof N.map.panTo==='function'?N.map.panTo.bind(N.map):null;
 N.rawPanBy=typeof N.map.panBy==='function'?N.map.panBy.bind(N.map):null;
 const allowed=opt=>Boolean(opt?.cjSmoothNav||performance.now()<N.userUntil||!active());
 N.map.setView=function(center,zoom,opt={}){if(!allowed(opt))return this;return N.rawSetView(center,zoom,opt)};
 if(N.rawPanTo)N.map.panTo=function(center,opt={}){if(!allowed(opt))return this;return N.rawPanTo(center,opt)};
 if(N.rawPanBy)N.map.panBy=function(offset,opt={}){if(!allowed(opt))return this;return N.rawPanBy(offset,opt)};
 const manual=()=>{
  if(!active()||performance.now()<N.programmaticUntil)return;
  N.following=false;N.recenter?.classList.add('show');$('#cj199-center')?.classList.add('manual');
 };
 N.map.on('dragstart',manual);N.map.on('zoomstart',manual);
 const container=N.map.getContainer?.();
 const user=()=>{N.userUntil=performance.now()+2500};
 container?.addEventListener('pointerdown',user,{passive:true});container?.addEventListener('wheel',user,{passive:true});
}
function attachMap(){
 const map=window.ChegaJaDriverMap?.map;if(!map)return false;
 if(N.map!==map){N.map=map;N.mapBound=map;N.rawSetView=N.rawPanTo=N.rawPanBy=null;patchMap();setTimeout(()=>{try{map.invalidateSize(true)}catch{}},40)}
 patchMap();removeCompetingLines();drawRoute();return true;
}

function updateGps(raw=window.ChegaJaLastDriverLocation){
 const gps={lat:Number(raw?.lat??raw?.latitude),lng:Number(raw?.lng??raw?.longitude)};if(!valid(gps))return;
 const key=`${gps.lat.toFixed(6)}:${gps.lng.toFixed(6)}`;
 N.speed=Number(raw?.speed)||0;
 const supplied=Number(raw?.heading);N.gpsHeading=Number.isFinite(supplied)&&supplied>=0?norm(supplied):N.gpsHeading;
 if(key===N.lastGpsKey)return;
 N.lastGpsKey=key;N.gps=gps;N.targetHeading=calculateHeading();smoothFollow();
}

function screenAngle(){const x=Number(screen.orientation?.angle??window.orientation??0);return Number.isFinite(x)?x:0}
function orientation(event){
 if(!MOBILE)return;
 let heading=Number(event.webkitCompassHeading);
 if(!Number.isFinite(heading)&&Number.isFinite(Number(event.alpha)))heading=norm(360-Number(event.alpha)+screenAngle());
 if(!Number.isFinite(heading))return;
 N.gyroHeading=Number.isFinite(N.gyroHeading)?norm(N.gyroHeading+delta(N.gyroHeading,heading)*.14):heading;
 if(!points().length&&!Number.isFinite(N.gpsHeading))N.targetHeading=N.gyroHeading;
}
function listenOrientation(){window.addEventListener('deviceorientationabsolute',orientation,true);window.addEventListener('deviceorientation',orientation,true)}
async function askOrientation(){
 if(!MOBILE||N.permissionAsked)return;N.permissionAsked=true;
 try{
  const request=window.DeviceOrientationEvent?.requestPermission;
  if(typeof request==='function'&&(await request.call(window.DeviceOrientationEvent))!=='granted')return;
  listenOrientation();
 }catch{}
}

function navigation(event){
 const detail=event.detail||null;N.detail=detail;
 if(detail?.route){N.route=detail.route;N.routeKey='';N.routeIndex=0;N.following=true;drawRoute(true);updateGps();N.targetHeading=calculateHeading();setTimeout(()=>exactCenter(true),20)}
 else if(!active()){N.route=null;N.routeKey='';removeLines();N.arrow?.classList.remove('show')}
}
function animate(now){
 const dt=Math.min(50,Math.max(8,now-(N.lastFrame||now)));N.lastFrame=now;
 const alpha=1-Math.exp(-dt/145);N.displayHeading=norm(N.displayHeading+delta(N.displayHeading,N.targetHeading)*alpha);
 const show=Boolean(home()&&active()&&N.route);
 if(N.arrow){N.arrow.style.setProperty('--cj222-heading',`${N.displayHeading}deg`);N.arrow.classList.toggle('show',show)}
 document.body.classList.toggle('cj222-navigation',show);
 N.raf=requestAnimationFrame(animate);
}
function tick(){
 if(!home())return;
 ensureUi();attachMap();updateGps();
 if(active()){removeCompetingLines();drawRoute()}else{N.route=null;N.routeKey='';removeLines()}
}

window.addEventListener('cj:driver-navigation',navigation);
document.addEventListener('click',event=>{
 const button=event.target?.closest?.('#cj222-recenter,#cj199-center');
 if(!button)return;
 event.preventDefault();event.stopImmediatePropagation();askOrientation();exactCenter(true);
},{capture:true});
document.addEventListener('pointerup',event=>{if(MOBILE&&event.target?.closest?.('#cj199-app'))askOrientation()},{capture:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();setTimeout(()=>exactCenter(false),80)}});
window.addEventListener('orientationchange',()=>setTimeout(()=>{try{N.map?.invalidateSize(true)}catch{};if(N.following)exactCenter(false)},250));
setInterval(tick,150);
N.raf=requestAnimationFrame(animate);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
})();
