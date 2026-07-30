/* ChegaJá 14.30.0 — mapa navegável, rotação com dois dedos e recentralização manual */
(()=>{
'use strict';
if(window.__CJ226_DRIVER_MAP_GESTURE_14300__)return;
window.__CJ226_DRIVER_MAP_GESTURE_14300__=true;

const M={map:null,container:null,mapPane:null,observer:null,originalSetView:null,lastTransform:'',pointers:new Map(),gesture:null,bearing:0,manual:false,programmatic:false,applying:false,timer:null,lastDeliveryId:''};
const isDriverHome=()=>window.state?.user?.role==='driver'&&document.body.classList.contains('cj199-driver');
const activeNavigation=()=>Boolean(window.ChegaJaDriverActiveDelivery);
const normalize=value=>((Number(value)||0)%360+360)%360;
const signed=value=>{const n=normalize(value);return n>180?n-360:n};
const location=()=>{
 const raw=window.ChegaJaLastDriverLocation;
 const lat=Number(raw?.lat),lng=Number(raw?.lng),heading=Number(raw?.heading);
 return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng,heading:Number.isFinite(heading)&&heading>=0?heading:null}:null;
};
const angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;

function stripRotation(transform){
 return String(transform||'').replace(/\s+rotate\([^)]*\)/g,'').replace(/\s+scale\([^)]*\)/g,'').trim();
}
function paneOrigin(){
 if(!M.map)return{x:0,y:0};
 const size=M.map.getSize?.(),pos=M.map._getMapPanePos?.();
 if(!size)return{x:0,y:0};
 return{x:size.x/2-Number(pos?.x||0),y:size.y/2-Number(pos?.y||0)};
}
function rotationScale(){
 const radians=Math.abs(signed(M.bearing))*Math.PI/180;
 return Math.max(1,Math.min(1.42,Math.abs(Math.cos(radians))+Math.abs(Math.sin(radians))));
}
function updateMarkerScale(scale){
 const inverse=1/scale;
 const arrow=M.container?.querySelector('.cj224-heading');
 const dot=M.container?.querySelector('.cj224-position-dot');
 const label=M.container?.querySelector('.cj224-position-marker b');
 if(arrow)arrow.style.scale=String(inverse);
 if(dot)dot.style.scale=String(inverse);
 if(label){label.style.scale=String(inverse);label.style.rotate=`${-signed(M.bearing)}deg`}
}
function applyRotation(){
 if(!M.mapPane||M.applying)return;
 M.applying=true;
 try{
  const base=stripRotation(M.mapPane.style.transform);
  const origin=paneOrigin(),scale=rotationScale();
  const expected=`${base} rotate(${signed(M.bearing)}deg) scale(${scale})`;
  M.mapPane.style.transformOrigin=`${origin.x}px ${origin.y}px`;
  if(M.mapPane.style.transform!==expected)M.mapPane.style.transform=expected;
  M.lastTransform=expected;
  M.container?.style.setProperty('--cj-map-bearing',String(signed(M.bearing)));
  M.container?.style.setProperty('--cj-map-scale',String(scale));
  updateMarkerScale(scale);
 }finally{M.applying=false}
}
function setManual(value){
 M.manual=Boolean(value);
 const button=document.querySelector('#cj199-center');
 button?.classList.toggle('manual',M.manual);
 if(button)button.title=M.manual?'Alinhar novamente e seguir sua posição':'Mapa alinhado com sua navegação';
 if(M.manual)window.ChegaJaDriverMap?.follow?.(false);
}
function recenter(){
 const point=location();
 if(!M.map||!point)return;
 setManual(false);
 M.bearing=point.heading==null?0:-point.heading;
 applyRotation();
 M.programmatic=true;
 try{
  M.map.setView([point.lat,point.lng],19.5,{animate:true,duration:.35,cjUser:true});
  requestAnimationFrame(()=>{
   try{const size=M.map.getSize();M.map.panBy([0,-Math.round(size.y*.18)],{animate:true,duration:.28,noMoveStart:true})}catch{}
  });
  window.ChegaJaDriverMap?.follow?.(true);
 }finally{queueMicrotask(()=>{M.programmatic=false})}
}
function bindCenter(){
 const button=document.querySelector('#cj199-center');
 if(!button||button.dataset.cj226==='1')return;
 button.dataset.cj226='1';
 button.type='button';
 button.innerHTML='<span aria-hidden="true">⌖</span>';
 button.setAttribute('aria-label','Alinhar mapa com minha localização');
 button.onclick=event=>{event.preventDefault();event.stopPropagation();recenter()};
}
function wrapSetView(){
 if(!M.map||M.originalSetView)return;
 M.originalSetView=M.map.setView.bind(M.map);
 M.map.setView=function(center,zoom,options={}){
  if(M.manual&&activeNavigation()&&!options?.cjUser)return this;
  let adjusted=zoom;
  if(activeNavigation()&&Number.isFinite(Number(zoom))&&!options?.cjUser)adjusted=Math.max(19.25,Math.min(19.75,Number(zoom)));
  M.programmatic=true;
  try{return M.originalSetView(center,adjusted,options)}
  finally{queueMicrotask(()=>{M.programmatic=false;applyRotation()})}
 };
}
function beginGesture(){
 if(M.pointers.size!==2){M.gesture=null;return}
 const [a,b]=[...M.pointers.values()];
 M.gesture={angle:angle(a,b),bearing:M.bearing};
}
function bindGesture(){
 if(!M.container||M.container.dataset.cj226Gesture==='1')return;
 M.container.dataset.cj226Gesture='1';
 M.container.style.touchAction='none';
 const down=event=>{
  if(event.pointerType!=='touch')return;
  M.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(M.pointers.size===2){beginGesture();setManual(true)}
 };
 const move=event=>{
  if(!M.pointers.has(event.pointerId))return;
  M.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(M.pointers.size!==2||!M.gesture)return;
  const [a,b]=[...M.pointers.values()],delta=angle(a,b)-M.gesture.angle;
  if(Math.abs(delta)<1)return;
  M.bearing=M.gesture.bearing+delta;
  applyRotation();
 };
 const end=event=>{M.pointers.delete(event.pointerId);beginGesture()};
 M.container.addEventListener('pointerdown',down,{passive:true});
 M.container.addEventListener('pointermove',move,{passive:true});
 M.container.addEventListener('pointerup',end,{passive:true});
 M.container.addEventListener('pointercancel',end,{passive:true});
}
function bindMapEvents(){
 if(!M.map||M.map.__cj226Events)return;
 M.map.__cj226Events=true;
 M.map.on('dragstart zoomstart',()=>{if(!M.programmatic)setManual(true)});
 M.map.on('move zoom',()=>applyRotation());
 M.map.touchZoom?.enable?.();
 M.map.dragging?.enable?.();
}
function observePane(){
 if(!M.mapPane||M.observer)return;
 M.observer=new MutationObserver(()=>{if(!M.applying&&M.mapPane?.style.transform!==M.lastTransform)requestAnimationFrame(applyRotation)});
 M.observer.observe(M.mapPane,{attributes:true,attributeFilter:['style']});
}
function attach(){
 const map=window.ChegaJaDriverMap?.map,container=document.querySelector('#cj199-map');
 if(!map||!container)return;
 if(M.map!==map){
  M.observer?.disconnect();
  M.map=map;M.container=container;M.mapPane=map._mapPane;M.observer=null;M.originalSetView=null;M.lastTransform='';M.lastDeliveryId='';
  wrapSetView();bindMapEvents();bindGesture();observePane();applyRotation();
 }
 bindCenter();
}
function navigationEvent(){
 attach();
 const id=String(window.ChegaJaDriverActiveDelivery?.id||'');
 if(!id){M.lastDeliveryId='';return}
 if(id!==M.lastDeliveryId){M.lastDeliveryId=id;if(!M.manual)recenter()}
}
function health(){
 if(!isDriverHome())return;
 attach();
 applyRotation();
}
function boot(){
 window.addEventListener('cj:driver-navigation',navigationEvent);
 clearInterval(M.timer);M.timer=setInterval(health,900);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)health()});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();
