/* ChegaJá 14.30.0 — mapa acompanha apenas deslocamento real e usa zoom legível */
(()=>{
'use strict';
if(window.__CJ228_DRIVER_MAP_FOLLOW_14300__)return;
window.__CJ228_DRIVER_MAP_FOLLOW_14300__=true;

const P={map:null,originalSetView:null,originalMove:null,lastGps:null,allowUntil:0,userUntil:0,lastDeliveryId:'',timer:null};
const isDriverHome=()=>window.state?.user?.role==='driver'&&window.state?.page==='dashboard';
const active=()=>window.ChegaJaDriverActiveDelivery||null;
const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
function point(raw){return{lat:Number(raw?.lat??raw?.latitude),lng:Number(raw?.lng??raw?.longitude)}}
function distance(a,b){
 if(!valid(a)||!valid(b))return Infinity;
 const dLat=(b.lat-a.lat)*111320;
 const dLng=(b.lng-a.lng)*111320*Math.cos(a.lat*Math.PI/180);
 return Math.hypot(dLat,dLng);
}
function navigationZoom(){
 const width=Math.max(320,window.innerWidth||360);
 return width<=390?19.5:19.25;
}
function configureTiles(map){
 try{map.options.zoomSnap=.25;map.options.zoomDelta=.25;map.setMaxZoom(20)}catch{}
 try{
  map.eachLayer(layer=>{
   if(typeof L!=='undefined'&&layer instanceof L.TileLayer){
    layer.options.maxNativeZoom=19;
    layer.options.maxZoom=20;
    layer.options.updateWhenZooming=true;
    layer.redraw?.();
   }
  });
 }catch{}
}
function markUserGesture(){P.userUntil=Date.now()+1800}
function bindGestures(map){
 if(map.__cj228Gestures)return;
 map.__cj228Gestures=true;
 const host=map.getContainer?.();
 for(const name of ['pointerdown','touchstart','wheel'])host?.addEventListener(name,markUserGesture,{passive:true});
 map.on?.('dragstart zoomstart',markUserGesture);
}
function wrapSetView(map){
 if(map.__cj228SetView)return;
 map.__cj228SetView=true;
 const original=map.setView.bind(map);
 P.originalSetView=original;
 map.setView=function(center,zoom,options={}){
  const now=Date.now(),work=Boolean(active()),user=Boolean(options?.cjUser||options?.cjRecenter)||now<P.userUntil;
  if(work&&!user&&now>P.allowUntil)return this;
  let adjusted=zoom;
  if(work&&Number.isFinite(Number(zoom)))adjusted=Math.max(navigationZoom(),Math.min(19.75,Number(zoom)));
  return original(center,adjusted,options);
 };
}
function wrapMove(){
 const api=window.ChegaJaDriverMap;
 if(!api||typeof api.move!=='function'||api.__cj228Move)return;
 api.__cj228Move=true;
 const original=api.move.bind(api);
 P.originalMove=original;
 api.move=function(raw){
  const next=point(raw),moved=distance(P.lastGps,next);
  if(valid(next)&&(!valid(P.lastGps)||moved>=3))P.allowUntil=Date.now()+900;
  if(valid(next))P.lastGps=next;
  const result=original(raw);
  if(valid(next)&&moved>=3&&active()&&P.map){
   P.allowUntil=Date.now()+900;
   P.map.setView([next.lat,next.lng],navigationZoom(),{animate:true,duration:.28,noMoveStart:true,cjRecenter:true});
   requestAnimationFrame(()=>{
    try{const size=P.map.getSize();P.map.panBy([0,-Math.round(size.y*.18)],{animate:true,duration:.24,noMoveStart:true})}catch{}
   });
  }
  return result;
 };
}
function recenterInitial(){
 const delivery=active(),id=String(delivery?.id||'');
 if(!delivery||!id||id===P.lastDeliveryId)return;
 P.lastDeliveryId=id;
 const raw=window.ChegaJaLastDriverLocation,next=point(raw);
 if(!valid(next)||!P.map)return;
 P.allowUntil=Date.now()+1500;
 P.map.setView([next.lat,next.lng],navigationZoom(),{animate:false,cjUser:true});
 requestAnimationFrame(()=>{try{const size=P.map.getSize();P.map.panBy([0,-Math.round(size.y*.18)],{animate:false})}catch{}});
}
function attach(){
 const map=window.ChegaJaDriverMap?.map;
 if(!map)return;
 if(P.map!==map){
  P.map=map;P.originalSetView=null;
  configureTiles(map);bindGestures(map);wrapSetView(map);
 }
 wrapMove();
 recenterInitial();
}
function health(){
 if(!isDriverHome())return;
 attach();
 configureTiles(P.map);
}
function boot(){
 window.addEventListener('cj:driver-navigation',()=>{attach();recenterInitial()});
 clearInterval(P.timer);P.timer=setInterval(health,700);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)health()});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();
