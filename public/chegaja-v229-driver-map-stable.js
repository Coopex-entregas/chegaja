/* ChegaJá 14.30.1 — um único controle estável de acompanhamento, zoom e rotação do mapa */
(()=>{
'use strict';
if(window.__CJ229_DRIVER_MAP_STABLE_14301__)return;
window.__CJ229_DRIVER_MAP_STABLE_14301__=true;

const S={
 map:null,host:null,pane:null,originalSetView:null,originalPanBy:null,originalMove:null,
 pointers:new Map(),gesture:null,bearing:0,manual:false,following:true,lastGps:null,
 lastFollowAt:0,lastDeliveryId:'',timer:null,boundCenter:null,boundMap:null
};
const isDriverHome=()=>window.state?.user?.role==='driver'&&document.body.classList.contains('cj199-driver');
const active=()=>window.ChegaJaDriverActiveDelivery||null;
const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const point=raw=>({lat:Number(raw?.lat??raw?.latitude),lng:Number(raw?.lng??raw?.longitude)});
const normalize=v=>((Number(v)||0)%360+360)%360;
const signed=v=>{const n=normalize(v);return n>180?n-360:n};
const shortestDelta=(from,to)=>signed(Number(to)-Number(from));
const fingerAngle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
function distance(a,b){
 if(!valid(a)||!valid(b))return Infinity;
 const dy=(b.lat-a.lat)*111320;
 const dx=(b.lng-a.lng)*111320*Math.cos(a.lat*Math.PI/180);
 return Math.hypot(dx,dy);
}
function navigationZoom(){
 const width=Math.max(320,window.innerWidth||360);
 return width<=390?19.5:19.25;
}
function setManual(value){
 S.manual=Boolean(value);
 S.following=!S.manual;
 const button=document.querySelector('#cj199-center');
 button?.classList.toggle('manual',S.manual);
 if(button)button.title=S.manual?'Alinhar novamente e acompanhar sua posição':'Mapa alinhado e acompanhando sua posição';
}
function applyBearing(){
 if(!S.pane||!S.host)return;
 S.pane.style.transformOrigin='50% 50%';
 S.pane.style.rotate=`${signed(S.bearing)}deg`;
 S.host.style.setProperty('--cj-map-bearing',String(signed(S.bearing)));
 window.dispatchEvent(new CustomEvent('cj:driver-map-bearing',{detail:{bearing:signed(S.bearing)}}));
}
function configureMap(){
 if(!S.map)return;
 try{
  S.map.options.zoomSnap=.25;
  S.map.options.zoomDelta=.25;
  S.map.options.fadeAnimation=false;
  S.map.options.zoomAnimation=false;
  S.map.setMaxZoom?.(20);
  S.map.eachLayer(layer=>{
   if(typeof L!=='undefined'&&layer instanceof L.TileLayer){
    layer.options.maxNativeZoom=19;
    layer.options.maxZoom=20;
    layer.options.keepBuffer=8;
    layer.options.updateWhenZooming=false;
    layer.options.updateWhenIdle=true;
   }
  });
 }catch{}
}
function stableSetView(latlng,zoom,animate=false){
 if(!S.map||!S.originalSetView)return;
 const safeZoom=Math.max(18,Math.min(19.5,Number.isFinite(Number(zoom))?Number(zoom):navigationZoom()));
 try{S.originalSetView(latlng,safeZoom,{animate:Boolean(animate),duration:animate?0.24:0,noMoveStart:true,cjStable:true})}catch{}
}
function recenter(){
 const current=valid(S.lastGps)?S.lastGps:point(window.ChegaJaLastDriverLocation);
 if(!S.map||!valid(current))return;
 setManual(false);
 S.bearing=0;
 applyBearing();
 stableSetView([current.lat,current.lng],navigationZoom(),false);
 S.lastFollowAt=Date.now();
}
function bindCenter(){
 const button=document.querySelector('#cj199-center');
 if(!button||S.boundCenter===button)return;
 S.boundCenter=button;
 button.type='button';
 button.innerHTML='<span aria-hidden="true">⌖</span>';
 button.setAttribute('aria-label','Alinhar mapa com minha localização');
 button.onclick=event=>{event.preventDefault();event.stopPropagation();recenter()};
}
function patchMapMethods(){
 if(!S.map||S.map.__cj229Stable)return;
 S.map.__cj229Stable=true;
 S.originalSetView=S.map.setView.bind(S.map);
 S.originalPanBy=S.map.panBy.bind(S.map);
 S.map.setView=function(center,zoom,options={}){
  if(active()&&!options?.cjStable&&!options?.cjUser)return this;
  return S.originalSetView(center,zoom,options);
 };
 S.map.panBy=function(offset,options={}){
  if(active()&&!options?.cjStable&&!options?.cjUser)return this;
  return S.originalPanBy(offset,options);
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
  if(valid(next)&&active()&&S.following&&!S.manual&&moved>=3&&Date.now()-S.lastFollowAt>=320){
   S.lastFollowAt=Date.now();
   const zoom=Math.max(navigationZoom(),Math.min(19.5,Number(S.map?.getZoom?.()||navigationZoom())));
   stableSetView([next.lat,next.lng],zoom,true);
  }
  return result;
 };
}
function beginGesture(){
 if(S.pointers.size!==2){S.gesture=null;return}
 const [a,b]=[...S.pointers.values()];
 S.gesture={angle:fingerAngle(a,b)};
 setManual(true);
}
function bindGestures(){
 if(!S.host||S.boundMap===S.host)return;
 S.boundMap=S.host;
 S.host.style.touchAction='none';
 const down=event=>{
  if(event.pointerType!=='touch')return;
  S.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(S.pointers.size===2)beginGesture();
 };
 const move=event=>{
  if(!S.pointers.has(event.pointerId))return;
  S.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(S.pointers.size!==2||!S.gesture)return;
  const [a,b]=[...S.pointers.values()],next=fingerAngle(a,b);
  const delta=shortestDelta(S.gesture.angle,next);
  S.gesture.angle=next;
  if(Math.abs(delta)>.05&&Math.abs(delta)<25){S.bearing+=delta;applyBearing()}
 };
 const end=event=>{S.pointers.delete(event.pointerId);if(S.pointers.size===2)beginGesture();else S.gesture=null};
 S.host.addEventListener('pointerdown',down,{passive:true});
 S.host.addEventListener('pointermove',move,{passive:true});
 S.host.addEventListener('pointerup',end,{passive:true});
 S.host.addEventListener('pointercancel',end,{passive:true});
 S.map.on('dragstart zoomstart',()=>{if(S.pointers.size<2)setManual(true)});
 S.map.touchZoom?.enable?.();
 S.map.dragging?.enable?.();
}
function syncDelivery(){
 const id=String(active()?.id||'');
 if(!id){S.lastDeliveryId='';return}
 if(id!==S.lastDeliveryId){S.lastDeliveryId=id;S.following=true;S.manual=false;setTimeout(recenter,40)}
}
function attach(){
 const map=window.ChegaJaDriverMap?.map,host=document.querySelector('#cj199-map');
 if(!map||!host)return;
 if(S.map!==map){
  S.map=map;S.host=host;S.pane=map._mapPane||host.querySelector('.leaflet-map-pane');
  S.boundMap=null;S.boundCenter=null;S.originalSetView=null;S.originalPanBy=null;S.originalMove=null;
  configureMap();patchMapMethods();bindGestures();applyBearing();
 }
 patchDriverMove();bindCenter();syncDelivery();
 const cached=point(window.ChegaJaLastDriverLocation);if(valid(cached))S.lastGps=cached;
}
function health(){
 if(!isDriverHome())return;
 attach();
 applyBearing();
}
function boot(){
 window.addEventListener('cj:driver-navigation',()=>{attach();syncDelivery()});
 clearInterval(S.timer);S.timer=setInterval(health,650);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){health();if(active()&&!S.manual)recenter()}});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();