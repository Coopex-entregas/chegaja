/* ChegaJá 14.29.2 — painel único seguro e rota azul persistente do cooperado */
(()=>{
'use strict';
if(window.__CJ221_DRIVER_SINGLE_PANEL__)return;
window.__CJ221_DRIVER_SINGLE_PANEL__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const isDriverDashboard=()=>window.state?.user?.role==='driver'&&window.state?.page==='dashboard';
const legacySelectors=[
  '.v31-driver-app','.v31-driver-shell','.v31-driver-header','.v31-driver-strip',
  '.v31-current-card','.v31-driver-map-card','.v31-day-summary','.v31-driver-bottom',
  '#v31-driver-app','#cj190-driver-app','#cj196-driver-app','#cj24-driver-app',
  '#cj212-call','#cj214-internal','.driver-dashboard','.driver-home'
];
let contentObserver=null;
let routeMain=null;
let routeCasing=null;
let lastRoute=null;
let lastRouteKey='';

function removeOwnRoute(reset=true){
  for(const layer of [routeMain,routeCasing]){
    if(layer)try{layer.remove()}catch{}
  }
  routeMain=null;
  routeCasing=null;
  if(reset){lastRoute=null;lastRouteKey=''}
}

function keepSinglePanel(){
  if(!isDriverDashboard())return;
  const content=$('#page-content');
  if(!content)return;
  const apps=$$('#cj199-app',content);
  const app=apps[0];
  if(!app)return;

  for(const duplicate of apps.slice(1))duplicate.remove();
  for(const selector of legacySelectors)$$(selector,content).forEach(node=>node.remove());
  for(const child of [...content.children]){
    if(child!==app)child.remove();
  }

  app.hidden=false;
  app.style.removeProperty('display');
  app.style.removeProperty('visibility');
  app.style.removeProperty('opacity');
  app.style.pointerEvents='auto';

  const mapHost=$('#cj199-map',app);
  if(mapHost){
    mapHost.hidden=false;
    mapHost.style.setProperty('display','block','important');
    mapHost.style.setProperty('visibility','visible','important');
    mapHost.style.setProperty('opacity','1','important');
  }
  const map=window.ChegaJaDriverMap?.map;
  if(map)setTimeout(()=>{try{map.invalidateSize(false)}catch{}},30);
}

function routePoints(route){
  return (route?.geometry||[])
    .map(point=>Array.isArray(point)&&point.length>1?[Number(point[0]),Number(point[1])]:null)
    .filter(point=>Number.isFinite(point?.[0])&&Number.isFinite(point?.[1]));
}

function keyFor(points){
  if(points.length<2)return'';
  const first=points[0],last=points[points.length-1];
  return `${points.length}:${first[0].toFixed(5)}:${first[1].toFixed(5)}:${last[0].toFixed(5)}:${last[1].toFixed(5)}`;
}

function drawBlueRoute(route){
  if(route)lastRoute=route;
  if(!isDriverDashboard()||!lastRoute)return;
  const map=window.ChegaJaDriverMap?.map;
  if(!map||typeof window.L==='undefined')return;
  const points=routePoints(lastRoute);
  const key=keyFor(points);
  if(!key)return;
  if(key===lastRouteKey&&routeMain&&routeCasing)return;
  removeOwnRoute(false);
  lastRouteKey=key;
  routeCasing=L.polyline(points,{color:'#ffffff',weight:12,opacity:.96,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
  routeMain=L.polyline(points,{color:'#1459ff',weight:7,opacity:1,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
  routeCasing.bringToFront?.();
  routeMain.bringToFront?.();
}

function onNavigation(event){
  if(!isDriverDashboard())return;
  keepSinglePanel();
  const detail=event.detail||null;
  if(detail?.route)drawBlueRoute(detail.route);
  else if(!detail||!window.ChegaJaDriverActiveDelivery)removeOwnRoute(true);
}

function bindContentObserver(){
  const content=$('#page-content');
  if(!content||contentObserver)return;
  contentObserver=new MutationObserver(()=>queueMicrotask(()=>{
    keepSinglePanel();
    drawBlueRoute();
  }));
  contentObserver.observe(content,{childList:true,subtree:false});
}

function tick(){
  bindContentObserver();
  keepSinglePanel();
  if(window.ChegaJaDriverActiveDelivery)drawBlueRoute();
  else if(lastRoute)removeOwnRoute(true);
}

window.addEventListener('cj:driver-navigation',onNavigation);
window.addEventListener('hashchange',()=>setTimeout(tick,0));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
window.addEventListener('load',tick,{once:true});
setInterval(tick,600);
if(document.readyState!=='loading')tick();
else document.addEventListener('DOMContentLoaded',tick,{once:true});
})();
