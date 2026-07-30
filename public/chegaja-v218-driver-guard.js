/* ChegaJá 14.27.0 — bloqueio definitivo do painel legado e navegação aproximada */
(()=>{
'use strict';
if(window.__CJ218_DRIVER_GUARD__)return;window.__CJ218_DRIVER_GUARD__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const isDriver=()=>window.state?.user?.role==='driver';
const G={restoring:false,lastPoint:'',routeLayer:null,nav:null,timer:null};
const legacySelectors=['.v31-driver-app','.v31-driver-shell','.v31-driver-header','.v31-driver-strip','.v31-current-card','.v31-driver-map-card','.v31-day-summary','.v31-driver-bottom','#v31-driver-app','#cj190-driver-app','#cj196-driver-app','#cj24-driver-app','#cj212-call','#cj214-internal'];

function purgeLegacy(){
 if(!isDriver())return;
 for(const selector of legacySelectors)$$(selector).forEach(node=>node.remove());
 document.body.classList.remove('v31-driver-mode','v32-driver-single-menu','v36-driver-navigation','cj14-driver','cj143-driver','cj190-driver-home','cj24-driver-mode','cj196-driver-mode','driver-app-mode');
 const content=$('#page-content');
 if(window.state?.page==='dashboard'&&content&&!$('#cj199-app',content)&&!G.restoring){
  G.restoring=true;
  queueMicrotask(async()=>{try{await window.pages?.dashboard?.()}catch{}finally{G.restoring=false}});
 }
}
function disableLegacyController(){
 if(window.__CJ_DRIVER_14261__)return;
 const legacy=window.ChegaJaV31;
 if(!legacy||legacy.__cj218Disabled)return;
 try{legacy.stopDriver?.()}catch{}
 legacy.installDriver=async()=>{};
 legacy.loadDriverDashboard=async()=>{};
 legacy.__cj218Disabled=true;
 const previous=window.pages?.dashboard;
 if(previous&&!previous.__cj218Guard){
  const guarded=async function(...args){if(isDriver()){purgeLegacy();return}return previous.apply(this,args)};
  guarded.__cj218Guard=true;window.pages.dashboard=guarded;
 }
}
function ensureArrow(){
 let arrow=$('#cj218-nav-arrow');
 if(!arrow){
  arrow=document.createElement('div');arrow.id='cj218-nav-arrow';arrow.setAttribute('aria-hidden','true');
  arrow.innerHTML='<span><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 L57 57 L32 46 L7 57 Z"/></svg></span>';
  $('#cj199-app')?.appendChild(arrow);
 }
 return arrow;
}
function clearNavigation(){
 document.body.classList.remove('cj218-navigation');$('#cj218-nav-arrow')?.remove();
 if(G.routeLayer){try{G.routeLayer.remove()}catch{}G.routeLayer=null}
 G.nav=null;G.lastPoint='';
}
function drawDynamicRoute(route){
 const map=window.ChegaJaDriverMap?.map;if(!map||typeof L==='undefined')return;
 if(G.routeLayer){try{G.routeLayer.remove()}catch{}G.routeLayer=null}
 const points=(route?.geometry||[]).map(p=>Array.isArray(p)&&p.length>1?[Number(p[0]),Number(p[1])]:null).filter(p=>Number.isFinite(p?.[0])&&Number.isFinite(p?.[1]));
 if(points.length>1)G.routeLayer=L.polyline(points,{color:'#3214d9',weight:9,opacity:.95,lineCap:'round',lineJoin:'round'}).addTo(map);
}
function navigationEvent(event){
 if(!isDriver())return;
 G.nav=event.detail||null;
 if(!G.nav){clearNavigation();return}
 document.body.classList.add('cj218-navigation');ensureArrow();drawDynamicRoute(G.nav.route);
 followNow(true);
}
function followNow(force=false){
 if(!isDriver()||!window.ChegaJaDriverActiveDelivery){clearNavigation();return}
 const location=window.ChegaJaLastDriverLocation,map=window.ChegaJaDriverMap?.map;
 if(!location||!map)return;
 document.body.classList.add('cj218-navigation');const arrow=ensureArrow();
 const lat=Number(location.lat),lng=Number(location.lng),heading=Number(location.heading);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
 const key=`${lat.toFixed(6)}:${lng.toFixed(6)}:${Number.isFinite(heading)?Math.round(heading):0}`;
 if(!force&&key===G.lastPoint)return;G.lastPoint=key;
 const zoom=Math.max(18,Number(map.getZoom?.()||18));
 map.setView([lat,lng],zoom,{animate:true,duration:.28,noMoveStart:true});
 requestAnimationFrame(()=>{
  try{const size=map.getSize();map.panBy([0,-Math.round(size.y*.18)],{animate:true,duration:.22,noMoveStart:true})}catch{}
 });
 arrow.style.transform=`translate(-50%,-50%) rotate(${Number.isFinite(heading)?heading:0}deg)`;
}
function keepDeliveryLocked(){
 if(!isDriver())return;
 purgeLegacy();
 const active=window.ChegaJaDriverActiveDelivery;
 if(!active){clearNavigation();return}
 document.body.classList.add('cj217-active-delivery');
 const start=$('#cj199-start'),checkin=$('#cj199-checkin'),scale=$('#cj199-drawer [data-scale]');
 if(start)start.hidden=true;if(checkin)checkin.hidden=true;if(scale)scale.hidden=true;
 const sheet=$('#cj199-schedules');
 if(sheet&&!sheet.querySelector('.cj217-sheet'))window.dispatchEvent(new CustomEvent('cj:driver-open-delivery'));
 followNow(false);
}
function boot(){
 disableLegacyController();purgeLegacy();
 window.addEventListener('cj:driver-navigation',navigationEvent);
 new MutationObserver(()=>{disableLegacyController();purgeLegacy();keepDeliveryLocked()}).observe(document.documentElement,{childList:true,subtree:true});
 clearInterval(G.timer);G.timer=setInterval(()=>{disableLegacyController();keepDeliveryLocked()},500);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){purgeLegacy();keepDeliveryLocked();followNow(true)}});
}
disableLegacyController();
if(document.documentElement)new MutationObserver(()=>{disableLegacyController();purgeLegacy()}).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();