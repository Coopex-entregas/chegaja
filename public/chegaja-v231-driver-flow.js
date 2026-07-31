/* ChegaJá 14.30.7 — rota azul, chamada sonora e fluxo simples do cooperado */
(()=>{
'use strict';
if(window.__CJ231_DRIVER_FLOW_14307__)return;
window.__CJ231_DRIVER_FLOW_14307__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const F={
  offerId:'',
  audio:null,
  route:null,
  routeKey:'',
  map:null,
  casing:null,
  line:null,
  timers:new Set(),
  lastMap:null
};

const isDriver=()=>window.state?.user?.role==='driver';
const isDriverHome=()=>isDriver()&&window.state?.page==='dashboard'&&!!$('#cj199-app');
const currentDelivery=()=>window.ChegaJaDriverCurrentDelivery||null;
const activeDelivery=()=>window.ChegaJaDriverActiveDelivery||null;
const pendingOffer=()=>window.ChegaJaDriverPendingOffer||null;
const valid=p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lng));
const numberPoint=(lat,lng)=>({lat:Number(lat),lng:Number(lng)});

function distance(a,b){
  if(!valid(a)||!valid(b))return Infinity;
  const rad=x=>x*Math.PI/180,R=6371000;
  const dLat=rad(Number(b.lat)-Number(a.lat));
  const dLng=rad(Number(b.lng)-Number(a.lng));
  const q=Math.sin(dLat/2)**2+
    Math.cos(rad(Number(a.lat)))*Math.cos(rad(Number(b.lat)))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
}

function currentGps(){
  const raw=window.ChegaJaLastDriverLocation;
  const point=numberPoint(raw?.lat??raw?.latitude,raw?.lng??raw?.longitude);
  return valid(point)?point:null;
}

function unlockAudio(){
  try{
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)return;
    if(!F.audio)F.audio=new Context();
    if(F.audio.state==='suspended')F.audio.resume().catch(()=>{});
    if(!F.audio.__cjUnlocked){
      const gain=F.audio.createGain();
      const oscillator=F.audio.createOscillator();
      gain.gain.value=0.00001;
      oscillator.connect(gain);
      gain.connect(F.audio.destination);
      oscillator.start();
      oscillator.stop(F.audio.currentTime+.02);
      F.audio.__cjUnlocked=true;
    }
  }catch{}
}

function playOfferSound(){
  unlockAudio();
  const context=F.audio;
  if(!context||context.state!=='running')return;
  const start=context.currentTime+.02;
  const tones=[
    {frequency:740,at:0,duration:.16},
    {frequency:940,at:.21,duration:.18},
    {frequency:1180,at:.45,duration:.28}
  ];
  for(const tone of tones){
    try{
      const oscillator=context.createOscillator();
      const gain=context.createGain();
      oscillator.type='sine';
      oscillator.frequency.setValueAtTime(tone.frequency,start+tone.at);
      gain.gain.setValueAtTime(.0001,start+tone.at);
      gain.gain.exponentialRampToValueAtTime(.22,start+tone.at+.025);
      gain.gain.exponentialRampToValueAtTime(.0001,start+tone.at+tone.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start+tone.at);
      oscillator.stop(start+tone.at+tone.duration+.03);
    }catch{}
  }
}

function schedule(callback,delay){
  const timer=setTimeout(()=>{
    F.timers.delete(timer);
    callback();
  },delay);
  F.timers.add(timer);
}

function decorateSheet(){
  if(!isDriver())return;
  $('#cj217-nav')?.setAttribute('hidden','');
  $$('.cj217-sheet .arrived').forEach(node=>node.remove());

  const delivery=currentDelivery();
  const status=String(delivery?.status||'');
  const button=$('#cj217-action');
  if(button&&['accepted','to_pickup','at_pickup'].includes(status)){
    button.textContent='COLETA REALIZADA';
    button.dataset.action='picked_up';
  }
}

function openDeliverySheet(){
  if(!isDriver())return;
  window.dispatchEvent(new CustomEvent('cj:driver-open-delivery'));
  const open=()=>{
    const sheet=$('#cj199-sheet');
    if(!sheet)return;
    sheet.hidden=false;
    sheet.classList.add('open');
    const up=$('#cj199-up');
    if(up)up.textContent='⌄';
    decorateSheet();
    try{window.ChegaJaDriverMap?.map?.invalidateSize?.(false)}catch{}
  };
  for(const delay of [0,70,180,360,700])schedule(open,delay);
}

function offerId(detail){
  if(detail&&typeof detail==='object')return String(detail.id||detail.item?.id||'');
  return String(detail||'');
}

function receiveOffer(detail){
  const id=offerId(detail);
  if(!id){
    F.offerId='';
    return;
  }
  if(id===F.offerId){
    openDeliverySheet();
    return;
  }
  F.offerId=id;
  playOfferSound();
  openDeliverySheet();
}

function geometry(route){
  let raw=route?.geometry??route?.coordinates??[];
  if(raw?.type==='Feature')raw=raw.geometry;
  if(raw?.type==='LineString')raw=raw.coordinates;
  if(raw?.type==='MultiLineString')raw=(raw.coordinates||[]).flat();
  if(!Array.isArray(raw))return [];

  const direct=[];
  const swapped=[];
  for(const item of raw){
    if(!Array.isArray(item)||item.length<2)continue;
    const a=Number(item[0]),b=Number(item[1]);
    if(!Number.isFinite(a)||!Number.isFinite(b))continue;
    const p1=numberPoint(a,b);
    const p2=numberPoint(b,a);
    if(valid(p1))direct.push(p1);
    if(valid(p2))swapped.push(p2);
  }
  if(direct.length<2&&swapped.length<2)return [];
  if(direct.length<2)return swapped;
  if(swapped.length<2)return direct;

  const gps=currentGps();
  if(gps){
    const score=list=>{
      let best=Infinity;
      const step=Math.max(1,Math.floor(list.length/60));
      for(let i=0;i<list.length;i+=step)best=Math.min(best,distance(gps,list[i]));
      return best;
    };
    return score(direct)<=score(swapped)?direct:swapped;
  }

  const first=raw.find(item=>Array.isArray(item)&&item.length>1);
  if(first&&Math.abs(Number(first[0]))>20&&Math.abs(Number(first[1]))<20)return swapped;
  return direct;
}

function keyFor(points){
  if(points.length<2)return'';
  const first=points[0],last=points.at(-1);
  return `${points.length}:${first.lat.toFixed(5)}:${first.lng.toFixed(5)}:${last.lat.toFixed(5)}:${last.lng.toFixed(5)}`;
}

function removeRoute(){
  for(const layer of [F.line,F.casing]){
    if(layer)try{layer.remove()}catch{}
  }
  F.line=F.casing=null;
  F.routeKey='';
}

function removeOtherBlueRoutes(){
  const map=F.map;
  if(!map||typeof L==='undefined')return;
  try{
    map.eachLayer(layer=>{
      if(layer===F.line||layer===F.casing||layer?._cj231Route)return;
      if(!(layer instanceof L.Polyline)||layer instanceof L.Polygon)return;
      const color=String(layer.options?.color||'').toLowerCase();
      const weight=Number(layer.options?.weight||0);
      const routeLike=layer.options?.interactive===false&&weight>=6&&
        ['#1459ff','#0d45d8','#0b57d0','#fff','#ffffff'].includes(color);
      if(routeLike)map.removeLayer(layer);
    });
  }catch{}
}

function attachMap(){
  const map=window.ChegaJaDriverMap?.map;
  if(!map||typeof L==='undefined')return false;
  if(F.map!==map){
    removeRoute();
    F.map=map;
    F.lastMap=map;
  }
  if(!map.getPane('cj231RoutePane')){
    const pane=map.createPane('cj231RoutePane');
    pane.classList.add('cj231-route-pane');
    pane.style.zIndex='520';
    pane.style.pointerEvents='none';
  }
  return true;
}

function drawRoute(force=false){
  if(!isDriverHome()||!F.route||!attachMap())return;
  const points=geometry(F.route);
  const key=keyFor(points);
  if(!key)return;
  const stillVisible=F.line&&F.casing&&F.map.hasLayer?.(F.line)&&F.map.hasLayer?.(F.casing);
  if(!force&&key===F.routeKey&&stillVisible){
    removeOtherBlueRoutes();
    F.casing.bringToFront?.();
    F.line.bringToFront?.();
    return;
  }

  removeRoute();
  F.routeKey=key;
  const latLngs=points.map(point=>[point.lat,point.lng]);
  F.casing=L.polyline(latLngs,{
    pane:'cj231RoutePane',
    color:'#ffffff',
    weight:14,
    opacity:1,
    lineCap:'round',
    lineJoin:'round',
    interactive:false,
    smoothFactor:.55,
    className:'cj231-route-casing'
  }).addTo(F.map);
  F.line=L.polyline(latLngs,{
    pane:'cj231RoutePane',
    color:'#1459ff',
    weight:8,
    opacity:1,
    lineCap:'round',
    lineJoin:'round',
    interactive:false,
    smoothFactor:.55,
    className:'cj231-route-line'
  }).addTo(F.map);
  F.casing._cj231Route=F.line._cj231Route=true;
  F.casing._cjSmoothRoute=F.line._cjSmoothRoute=true;
  removeOtherBlueRoutes();
  F.casing.bringToFront?.();
  F.line.bringToFront?.();
}

function navigation(event){
  const detail=event.detail||null;
  if(detail?.route){
    F.route=detail.route;
    F.routeKey='';
    drawRoute(true);
  }else if(!activeDelivery()){
    F.route=null;
    removeRoute();
  }
}

function tick(){
  if(!isDriver())return;
  decorateSheet();

  const offer=pendingOffer();
  if(offer){
    const id=String(offer.id||'');
    if(id&&id!==F.offerId)receiveOffer({id,item:offer});
  }else if(!currentDelivery()){
    F.offerId='';
  }

  if(isDriverHome()&&activeDelivery()&&F.route)drawRoute(false);
  if(!activeDelivery()&&!pendingOffer()&&!currentDelivery()){
    F.route=null;
    removeRoute();
  }
}

window.addEventListener('cj:driver-offer',event=>receiveOffer(event.detail));
window.addEventListener('cj:driver-navigation',navigation);
window.addEventListener('cj:driver-open-delivery',()=>schedule(decorateSheet,0));

for(const eventName of ['pointerdown','touchstart','click']){
  document.addEventListener(eventName,unlockAudio,{capture:true,passive:true});
}

new MutationObserver(()=>queueMicrotask(decorateSheet))
  .observe(document.documentElement,{childList:true,subtree:true});

setInterval(tick,300);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});
else tick();
})();
