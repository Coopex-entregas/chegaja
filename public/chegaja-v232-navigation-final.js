/* ChegaJá 14.31.2 — rota azul persistente, zoom manual respeitado e navegação vertical/horizontal */
(()=>{
'use strict';
if(window.__CJ232_NAV_FINAL_14312__)return;
window.__CJ232_NAV_FINAL_14312__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const R={map:null,casing:null,line:null,key:'',points:[],busy:false,lastFetch:0,lastSuccess:0,manual:false,programmatic:false,interacting:false,savedView:null,osrmAt:0};
const active=()=>window.ChegaJaDriverActiveDelivery||null;
const home=()=>window.state?.user?.role==='driver'&&window.state?.page==='dashboard'&&!!$('#cj199-app');
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const valid=p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lng))&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lng))<=180;
const point=(lat,lng)=>({lat:Number(lat),lng:Number(lng)});

function distance(a,b){
 if(!valid(a)||!valid(b))return Infinity;
 const rad=value=>value*Math.PI/180,earth=6371000;
 const dLat=rad(Number(b.lat)-Number(a.lat)),dLng=rad(Number(b.lng)-Number(a.lng));
 const q=Math.sin(dLat/2)**2+Math.cos(rad(Number(a.lat)))*Math.cos(rad(Number(b.lat)))*Math.sin(dLng/2)**2;
 return 2*earth*Math.asin(Math.min(1,Math.sqrt(q)));
}
function gps(){
 const raw=window.ChegaJaLastDriverLocation;
 const value=point(raw?.lat??raw?.latitude,raw?.lng??raw?.longitude);
 return valid(value)?value:null;
}
function destination(){
 const item=active();if(!item)return null;
 const delivery=['picked_up','in_route','problem'].includes(String(item.status));
 const value=point(delivery?item.delivery_lat:item.pickup_lat,delivery?item.delivery_lng:item.pickup_lng);
 return valid(value)?value:null;
}
function decodePolyline(encoded,precision=5){
 if(typeof encoded!=='string'||encoded.length<4)return[];
 const out=[];let index=0,lat=0,lng=0;const factor=10**precision;
 try{
  while(index<encoded.length){
   let result=0,shift=0,byte;
   do{byte=encoded.charCodeAt(index++)-63;result|=(byte&31)<<shift;shift+=5}while(byte>=32&&index<=encoded.length);
   lat+=(result&1)?~(result>>1):(result>>1);
   result=0;shift=0;
   do{byte=encoded.charCodeAt(index++)-63;result|=(byte&31)<<shift;shift+=5}while(byte>=32&&index<=encoded.length);
   lng+=(result&1)?~(result>>1):(result>>1);
   out.push([lat/factor,lng/factor]);
  }
 }catch{return[]}
 return out;
}
function collectPairs(value){
 let raw=value;
 for(let i=0;i<3&&typeof raw==='string';i++){
  try{raw=JSON.parse(raw)}catch{return decodePolyline(raw)}
 }
 if(raw?.type==='Feature')raw=raw.geometry;
 if(raw?.geometry&&raw?.type!=='LineString'&&raw?.type!=='MultiLineString')raw=raw.geometry;
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
function routePairs(payload){
 const route=payload?.route||payload||{};
 const sources=[
  route.geometry,route.geojson,route.path,route.coordinates,
  route.routes?.[0]?.geometry,
  route.legs?.flatMap?.(leg=>(leg.steps||[]).map(step=>step.geometry)),
  payload?.geometry,payload?.geojson,payload?.path,payload?.coordinates
 ];
 for(const source of sources){
  const pairs=collectPairs(source);
  if(pairs.length>=2)return pairs;
 }
 const items=payload?.items||route?.items||[];
 const itemPairs=items.map(item=>[Number(item?.lat??item?.latitude),Number(item?.lng??item?.longitude)]).filter(item=>Number.isFinite(item[0])&&Number.isFinite(item[1]));
 return itemPairs.length>=2?itemPairs:[];
}
function normalize(pairs){
 if(!Array.isArray(pairs)||pairs.length<2)return[];
 const current=gps(),target=destination();
 const options=[
  pairs.map(item=>point(item[0],item[1])).filter(valid),
  pairs.map(item=>point(item[1],item[0])).filter(valid)
 ].filter(list=>list.length>=2);
 if(!options.length)return[];
 const nearest=(list,value)=>{
  if(!valid(value))return 0;
  let best=Infinity;const step=Math.max(1,Math.floor(list.length/180));
  for(let i=0;i<list.length;i+=step)best=Math.min(best,distance(list[i],value));
  return best;
 };
 let list=options[0],score=Infinity;
 for(const option of options){
  const value=nearest(option,current)+(valid(target)?Math.min(distance(option[0],target),distance(option.at(-1),target))*.35:0);
  if(value<score){score=value;list=option}
 }
 if(valid(target)&&distance(list.at(-1),target)>distance(list[0],target))list=[...list].reverse();
 else if(valid(current)&&distance(list[0],current)>distance(list.at(-1),current))list=[...list].reverse();
 return list;
}
function routeKey(points){
 if(points.length<2)return'';
 const first=points[0],last=points.at(-1);
 return`${points.length}:${first.lat.toFixed(5)}:${first.lng.toFixed(5)}:${last.lat.toFixed(5)}:${last.lng.toFixed(5)}`;
}
function removeRoute(){
 for(const layer of[R.line,R.casing])if(layer)try{layer.remove()}catch{}
 R.line=R.casing=null;R.key='';
}
function ensurePane(){
 if(!R.map)return;
 if(!R.map.getPane('cj232RoutePane')){
  const pane=R.map.createPane('cj232RoutePane');
  pane.style.zIndex='620';pane.style.pointerEvents='none';
 }
}
function draw(points,force=false){
 if(!R.map||typeof L==='undefined'||points.length<2)return;
 const key=routeKey(points),visible=R.line&&R.casing&&R.map.hasLayer?.(R.line)&&R.map.hasLayer?.(R.casing);
 if(!force&&key===R.key&&visible)return;
 removeRoute();ensurePane();R.points=points;R.key=key;
 const latlngs=points.map(item=>[item.lat,item.lng]);
 R.casing=L.polyline(latlngs,{pane:'cj232RoutePane',color:'#fff',weight:14,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,smoothFactor:.45}).addTo(R.map);
 R.line=L.polyline(latlngs,{pane:'cj232RoutePane',color:'#1459ff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,smoothFactor:.45}).addTo(R.map);
 for(const layer of[R.casing,R.line]){
  layer._cj222StableRoute=true;layer._cjSmoothRoute=true;layer._cj231Route=true;layer._cj232Route=true;
 }
 R.casing.bringToFront?.();R.line.bringToFront?.();
}
function rememberView(){
 if(!R.map)return;
 try{
  const center=R.map.getCenter(),zoom=R.map.getZoom();
  R.savedView={center:[center.lat,center.lng],zoom:Number(zoom)};
 }catch{}
}
function bindMap(){
 const map=window.ChegaJaDriverMap?.map;if(!map)return false;
 if(R.map===map)return true;
 R.map=map;removeRoute();
 map.on('dragstart',()=>{if(!R.programmatic){R.interacting=true;R.manual=true}});
 map.on('zoomstart',()=>{if(!R.programmatic){R.interacting=true;R.manual=true}});
 map.on('dragend',()=>{R.interacting=false;rememberView()});
 map.on('zoomend',()=>{R.interacting=false;rememberView()});
 map.on('moveend',()=>{if(R.manual&&!R.programmatic&&!R.interacting)rememberView()});
 setTimeout(()=>{try{map.invalidateSize(false)}catch{};if(R.points.length)draw(R.points,true)},100);
 return true;
}
function stopLegacyFollow(){
 try{window.ChegaJaDriverMap?.follow?.(false)}catch{}
}
function centralize(){
 if(!bindMap())return;
 const current=gps();if(!valid(current))return;
 R.manual=false;R.programmatic=true;R.savedView=null;
 stopLegacyFollow();
 try{R.map.stop?.()}catch{}
 try{R.map.invalidateSize(false)}catch{}
 const comfortable=innerWidth>innerHeight?17.5:18;
 try{R.map.setView([current.lat,current.lng],comfortable,{animate:false,noMoveStart:true})}catch{}
 setTimeout(()=>{R.programmatic=false;rememberView()},500);
}
function preserveAcrossOrientation(){
 if(!bindMap())return;
 rememberView();const saved=R.savedView;
 for(const delay of[80,240,520])setTimeout(()=>{
  document.body.classList.remove('cj222-landscape-blocked');$('#cj222-portrait-lock')?.remove();
  try{R.map.invalidateSize(false)}catch{}
  if(saved){
   R.programmatic=true;
   try{R.map.setView(saved.center,saved.zoom,{animate:false,noMoveStart:true})}catch{}
   setTimeout(()=>{R.programmatic=false},80);
  }
  if(R.points.length)draw(R.points,true);
 },delay);
}
async function osrmFallback(){
 const current=gps(),target=destination();
 if(!valid(current)||!valid(target)||Date.now()-R.osrmAt<15000)return[];
 R.osrmAt=Date.now();
 try{
  const url=`https://router.project-osrm.org/route/v1/driving/${current.lng},${current.lat};${target.lng},${target.lat}?overview=full&geometries=geojson&steps=false`;
  const response=await fetch(url,{cache:'no-store'});const data=await response.json().catch(()=>({}));
  return normalize(routePairs(data?.routes?.[0]||data));
 }catch{return[]}
}
async function fetchRoute(force=false){
 if(!active()||!token()||R.busy||document.hidden)return;
 const now=Date.now();if(!force&&now-R.lastFetch<3500)return;
 R.lastFetch=now;R.busy=true;
 try{
  const response=await fetch('/api/app/v32/driver/navigation',{headers:{Authorization:`Bearer ${token()}`},cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  let points=response.ok&&data?.ok!==false?normalize(routePairs(data)):[];
  if(points.length<2)points=await osrmFallback();
  if(points.length>=2){R.lastSuccess=Date.now();draw(points,true)}
 }catch{
  const points=await osrmFallback();if(points.length>=2)draw(points,true);
 }finally{R.busy=false}
}
function handleNavigation(event){
 const points=normalize(routePairs(event.detail||{}));
 if(points.length>=2){R.lastSuccess=Date.now();draw(points,true)}
}
function tick(){
 document.body.classList.remove('cj222-landscape-blocked');$('#cj222-portrait-lock')?.remove();
 if(!home())return;
 if(!bindMap())return;
 stopLegacyFollow();
 if(active()){
  if(R.points.length){
   const visible=R.line&&R.casing&&R.map.hasLayer?.(R.line)&&R.map.hasLayer?.(R.casing);
   if(!visible)draw(R.points,true);
  }
  if(R.points.length<2||Date.now()-R.lastSuccess>10000)fetchRoute(R.points.length<2);
 }else{R.points=[];removeRoute()}
}

document.addEventListener('click',event=>{
 const button=event.target?.closest?.('#cj222-recenter,#cj199-center');
 if(!button)return;
 event.preventDefault();event.stopImmediatePropagation();centralize();
},{capture:true});
window.addEventListener('cj:driver-navigation',handleNavigation);
window.addEventListener('orientationchange',preserveAcrossOrientation);
window.addEventListener('resize',preserveAcrossOrientation);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){preserveAcrossOrientation();fetchRoute(true)}});
setInterval(tick,400);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
})();
