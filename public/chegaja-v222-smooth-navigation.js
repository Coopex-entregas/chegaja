/* ChegaJá 14.31.1 — navegação móvel estável, seta geográfica, rota persistente e modo retrato */
(()=>{
'use strict';
if(window.__CJ222_STABLE_NAV_14311__)return;
window.__CJ222_STABLE_NAV_14311__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const MOBILE=matchMedia('(pointer:coarse)').matches&&((navigator.maxTouchPoints||0)>0||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
const S={
 map:null,route:null,points:[],routeKey:'',casing:null,line:null,marker:null,
 deliveryId:'',status:'',gps:null,cameraGps:null,lastGpsAt:0,speed:0,accuracy:Infinity,routeIndex:0,
 following:true,programmaticUntil:0,lastCameraAt:0,
 recenter:null,portraitLock:null,gpsHeading:null,gyroHeading:null,
 targetHeading:0,displayHeading:0,lastFrame:0,raf:0,orientationAsked:false,
 dispatchInstalled:false,originalDispatch:null,userInteracted:false,
 lastSpoken:'',lastSpokenAt:0,pendingSpeech:'',
 navBusy:false,lastNavFetch:0,lastNavSuccess:0
};

const active=()=>window.ChegaJaDriverActiveDelivery||null;
const home=()=>window.state?.user?.role==='driver'&&window.state?.page==='dashboard'&&!!$('#cj199-app');
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const valid=p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lng))&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lng))<=180;
const norm=value=>((Number(value)||0)%360+360)%360;
const angleDelta=(from,to)=>((norm(to)-norm(from)+540)%360)-180;
const point=(lat,lng)=>({lat:Number(lat),lng:Number(lng)});
const portrait=()=>innerHeight>=innerWidth;

function distance(a,b){
 if(!valid(a)||!valid(b))return Infinity;
 const rad=value=>value*Math.PI/180,R=6371000;
 const dLat=rad(Number(b.lat)-Number(a.lat)),dLng=rad(Number(b.lng)-Number(a.lng));
 const q=Math.sin(dLat/2)**2+Math.cos(rad(Number(a.lat)))*Math.cos(rad(Number(b.lat)))*Math.sin(dLng/2)**2;
 return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
}
function bearing(a,b){
 if(!valid(a)||!valid(b))return null;
 const rad=value=>value*Math.PI/180,lat1=rad(Number(a.lat)),lat2=rad(Number(b.lat)),dLng=rad(Number(b.lng)-Number(a.lng));
 const y=Math.sin(dLng)*Math.cos(lat2);
 const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
 const result=norm(Math.atan2(y,x)*180/Math.PI);
 return Number.isFinite(result)?result:null;
}
function currentRawGps(raw=window.ChegaJaLastDriverLocation){
 const gps=point(raw?.lat??raw?.latitude,raw?.lng??raw?.longitude);
 return valid(gps)?gps:null;
}
function targetPoint(){
 const item=active();if(!item)return null;
 const delivery=['picked_up','in_route','problem'].includes(String(item.status));
 const target=point(delivery?item.delivery_lat:item.pickup_lat,delivery?item.delivery_lng:item.pickup_lng);
 return valid(target)?target:null;
}

function decodePolyline(encoded,precision=5){
 if(typeof encoded!=='string'||encoded.length<4)return[];
 const coordinates=[];let index=0,lat=0,lng=0,factor=10**precision;
 try{
  while(index<encoded.length){
   let result=0,shift=0,byte;
   do{byte=encoded.charCodeAt(index++)-63;result|=(byte&31)<<shift;shift+=5}while(byte>=32&&index<=encoded.length);
   lat+=(result&1)?~(result>>1):(result>>1);
   result=0;shift=0;
   do{byte=encoded.charCodeAt(index++)-63;result|=(byte&31)<<shift;shift+=5}while(byte>=32&&index<=encoded.length);
   lng+=(result&1)?~(result>>1):(result>>1);
   coordinates.push([lat/factor,lng/factor]);
  }
 }catch{return[]}
 return coordinates;
}
function decodeGeometry(value){
 let raw=value;
 for(let i=0;i<3&&typeof raw==='string';i++){
  try{raw=JSON.parse(raw)}catch{return decodePolyline(raw)}
 }
 if(raw?.type==='Feature')raw=raw.geometry;
 if(raw?.geometry)raw=raw.geometry;
 if(raw?.coordinates)raw=raw.coordinates;
 const pairs=[];
 const walk=node=>{
  if(!Array.isArray(node))return;
  if(node.length>=2&&Number.isFinite(Number(node[0]))&&Number.isFinite(Number(node[1]))){pairs.push([Number(node[0]),Number(node[1])]);return}
  for(const child of node)walk(child);
 };
 walk(raw);
 return pairs;
}
function rawGeometry(route){
 return decodeGeometry(route?.geometry??route?.geojson??route?.path??route?.coordinates??route??[]);
}
function candidate(raw,swap=false){
 const list=[];
 for(const item of raw){
  const p=swap?point(item[1],item[0]):point(item[0],item[1]);
  if(valid(p))list.push(p);
 }
 return list;
}
function nearestDistance(list,gps){
 if(!valid(gps)||!list.length)return 0;
 let best=Infinity;
 const step=Math.max(1,Math.floor(list.length/180));
 for(let i=0;i<list.length;i+=step)best=Math.min(best,distance(gps,list[i]));
 return best;
}
function normalizeRoute(route){
 const raw=rawGeometry(route),gps=S.gps||currentRawGps(),target=targetPoint();
 const candidates=[candidate(raw,false),candidate(raw,true)].filter(list=>list.length>=2);
 if(!candidates.length)return[];
 let list=candidates[0],best=Infinity;
 for(const option of candidates){
  const gpsScore=nearestDistance(option,gps);
  const targetScore=valid(target)?Math.min(distance(option[0],target),distance(option.at(-1),target))*.35:0;
  const score=gpsScore+targetScore;
  if(score<best){best=score;list=option}
 }
 if(valid(target)&&distance(list.at(-1),target)>distance(list[0],target))list=[...list].reverse();
 else if(valid(gps)&&distance(list[0],gps)>distance(list.at(-1),gps))list=[...list].reverse();
 return list;
}
function keyFor(list){
 if(list.length<2)return'';
 const first=list[0],last=list.at(-1);
 return`${list.length}:${first.lat.toFixed(5)}:${first.lng.toFixed(5)}:${last.lat.toFixed(5)}:${last.lng.toFixed(5)}`;
}

function removeOwnRoute(){
 for(const layer of[S.line,S.casing])if(layer)try{layer.remove()}catch{}
 S.line=S.casing=null;S.routeKey='';
}
function removeLegacyRoutes(){
 if(!S.map||typeof L==='undefined')return;
 try{
  S.map.eachLayer(layer=>{
   if(layer===S.line||layer===S.casing||layer?._cj222StableRoute)return;
   if(!(layer instanceof L.Polyline)||layer instanceof L.Polygon)return;
   const color=String(layer.options?.color||'').toLowerCase(),weight=Number(layer.options?.weight||0);
   const old=layer.options?.interactive===false&&weight>=6&&['#1459ff','#0d45d8','#0b57d0','#fff','#ffffff'].includes(color);
   if(old)S.map.removeLayer(layer);
  });
 }catch{}
}
function ensurePanes(){
 if(!S.map)return;
 if(!S.map.getPane('cj222StableRoutePane')){
  const pane=S.map.createPane('cj222StableRoutePane');pane.style.zIndex='520';pane.style.pointerEvents='none';
 }
 if(!S.map.getPane('cj222PositionPane')){
  const pane=S.map.createPane('cj222PositionPane');pane.style.zIndex='650';pane.style.pointerEvents='none';
 }
}
function drawRoute(force=false){
 if(!S.map||S.points.length<2||typeof L==='undefined')return;
 const key=keyFor(S.points),visible=S.line&&S.casing&&S.map.hasLayer?.(S.line)&&S.map.hasLayer?.(S.casing);
 if(!force&&key===S.routeKey&&visible)return;
 removeLegacyRoutes();removeOwnRoute();ensurePanes();S.routeKey=key;
 const latlngs=S.points.map(item=>[item.lat,item.lng]);
 S.casing=L.polyline(latlngs,{pane:'cj222StableRoutePane',color:'#fff',weight:13,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,smoothFactor:.55}).addTo(S.map);
 S.line=L.polyline(latlngs,{pane:'cj222StableRoutePane',color:'#1459ff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,smoothFactor:.55}).addTo(S.map);
 S.casing._cj222StableRoute=S.line._cj222StableRoute=true;
 S.casing._cjSmoothRoute=S.line._cjSmoothRoute=true;
 S.casing._cj231Route=S.line._cj231Route=true;
 S.casing.bringToFront?.();S.line.bringToFront?.();
}
function markerIcon(){
 return L.divIcon({
  className:'cj222-location-icon',
  html:'<div class="cj222-location-arrow"><svg viewBox="0 0 72 72" aria-hidden="true"><path class="shadow" d="M36 4 62 66 36 54 10 66Z"/><path class="body" d="M36 7 58 61 36 51 14 61Z"/><path class="center" d="M36 16 44 51 36 47 28 51Z"/></svg></div>',
  iconSize:[64,64],iconAnchor:[32,32]
 });
}
function ensureMarker(){
 if(!S.map||!valid(S.gps)||typeof L==='undefined'||!active())return;
 ensurePanes();
 if(!S.marker){
  S.marker=L.marker([S.gps.lat,S.gps.lng],{pane:'cj222PositionPane',icon:markerIcon(),interactive:false,keyboard:false,zIndexOffset:2000}).addTo(S.map);
 }else{
  S.marker.setLatLng([S.gps.lat,S.gps.lng]);
  if(!S.map.hasLayer?.(S.marker))S.marker.addTo(S.map);
 }
}
function removeMarker(){if(S.marker)try{S.marker.remove()}catch{}S.marker=null}

function nearestIndex(position){
 const list=S.points;if(list.length<2||!valid(position))return 0;
 const start=Math.max(0,S.routeIndex-18),end=Math.min(list.length-1,S.routeIndex+120);
 let best=start,bestDistance=Infinity;
 for(let i=start;i<=end;i++){const value=distance(position,list[i]);if(value<bestDistance){bestDistance=value;best=i}}
 if(bestDistance>100){
  const step=Math.max(1,Math.floor(list.length/260));
  for(let i=0;i<list.length;i+=step){const value=distance(position,list[i]);if(value<bestDistance){bestDistance=value;best=i}}
 }
 S.routeIndex=best;return best;
}
function lookAhead(position){
 const list=S.points;if(list.length<2||!valid(position))return null;
 let index=nearestIndex(position),remaining=Math.max(28,Math.min(85,34+S.speed*6)),previous=list[index];
 for(index+=1;index<list.length;index++){
  const segment=distance(previous,list[index]);
  if(segment>=remaining)return list[index];
  remaining-=segment;previous=list[index];
 }
 return list.at(-1)||null;
}
function calculateHeading(){
 const ahead=lookAhead(S.gps),routeHeading=ahead?bearing(S.gps,ahead):null;
 if(!Number.isFinite(routeHeading))return 0;
 const deviceHeading=Number.isFinite(S.gyroHeading)?S.gyroHeading:(S.speed>=1.2&&Number.isFinite(S.gpsHeading)?S.gpsHeading:null);
 return Number.isFinite(deviceHeading)?norm(routeHeading-deviceHeading):0;
}

function ensureUi(){
 $('#cj222-nav-arrow')?.remove();
 const app=$('#cj199-app');if(!app)return;
 if(!S.recenter||!S.recenter.isConnected){
  S.recenter=document.createElement('button');S.recenter.id='cj222-recenter';S.recenter.type='button';S.recenter.setAttribute('aria-label','Centralizar navegação');
  S.recenter.innerHTML='<b>⌖</b><small>CENTRALIZAR</small>';app.appendChild(S.recenter);
 }
 if(!S.portraitLock||!S.portraitLock.isConnected){
  S.portraitLock=document.createElement('div');S.portraitLock.id='cj222-portrait-lock';
  S.portraitLock.innerHTML='<div><b>↻</b><strong>Gire o celular para a posição vertical</strong><span>A navegação funciona somente com o celular em pé.</span></div>';
  document.body.appendChild(S.portraitLock);
 }
}
function updatePortraitLock(){
 ensureUi();
 document.body.classList.toggle('cj222-landscape-blocked',Boolean(MOBILE&&!portrait()&&home()));
}
function showManual(value){
 S.following=!value;
 S.recenter?.classList.toggle('show',value);
 $('#cj199-center')?.classList.toggle('manual',value);
}
function centerNow(){
 if(!S.map||!portrait())return;
 const gps=S.gps||currentRawGps();if(!valid(gps))return;
 S.gps=gps;S.cameraGps={...gps};showManual(false);S.programmaticUntil=performance.now()+900;
 try{window.ChegaJaDriverMap?.follow?.(false)}catch{}
 try{S.map.stop?.()}catch{}
 try{S.map.invalidateSize(false)}catch{}
 const zoom=Number(S.map.getZoom?.()||18);
 try{S.map.setView([gps.lat,gps.lng],zoom,{animate:false,noMoveStart:true})}catch{}
}
function followGps(force=false){
 if(!S.map||!S.following||!active()||!valid(S.gps)||!portrait())return;
 const now=performance.now(),cameraMove=distance(S.cameraGps,S.gps);
 const meaningful=force||(S.speed>=1.2&&cameraMove>=5)||cameraMove>=25;
 if(!meaningful||(!force&&now-S.lastCameraAt<850))return;
 S.lastCameraAt=now;S.programmaticUntil=now+900;S.cameraGps={...S.gps};
 try{S.map.panTo([S.gps.lat,S.gps.lng],{animate:true,duration:.62,easeLinearity:.2,noMoveStart:true})}catch{}
}
function bindMap(){
 const map=window.ChegaJaDriverMap?.map;if(!map)return false;
 if(S.map!==map){
  removeOwnRoute();removeMarker();S.map=map;S.cameraGps=null;
  try{window.ChegaJaDriverMap?.follow?.(false)}catch{}
  const manual=()=>{if(active()&&performance.now()>=S.programmaticUntil)showManual(true)};
  map.on('dragstart',manual);map.on('zoomstart',manual);
  setTimeout(()=>{try{map.invalidateSize(false)}catch{};removeLegacyRoutes();drawRoute(true);ensureMarker()},100);
 }
 try{window.ChegaJaDriverMap?.follow?.(false)}catch{}
 return true;
}
function updateGps(raw=window.ChegaJaLastDriverLocation){
 const next=currentRawGps(raw);if(!valid(next))return;
 const now=performance.now(),accuracy=Math.max(0,Number(raw?.accuracy)||0),speed=Math.max(0,Number(raw?.speed)||0);
 const elapsed=S.lastGpsAt?Math.max(.1,(now-S.lastGpsAt)/1000):Infinity;
 const jump=distance(S.gps,next),heading=Number(raw?.heading);
 if(Number.isFinite(heading)&&heading>=0)S.gpsHeading=norm(heading);
 S.speed=speed;S.accuracy=accuracy||S.accuracy;S.lastGpsAt=now;
 if(valid(S.gps)){
  if(accuracy>120)return;
  const maxJump=Math.max(40,elapsed*35+Math.max(accuracy,10)*1.5);
  if(jump>maxJump&&speed<12)return;
  if(speed<1.2&&jump<Math.max(16,accuracy*.7)){
   S.targetHeading=calculateHeading();ensureMarker();return;
  }
  if(jump<35){
   const alpha=accuracy<=15?.42:accuracy<=35?.3:.2;
   next.lat=S.gps.lat+(next.lat-S.gps.lat)*alpha;
   next.lng=S.gps.lng+(next.lng-S.gps.lng)*alpha;
  }
 }
 S.gps=next;S.targetHeading=calculateHeading();ensureMarker();followGps(false);
}

function screenAngle(){const value=Number(screen.orientation?.angle??window.orientation??0);return Number.isFinite(value)?value:0}
function orientation(event){
 if(!MOBILE||!portrait())return;
 let heading=Number(event.webkitCompassHeading);
 if(!Number.isFinite(heading)&&Number.isFinite(Number(event.alpha)))heading=norm(360-Number(event.alpha)+screenAngle());
 if(!Number.isFinite(heading))return;
 S.gyroHeading=Number.isFinite(S.gyroHeading)?norm(S.gyroHeading+angleDelta(S.gyroHeading,heading)*.14):heading;
 S.targetHeading=calculateHeading();
}
function listenOrientation(){
 window.addEventListener('deviceorientationabsolute',orientation,true);
 window.addEventListener('deviceorientation',orientation,true);
}
async function askOrientation(){
 if(!MOBILE||S.orientationAsked)return;S.orientationAsked=true;
 try{
  const request=window.DeviceOrientationEvent?.requestPermission;
  if(typeof request==='function'&&(await request.call(window.DeviceOrientationEvent))!=='granted')return;
  listenOrientation();
 }catch{}
}

function normalizeInstruction(text){return String(text||'').replace(/\s+/g,' ').trim()}
function speakNow(text){
 const instruction=normalizeInstruction(text);if(!instruction||!('speechSynthesis'in window))return;
 const now=Date.now();if(instruction===S.lastSpoken&&now-S.lastSpokenAt<18000)return;
 if(!S.userInteracted){S.pendingSpeech=instruction;return}
 try{
  speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(instruction);
  utterance.lang='pt-BR';utterance.rate=.98;utterance.pitch=1;utterance.volume=1;
  speechSynthesis.speak(utterance);S.lastSpoken=instruction;S.lastSpokenAt=now;S.pendingSpeech='';
 }catch{}
}
function speakNavigation(detail){
 if(!detail||detail.arrived)return;
 const instruction=detail.step?.instruction||detail.instruction||detail.next?.instruction||detail.route?.steps?.[0]?.instruction||'';
 speakNow(instruction);
}
function handleNavigation(detail){
 const id=String(detail?.delivery_id||active()?.id||'');
 if(detail?.route){
  const newDelivery=Boolean(id&&id!==S.deliveryId);
  const nextPoints=normalizeRoute(detail.route),nextKey=keyFor(nextPoints);
  S.route=detail.route;S.deliveryId=id||S.deliveryId;S.status=String(active()?.status||'');
  if(nextKey&&nextKey!==keyFor(S.points)){S.points=nextPoints;S.routeIndex=0;drawRoute(true)}
  else if(nextKey&&!S.line){S.points=nextPoints;drawRoute(true)}
  S.targetHeading=calculateHeading();speakNavigation(detail);
  if(newDelivery){showManual(false);setTimeout(centerNow,100)}
  return;
 }
 if(!active()){
  S.route=null;S.points=[];S.deliveryId='';S.status='';S.routeIndex=0;removeOwnRoute();removeMarker();
 }
}
function installNavigationBridge(){
 if(S.dispatchInstalled)return;S.dispatchInstalled=true;
 S.originalDispatch=window.dispatchEvent.bind(window);
 window.dispatchEvent=function(event){
  if(event?.type==='cj:driver-navigation'&&!event.__cj222Bypass){
   handleNavigation(event.detail||null);
   const clearEvent=new CustomEvent('cj:driver-navigation',{detail:null});
   Object.defineProperty(clearEvent,'__cj222Bypass',{value:true});
   return S.originalDispatch(clearEvent);
  }
  return S.originalDispatch(event);
 };
}
async function fetchNavigation(force=false){
 const item=active();if(!item||!token()||S.navBusy||document.hidden)return;
 const now=Date.now();if(!force&&now-S.lastNavFetch<3200)return;
 S.lastNavFetch=now;S.navBusy=true;
 try{
  const response=await fetch('/api/app/v32/driver/navigation',{headers:{Authorization:`Bearer ${token()}`},cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false||!data.route)return;
  S.lastNavSuccess=Date.now();
  const steps=data.route?.steps||[];
  handleNavigation({
   arrived:Boolean(data.arrived),route:data.route,next:data.next,items:data.items||[],
   step:steps[0]||data.step||null,nextStep:steps[1]||null,
   target:['picked_up','in_route','problem'].includes(String(item.status))?'ENTREGA':'COLETA',
   delivery_id:item.id
  });
 }catch{}finally{S.navBusy=false}
}

function animate(now){
 const elapsed=Math.min(50,Math.max(8,now-(S.lastFrame||now)));S.lastFrame=now;
 const alpha=1-Math.exp(-elapsed/150);S.displayHeading=norm(S.displayHeading+angleDelta(S.displayHeading,S.targetHeading)*alpha);
 const visible=Boolean(home()&&active()&&S.marker);
 const element=S.marker?.getElement?.()?.querySelector?.('.cj222-location-arrow');
 if(element)element.style.setProperty('--cj222-heading',`${S.displayHeading}deg`);
 document.body.classList.toggle('cj222-navigation',visible);
 S.raf=requestAnimationFrame(animate);
}
function tick(){
 updatePortraitLock();
 if(!home())return;
 ensureUi();if(!bindMap())return;
 try{window.ChegaJaDriverMap?.follow?.(false)}catch{}
 updateGps();
 const item=active();
 if(item){
  ensureMarker();
  const id=String(item.id||''),status=String(item.status||'');
  if(id!==S.deliveryId||status!==S.status||S.points.length<2||Date.now()-S.lastNavSuccess>12000)fetchNavigation(id!==S.deliveryId||status!==S.status||S.points.length<2);
  if(S.points.length>=2){
   const routeVisible=S.line&&S.casing&&S.map.hasLayer?.(S.line)&&S.map.hasLayer?.(S.casing);
   if(!routeVisible)drawRoute(true);
  }
 }else{
  S.route=null;S.points=[];S.deliveryId='';S.status='';removeOwnRoute();removeMarker();
 }
}
function unlockUser(){
 S.userInteracted=true;askOrientation();
 if(S.pendingSpeech)speakNow(S.pendingSpeech);
}
function orientationChanged(){
 updatePortraitLock();
 setTimeout(()=>{
  if(!portrait())return;
  try{S.map?.invalidateSize(false)}catch{}
  drawRoute(true);ensureMarker();
  if(S.following)centerNow();
  fetchNavigation(true);
 },350);
}

installNavigationBridge();
document.addEventListener('click',event=>{
 unlockUser();
 const button=event.target?.closest?.('#cj222-recenter,#cj199-center');if(!button)return;
 event.preventDefault();event.stopImmediatePropagation();centerNow();
},{capture:true});
document.addEventListener('pointerdown',unlockUser,{capture:true,passive:true});
document.addEventListener('touchstart',unlockUser,{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();setTimeout(()=>{try{S.map?.invalidateSize(false)}catch{};drawRoute(true);fetchNavigation(true)},180)}});
window.addEventListener('orientationchange',orientationChanged);
window.addEventListener('resize',()=>setTimeout(updatePortraitLock,100));
setInterval(tick,400);
S.raf=requestAnimationFrame(animate);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
})();
