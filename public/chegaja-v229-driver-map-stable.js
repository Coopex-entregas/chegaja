/* ChegaJá 14.30.3 — rotação ancorada no cooperado, mapa sem áreas vazias e gestos estáveis */
(()=>{
'use strict';
if(window.__CJ229_DRIVER_MAP_STABLE_14303__)return;
window.__CJ229_DRIVER_MAP_STABLE_14303__=true;

const S={
 map:null,host:null,app:null,pane:null,originalSetView:null,originalPanBy:null,originalPanTo:null,originalMove:null,
 pointers:new Map(),gesture:null,bearing:0,appliedBearing:null,originKey:'',manual:false,following:true,lastGps:null,
 lastFollowAt:0,lastDeliveryId:'',timer:null,boundCenter:null,boundMap:null,userUntil:0,lastSurfaceSize:0
};
const isDriverHome=()=>window.state?.user?.role==='driver'&&document.body.classList.contains('cj199-driver');
const active=()=>window.ChegaJaDriverActiveDelivery||null;
const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const point=raw=>({lat:Number(raw?.lat??raw?.latitude),lng:Number(raw?.lng??raw?.longitude)});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const normalize=value=>((Number(value)||0)%360+360)%360;
const signed=value=>{const n=normalize(value);return n>180?n-360:n};
const shortestDelta=(from,to)=>signed(Number(to)-Number(from));
const fingerAngle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
const fingerDistance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);

function distance(a,b){
 if(!valid(a)||!valid(b))return Infinity;
 const dy=(b.lat-a.lat)*111320;
 const dx=(b.lng-a.lng)*111320*Math.cos(a.lat*Math.PI/180);
 return Math.hypot(dx,dy);
}
function navigationZoom(){return window.innerWidth<=430?19.5:19.25}
function currentGps(){
 const cached=valid(S.lastGps)?S.lastGps:point(window.ChegaJaLastDriverLocation);
 return valid(cached)?cached:null;
}
function setManual(value){
 S.manual=Boolean(value);
 S.following=!S.manual;
 const button=document.querySelector('#cj199-center');
 button?.classList.toggle('manual',S.manual);
 if(button)button.title=S.manual?'Alinhar novamente e acompanhar sua posição':'Mapa alinhado e acompanhando sua posição';
}
function markUserGesture(){S.userUntil=Date.now()+2400}

function resizeMapSurface(force=false){
 if(!S.host||!S.app)return;
 const rect=S.app.getBoundingClientRect();
 if(rect.width<100||rect.height<100)return;
 const side=Math.ceil(Math.hypot(rect.width,rect.height)+192);
 if(!force&&Math.abs(side-S.lastSurfaceSize)<2)return;
 S.lastSurfaceSize=side;
 S.host.style.inset='auto';
 S.host.style.width=`${side}px`;
 S.host.style.height=`${side}px`;
 S.host.style.left=`${Math.round((rect.width-side)/2)}px`;
 S.host.style.top=`${Math.round((rect.height-side)/2)}px`;
 requestAnimationFrame(()=>{
  try{S.map?.invalidateSize?.(false)}catch{}
  requestAnimationFrame(()=>applyBearing(true));
 });
}
function rotationOrigin(){
 if(!S.map)return null;
 const gps=currentGps();
 try{
  if(gps&&typeof S.map.latLngToLayerPoint==='function'){
   const p=S.map.latLngToLayerPoint([gps.lat,gps.lng]);
   if(Number.isFinite(p?.x)&&Number.isFinite(p?.y))return{x:p.x,y:p.y};
  }
  const size=S.map.getSize?.();
  if(size)return{x:Number(size.x)/2,y:Number(size.y)/2};
 }catch{}
 return null;
}
function applyBearing(force=false){
 if(!S.pane||!S.host)return;
 const next=signed(S.bearing);
 const origin=rotationOrigin();
 if(origin){
  const x=Math.round(origin.x*10)/10,y=Math.round(origin.y*10)/10;
  const key=`${x}:${y}`;
  if(force||key!==S.originKey){
   S.originKey=key;
   S.pane.style.transformOrigin=`${x}px ${y}px`;
  }
 }
 const changed=S.appliedBearing==null||Math.abs(shortestDelta(S.appliedBearing,next))>=.04;
 if(!force&&!changed)return;
 S.appliedBearing=next;
 S.pane.style.rotate=`${next}deg`;
 S.host.style.setProperty('--cj-map-bearing',String(next));
 if(changed||force)window.dispatchEvent(new CustomEvent('cj:driver-map-bearing',{detail:{bearing:next}}));
}
function configureMap(){
 if(!S.map)return;
 try{
  S.map.options.zoomSnap=.25;
  S.map.options.zoomDelta=.25;
  S.map.options.fadeAnimation=false;
  S.map.options.zoomAnimation=false;
  S.map.options.markerZoomAnimation=false;
  S.map.setMaxZoom?.(20);
  S.map.dragging?.disable?.();
  S.map.touchZoom?.disable?.();
  S.map._container?.classList?.remove('leaflet-fade-anim','leaflet-zoom-anim');
  S.map.eachLayer(layer=>{
   if(typeof L!=='undefined'&&layer instanceof L.TileLayer){
    layer.options.maxNativeZoom=19;
    layer.options.maxZoom=20;
    layer.options.keepBuffer=16;
    layer.options.updateWhenZooming=false;
    layer.options.updateWhenIdle=true;
    layer.options.fadeAnimation=false;
   }
  });
 }catch{}
}
function stableSetView(latlng,zoom){
 if(!S.map||!S.originalSetView)return;
 const safeZoom=clamp(Number.isFinite(Number(zoom))?Number(zoom):navigationZoom(),18,20);
 try{
  S.originalSetView(latlng,safeZoom,{animate:false,noMoveStart:true,cjStable:true});
  requestAnimationFrame(()=>applyBearing(true));
 }catch{}
}
function stablePanTo(latlng){
 if(!S.map)return;
 try{
  if(S.originalPanTo)S.originalPanTo(latlng,{animate:false,noMoveStart:true,cjStable:true});
  else stableSetView(latlng,S.map.getZoom?.()||navigationZoom());
  requestAnimationFrame(()=>applyBearing(true));
 }catch{}
}
function anchorOnDriver(resetBearing=false){
 const gps=currentGps();
 if(!S.map||!gps)return;
 if(resetBearing)S.bearing=0;
 stableSetView([gps.lat,gps.lng],Math.max(navigationZoom(),Number(S.map.getZoom?.()||navigationZoom())));
 applyBearing(true);
}
function recenter(){
 const gps=currentGps();
 if(!S.map||!gps)return;
 S.userUntil=0;
 setManual(false);
 S.bearing=0;
 stableSetView([gps.lat,gps.lng],navigationZoom());
 S.lastFollowAt=Date.now();
 applyBearing(true);
}
function bindCenter(){
 const button=document.querySelector('#cj199-center');
 if(!button||S.boundCenter===button)return;
 S.boundCenter=button;
 button.classList.remove('cj205-sos');
 button.type='button';
 button.innerHTML='<span aria-hidden="true">⌖</span>';
 button.setAttribute('aria-label','Alinhar mapa com minha localização');
 button.onclick=event=>{event.preventDefault();event.stopPropagation();recenter()};
}
function zoomAtDriver(delta){
 if(!S.map)return;
 setManual(true);
 const target=clamp(Math.round((Number(S.map.getZoom?.()||navigationZoom())+delta)*4)/4,18,20);
 const gps=currentGps(),center=gps?[gps.lat,gps.lng]:S.map.getCenter?.();
 stableSetView(center,target);
}
function installZoomControls(){
 if(!S.app)return;
 let controls=document.querySelector('#cj229-zoom');
 if(!controls){
  controls=document.createElement('section');
  controls.id='cj229-zoom';
  controls.setAttribute('aria-label','Controles de zoom');
  controls.innerHTML='<button type="button" data-zoom-in aria-label="Aumentar zoom">+</button><button type="button" data-zoom-out aria-label="Diminuir zoom">−</button>';
  S.app.appendChild(controls);
 }
 let attribution=document.querySelector('#cj229-attribution');
 if(!attribution){attribution=document.createElement('small');attribution.id='cj229-attribution';attribution.textContent='© OpenStreetMap';S.app.appendChild(attribution)}
 controls.querySelector('[data-zoom-in]').onclick=event=>{event.preventDefault();event.stopPropagation();zoomAtDriver(.5)};
 controls.querySelector('[data-zoom-out]').onclick=event=>{event.preventDefault();event.stopPropagation();zoomAtDriver(-.5)};
}

function patchMapMethods(){
 if(!S.map||S.map.__cj229Stable)return;
 S.map.__cj229Stable=true;
 S.originalSetView=S.map.setView.bind(S.map);
 S.originalPanBy=S.map.panBy.bind(S.map);
 S.originalPanTo=typeof S.map.panTo==='function'?S.map.panTo.bind(S.map):null;
 S.map.setView=function(center,zoom,options={}){
  const allowed=Boolean(options?.cjStable||options?.cjUser||Date.now()<S.userUntil);
  if(active()&&!allowed)return this;
  const result=S.originalSetView(center,zoom,options);
  requestAnimationFrame(()=>applyBearing(true));
  return result;
 };
 S.map.panBy=function(offset,options={}){
  const allowed=Boolean(options?.cjStable||options?.cjUser||Date.now()<S.userUntil);
  if(active()&&!allowed)return this;
  const result=S.originalPanBy(offset,options);
  requestAnimationFrame(()=>applyBearing(true));
  return result;
 };
 if(S.originalPanTo)S.map.panTo=function(center,options={}){
  const allowed=Boolean(options?.cjStable||options?.cjUser||Date.now()<S.userUntil);
  if(active()&&!allowed)return this;
  const result=S.originalPanTo(center,options);
  requestAnimationFrame(()=>applyBearing(true));
  return result;
 };
}
function patchDriverMove(){
 const api=window.ChegaJaDriverMap;
 if(!api||typeof api.move!=='function'||api.__cj229StableMove)return;
 api.__cj229StableMove=true;
 S.originalMove=api.move.bind(api);
 api.move=function(raw){
  const next=point(raw),moved=distance(S.lastGps,next);
  if(valid(next))S.lastGps=next;
  const result=S.originalMove(raw);
  if(valid(next)&&active()&&S.following&&!S.manual&&moved>=4&&Date.now()-S.lastFollowAt>=500){
   S.lastFollowAt=Date.now();
   stablePanTo([next.lat,next.lng]);
  }else if(valid(next)){
   requestAnimationFrame(()=>applyBearing(true));
  }
  return result;
 };
}
function rotatedPanOffset(dx,dy){
 const radians=-signed(S.bearing)*Math.PI/180;
 const cos=Math.cos(radians),sin=Math.sin(radians);
 const localX=dx*cos-dy*sin;
 const localY=dx*sin+dy*cos;
 return[-localX,-localY];
}
function beginGesture(){
 const points=[...S.pointers.values()];
 if(points.length===1){
  S.gesture={type:'drag',last:{...points[0]}};
  return;
 }
 if(points.length>=2){
  const [a,b]=points;
  setManual(true);
  anchorOnDriver(false);
  S.gesture={
   type:'rotate',
   angle:fingerAngle(a,b),
   distance:Math.max(1,fingerDistance(a,b)),
   startZoom:Number(S.map?.getZoom?.()||navigationZoom()),
   pendingZoom:Number(S.map?.getZoom?.()||navigationZoom())
  };
 }
}
function finishPinch(){
 if(S.gesture?.type!=='rotate'||!S.map)return;
 const current=Number(S.map.getZoom?.()||navigationZoom());
 const target=clamp(Math.round(Number(S.gesture.pendingZoom||current)*4)/4,18,20);
 const gps=currentGps(),anchor=gps?[gps.lat,gps.lng]:S.map.getCenter?.();
 if(Math.abs(target-current)>=.24)stableSetView(anchor,target);
 else applyBearing(true);
}
function bindGestures(){
 if(!S.host||S.boundMap===S.host)return;
 S.boundMap=S.host;
 S.host.style.touchAction='none';
 const down=event=>{
  if(event.target?.closest?.('.leaflet-control,button,a,input,select,textarea'))return;
  markUserGesture();
  try{S.host.setPointerCapture?.(event.pointerId)}catch{}
  S.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  beginGesture();
  if(event.cancelable)event.preventDefault();
 };
 const move=event=>{
  if(!S.pointers.has(event.pointerId))return;
  S.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  const points=[...S.pointers.values()];
  if(points.length===1){
   if(S.gesture?.type!=='drag')beginGesture();
   const current=points[0],last=S.gesture?.last||current;
   const dx=current.x-last.x,dy=current.y-last.y;
   S.gesture.last={...current};
   if(Math.abs(dx)+Math.abs(dy)>.2&&S.originalPanBy){
    setManual(true);
    markUserGesture();
    S.originalPanBy(rotatedPanOffset(dx,dy),{animate:false,noMoveStart:true,cjUser:true});
    applyBearing(true);
   }
  }else if(points.length>=2){
   if(S.gesture?.type!=='rotate')beginGesture();
   const [a,b]=points,nextAngle=fingerAngle(a,b),nextDistance=Math.max(1,fingerDistance(a,b));
   const delta=shortestDelta(S.gesture.angle,nextAngle);
   S.gesture.angle=nextAngle;
   if(Math.abs(delta)>.04&&Math.abs(delta)<18){
    S.bearing=normalize(S.bearing+delta);
    applyBearing();
   }
   const ratio=nextDistance/S.gesture.distance;
   S.gesture.pendingZoom=clamp(S.gesture.startZoom+Math.log2(Math.max(.35,Math.min(2.8,ratio))),18,20);
  }
  if(event.cancelable)event.preventDefault();
 };
 const end=event=>{
  if(!S.pointers.has(event.pointerId))return;
  const wasPinch=S.gesture?.type==='rotate';
  if(wasPinch)finishPinch();
  S.pointers.delete(event.pointerId);
  try{S.host.releasePointerCapture?.(event.pointerId)}catch{}
  if(S.pointers.size)beginGesture();else S.gesture=null;
  if(event.cancelable)event.preventDefault();
 };
 S.host.addEventListener('pointerdown',down,{passive:false,capture:true});
 S.host.addEventListener('pointermove',move,{passive:false,capture:true});
 S.host.addEventListener('pointerup',end,{passive:false,capture:true});
 S.host.addEventListener('pointercancel',end,{passive:false,capture:true});
 S.host.addEventListener('wheel',()=>{markUserGesture();setManual(true)},{passive:true});
}
function syncDelivery(){
 const id=String(active()?.id||'');
 if(!id){S.lastDeliveryId='';return}
 if(id!==S.lastDeliveryId){
  S.lastDeliveryId=id;
  S.following=true;
  S.manual=false;
  setTimeout(recenter,80);
 }
}
function attach(){
 const map=window.ChegaJaDriverMap?.map,host=document.querySelector('#cj199-map'),app=document.querySelector('#cj199-app');
 if(!map||!host||!app)return;
 if(S.map!==map||S.host!==host){
  S.map=map;S.host=host;S.app=app;S.pane=map._mapPane||host.querySelector('.leaflet-map-pane');
  S.boundMap=null;S.boundCenter=null;S.originalSetView=null;S.originalPanBy=null;S.originalPanTo=null;
  S.appliedBearing=null;S.originKey='';S.lastSurfaceSize=0;
  resizeMapSurface(true);
  configureMap();
  patchMapMethods();
  bindGestures();
  applyBearing(true);
 }
 patchDriverMove();
 bindCenter();
 installZoomControls();
 syncDelivery();
 const cached=point(window.ChegaJaLastDriverLocation);
 if(valid(cached))S.lastGps=cached;
}
function health(){
 if(!isDriverHome())return;
 attach();
 bindCenter();
 installZoomControls();
 resizeMapSurface(false);
}
function boot(){
 window.addEventListener('cj:driver-navigation',()=>{attach();syncDelivery()});
 window.addEventListener('resize',()=>{resizeMapSurface(true);if(active()&&!S.manual)recenter()},{passive:true});
 screen.orientation?.addEventListener?.('change',()=>setTimeout(()=>{resizeMapSurface(true);if(active()&&!S.manual)recenter()},120));
 clearInterval(S.timer);
 S.timer=setInterval(health,1200);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){health();if(active()&&!S.manual)recenter()}});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();