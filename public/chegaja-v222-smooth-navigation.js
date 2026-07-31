/* ChegaJá 14.30.4 — navegação suave móvel, giroscópio e rota azul persistente */
(()=>{
'use strict';
if(window.__CJ222_SMOOTH_NAV__)return;
window.__CJ222_SMOOTH_NAV__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const MOBILE=matchMedia('(pointer:coarse)').matches&&((navigator.maxTouchPoints||0)>0||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
const S={
  map:null,app:null,route:null,routeKey:'',routeCasing:null,routeMain:null,
  lastPosition:null,lastPositionKey:'',routeIndex:0,speed:0,gpsHeading:null,
  gyroHeading:null,gyroReady:false,gyroAsked:false,targetHeading:0,displayHeading:0,
  following:true,mapBound:null,arrow:null,recenter:null,lastDeliveryId:'',raf:0,lastFrame:0,
  originalSetView:null,originalPanTo:null,originalPanBy:null,userUntil:0
};

const activeDelivery=()=>window.ChegaJaDriverActiveDelivery||null;
const isDriverHome=()=>window.state?.user?.role==='driver'&&window.state?.page==='dashboard'&&!!$('#cj199-app');
const norm=value=>((Number(value)||0)%360+360)%360;
const angleDelta=(from,to)=>((norm(to)-norm(from)+540)%360)-180;
const finitePoint=p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lng));

function meters(a,b){
  if(!finitePoint(a)||!finitePoint(b))return Infinity;
  const rad=x=>x*Math.PI/180,earth=6371000;
  const dLat=rad(Number(b.lat)-Number(a.lat)),dLng=rad(Number(b.lng)-Number(a.lng));
  const x=Math.sin(dLat/2)**2+Math.cos(rad(Number(a.lat)))*Math.cos(rad(Number(b.lat)))*Math.sin(dLng/2)**2;
  return 2*earth*Math.asin(Math.min(1,Math.sqrt(x)));
}

function bearing(a,b){
  if(!finitePoint(a)||!finitePoint(b))return null;
  const rad=x=>x*Math.PI/180,lat1=rad(Number(a.lat)),lat2=rad(Number(b.lat)),dLng=rad(Number(b.lng)-Number(a.lng));
  const y=Math.sin(dLng)*Math.cos(lat2);
  const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
  return norm(Math.atan2(y,x)*180/Math.PI);
}

function routePoints(route){
  return (route?.geometry||[]).map(p=>Array.isArray(p)&&p.length>1?{lat:Number(p[0]),lng:Number(p[1])}:null).filter(finitePoint);
}

function keyFor(points){
  if(points.length<2)return'';
  const a=points[0],b=points.at(-1);
  return `${points.length}:${a.lat.toFixed(5)}:${a.lng.toFixed(5)}:${b.lat.toFixed(5)}:${b.lng.toFixed(5)}`;
}

function ensureUi(){
  const app=$('#cj199-app');
  if(!app)return false;
  S.app=app;
  if(!S.arrow){
    S.arrow=document.createElement('div');
    S.arrow.id='cj222-nav-arrow';
    S.arrow.setAttribute('aria-hidden','true');
    S.arrow.innerHTML='<span><svg viewBox="0 0 72 72"><path class="shadow" d="M36 4 62 66 36 54 10 66Z"/><path class="body" d="M36 7 58 61 36 51 14 61Z"/><path class="center" d="M36 16 44 51 36 47 28 51Z"/></svg></span>';
    app.appendChild(S.arrow);
  }
  if(!S.recenter){
    S.recenter=document.createElement('button');
    S.recenter.id='cj222-recenter';
    S.recenter.type='button';
    S.recenter.setAttribute('aria-label','Centralizar navegação');
    S.recenter.innerHTML='<b>⌖</b><small>CENTRALIZAR</small>';
    S.recenter.onclick=()=>{S.following=true;S.recenter.classList.remove('show');centerMap(true)};
    app.appendChild(S.recenter);
  }
  return true;
}

function clearLayers(){
  for(const layer of [S.routeCasing,S.routeMain])if(layer)try{layer.remove()}catch{}
  S.routeCasing=S.routeMain=null;
}

function cleanupCompetingRoutes(){
  if(!S.map||typeof window.L==='undefined')return;
  try{
    S.map.eachLayer(layer=>{
      if(layer?._cj222Route)return;
      const isLine=layer instanceof L.Polyline&&!(layer instanceof L.Polygon);
      if(!isLine)return;
      const color=String(layer.options?.color||'').toLowerCase();
      const weight=Number(layer.options?.weight||0);
      const oldRoute=(color==='#1459ff'||color==='#fff'||color==='#ffffff')&&weight>=6&&layer.options?.interactive===false;
      if(oldRoute)S.map.removeLayer(layer);
    });
  }catch{}
}

function drawRoute(force=false){
  if(!S.map||!S.route||typeof window.L==='undefined')return;
  const points=routePoints(S.route),key=keyFor(points);
  if(points.length<2)return;
  if(!force&&key===S.routeKey&&S.routeMain&&S.routeCasing)return;
  S.routeKey=key;
  clearLayers();
  const latLngs=points.map(p=>[p.lat,p.lng]);
  S.routeCasing=L.polyline(latLngs,{color:'#ffffff',weight:11,opacity:.96,lineCap:'round',lineJoin:'round',interactive:false,smoothFactor:.65}).addTo(S.map);
  S.routeMain=L.polyline(latLngs,{color:'#1459ff',weight:7,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,smoothFactor:.65}).addTo(S.map);
  S.routeCasing._cj222Route=true;
  S.routeMain._cj222Route=true;
  cleanupCompetingRoutes();
  S.routeCasing.bringToFront?.();
  S.routeMain.bringToFront?.();
}

function nearestRouteIndex(position){
  const points=routePoints(S.route);
  if(points.length<2||!finitePoint(position))return 0;
  const start=Math.max(0,S.routeIndex-12),end=Math.min(points.length-1,S.routeIndex+90);
  let best=start,bestDistance=Infinity;
  for(let i=start;i<=end;i++){
    const d=meters(position,points[i]);
    if(d<bestDistance){bestDistance=d;best=i}
  }
  if(bestDistance>120){
    for(let i=0;i<points.length;i+=Math.max(1,Math.floor(points.length/250))){
      const d=meters(position,points[i]);
      if(d<bestDistance){bestDistance=d;best=i}
    }
  }
  S.routeIndex=best;
  return best;
}

function lookAhead(position){
  const points=routePoints(S.route);
  if(points.length<2)return null;
  let index=nearestRouteIndex(position);
  let remaining=Math.max(35,Math.min(95,42+(Number(S.speed)||0)*7));
  let previous=points[index];
  for(let i=index+1;i<points.length;i++){
    const segment=meters(previous,points[i]);
    if(segment>=remaining)return points[i];
    remaining-=segment;
    previous=points[i];
  }
  return points.at(-1)||null;
}

function desiredHeading(){
  const ahead=lookAhead(S.lastPosition);
  const routeBearing=ahead?bearing(S.lastPosition,ahead):null;
  if(Number.isFinite(routeBearing)){
    if(MOBILE&&Number.isFinite(S.gyroHeading)&&(Number(S.speed)||0)<2){
      const correction=Math.max(-18,Math.min(18,angleDelta(routeBearing,S.gyroHeading)))*.08;
      return norm(routeBearing+correction);
    }
    return routeBearing;
  }
  if(Number.isFinite(S.gpsHeading))return norm(S.gpsHeading);
  if(MOBILE&&Number.isFinite(S.gyroHeading))return norm(S.gyroHeading);
  return S.displayHeading;
}

function mapCenterTarget(){
  const ahead=lookAhead(S.lastPosition);
  if(!ahead||!finitePoint(S.lastPosition))return S.lastPosition;
  return {
    lat:Number(S.lastPosition.lat)+(Number(ahead.lat)-Number(S.lastPosition.lat))*.28,
    lng:Number(S.lastPosition.lng)+(Number(ahead.lng)-Number(S.lastPosition.lng))*.28
  };
}

function centerMap(force=false){
  if(!S.map||!S.following||!finitePoint(S.lastPosition)||!activeDelivery())return;
  try{window.ChegaJaDriverMap?.follow?.(false)}catch{}
  const target=mapCenterTarget();
  const zoom=Math.max(18,Number(S.map.getZoom()||18));
  try{
    if(force||Math.abs(Number(S.map.getZoom()||0)-zoom)>.15){
      S.originalSetView?.([target.lat,target.lng],zoom,{animate:false,noMoveStart:true,cj222Smooth:true});
    }else{
      S.originalPanTo?.([target.lat,target.lng],{animate:true,duration:.72,easeLinearity:.18,noMoveStart:true,cj222Smooth:true});
    }
  }catch{}
}

function patchMapCamera(){
  if(!S.map||S.map.__cj222SmoothCamera)return;
  S.map.__cj222SmoothCamera=true;
  S.originalSetView=S.map.setView.bind(S.map);
  S.originalPanTo=typeof S.map.panTo==='function'?S.map.panTo.bind(S.map):null;
  S.originalPanBy=typeof S.map.panBy==='function'?S.map.panBy.bind(S.map):null;
  const allowed=options=>Boolean(options?.cj222Smooth||Date.now()<S.userUntil||!activeDelivery());
  S.map.setView=function(center,zoom,options={}){
    if(!allowed(options))return this;
    return S.originalSetView(center,zoom,options);
  };
  if(S.originalPanTo)S.map.panTo=function(center,options={}){
    if(!allowed(options))return this;
    return S.originalPanTo(center,options);
  };
  if(S.originalPanBy)S.map.panBy=function(offset,options={}){
    if(!allowed(options))return this;
    return S.originalPanBy(offset,options);
  };
  const container=S.map.getContainer?.();
  const user=()=>{S.userUntil=Date.now()+2200};
  container?.addEventListener('pointerdown',user,{passive:true});
  container?.addEventListener('wheel',user,{passive:true});
}

function bindMap(){
  const map=window.ChegaJaDriverMap?.map;
  if(!map)return false;
  S.map=map;
  if(S.mapBound!==map){
    S.mapBound=map;
    const manual=()=>{
      if(!activeDelivery())return;
      S.following=false;
      S.recenter?.classList.add('show');
    };
    map.on('dragstart',manual);
    map.on('zoomstart',manual);
    patchMapCamera();
    setTimeout(()=>{try{map.invalidateSize(false)}catch{}},40);
  }
  patchMapCamera();
  cleanupCompetingRoutes();
  drawRoute();
  return true;
}

function setPosition(raw){
  const position={lat:Number(raw?.lat),lng:Number(raw?.lng)};
  if(!finitePoint(position))return;
  const key=`${position.lat.toFixed(6)}:${position.lng.toFixed(6)}`;
  if(key===S.lastPositionKey)return;
  S.lastPositionKey=key;
  S.lastPosition=position;
  S.speed=Number(raw?.speed)||0;
  const gps=Number(raw?.heading);
  S.gpsHeading=Number.isFinite(gps)&&gps>=0?norm(gps):null;
  S.targetHeading=desiredHeading();
  centerMap(false);
}

function screenAngle(){
  const angle=Number(screen.orientation?.angle);
  if(Number.isFinite(angle))return angle;
  return Number(window.orientation)||0;
}

function onOrientation(event){
  if(!MOBILE)return;
  let heading=Number(event.webkitCompassHeading);
  if(!Number.isFinite(heading)&&Number.isFinite(Number(event.alpha)))heading=norm(360-Number(event.alpha)+screenAngle());
  if(!Number.isFinite(heading))return;
  S.gyroReady=true;
  if(!Number.isFinite(S.gyroHeading))S.gyroHeading=heading;
  else S.gyroHeading=norm(S.gyroHeading+angleDelta(S.gyroHeading,heading)*.16);
  if(!routePoints(S.route).length&&!Number.isFinite(S.gpsHeading))S.targetHeading=S.gyroHeading;
}

function attachOrientation(){
  if(!MOBILE||S.gyroReady)return;
  window.addEventListener('deviceorientationabsolute',onOrientation,true);
  window.addEventListener('deviceorientation',onOrientation,true);
}

async function requestOrientation(){
  if(!MOBILE||S.gyroAsked)return;
  S.gyroAsked=true;
  try{
    if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
      const result=await DeviceOrientationEvent.requestPermission();
      if(result!=='granted')return;
    }
    attachOrientation();
  }catch{}
}

function animate(now){
  const dt=Math.min(50,Math.max(8,now-(S.lastFrame||now)));
  S.lastFrame=now;
  const alpha=1-Math.exp(-dt/150);
  S.displayHeading=norm(S.displayHeading+angleDelta(S.displayHeading,S.targetHeading)*alpha);
  if(S.arrow){
    const showing=Boolean(activeDelivery()&&S.route);
    S.arrow.style.setProperty('--cj222-heading',`${S.displayHeading}deg`);
    S.arrow.classList.toggle('show',showing);
    document.body.classList.toggle('cj222-navigation',showing);
  }
  S.raf=requestAnimationFrame(animate);
}

function onNavigation(event){
  const detail=event.detail||null;
  const deliveryId=String(detail?.delivery_id||activeDelivery()?.id||'');
  if(deliveryId&&deliveryId!==S.lastDeliveryId){
    S.lastDeliveryId=deliveryId;
    S.routeIndex=0;
    S.following=true;
    S.recenter?.classList.remove('show');
  }
  if(detail?.route){
    S.route=detail.route;
    S.routeKey='';
    drawRoute(true);
    S.targetHeading=desiredHeading();
    centerMap(true);
  }else if(!activeDelivery()){
    S.route=null;S.routeKey='';S.lastDeliveryId='';clearLayers();
  }
}

function tick(){
  if(!isDriverHome()){
    if(S.arrow)S.arrow.classList.remove('show');
    document.body.classList.remove('cj222-navigation');
    return;
  }
  ensureUi();
  bindMap();
  if(activeDelivery()){
    try{window.ChegaJaDriverMap?.follow?.(false)}catch{}
    setPosition(window.ChegaJaLastDriverLocation);
    cleanupCompetingRoutes();
    drawRoute();
  }else{
    S.route=null;S.routeKey='';clearLayers();
    S.arrow?.classList.remove('show');
    document.body.classList.remove('cj222-navigation');
  }
}

window.addEventListener('cj:driver-navigation',onNavigation);
document.addEventListener('pointerup',event=>{if(MOBILE&&event.target?.closest?.('#cj199-app'))requestOrientation()},{capture:true});
window.addEventListener('orientationchange',()=>setTimeout(()=>{try{S.map?.invalidateSize(false)}catch{}},250));
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();if(MOBILE)attachOrientation()}});
setInterval(tick,120);
if(!S.raf)S.raf=requestAnimationFrame(animate);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
})();
