/* ChegaJá 14.29.5 — painel único seguro do cooperado */
(()=>{
'use strict';
if(window.__CJ221_DRIVER_SINGLE_PANEL__)return;
window.__CJ221_DRIVER_SINGLE_PANEL__=true;
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const isDriverDashboard=()=>window.state?.user?.role==='driver'&&window.state?.page==='dashboard';
const legacySelectors=['.v31-driver-app','.v31-driver-shell','.v31-driver-header','.v31-driver-strip','.v31-current-card','.v31-driver-map-card','.v31-day-summary','.v31-driver-bottom','#v31-driver-app','#cj190-driver-app','#cj196-driver-app','#cj24-driver-app','#cj212-call','#cj214-internal','.driver-dashboard','.driver-home'];
let observer=null,observed=null;
function keepSinglePanel(){
  if(!isDriverDashboard())return;
  const content=$('#page-content');
  if(!content)return;
  const apps=$$('#cj199-app',content),app=apps[0];
  if(!app)return;
  apps.slice(1).forEach(node=>node.remove());
  legacySelectors.forEach(selector=>$$(selector,content).forEach(node=>node.remove()));
  [...content.children].forEach(child=>{if(child!==app)child.remove()});
  app.hidden=false;
  app.style.removeProperty('display');
  app.style.removeProperty('visibility');
  app.style.removeProperty('opacity');
  app.style.pointerEvents='auto';
  const host=$('#cj199-map',app);
  if(host){host.hidden=false;host.style.setProperty('display','block','important');host.style.setProperty('visibility','visible','important');host.style.setProperty('opacity','1','important')}
}
function bind(){
  const content=$('#page-content');
  if(!content||observed===content)return;
  observer?.disconnect();observed=content;
  observer=new MutationObserver(()=>queueMicrotask(keepSinglePanel));
  observer.observe(content,{childList:true,subtree:false});
}
function tick(){bind();keepSinglePanel()}
window.addEventListener('hashchange',()=>setTimeout(tick,0));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
window.addEventListener('load',tick,{once:true});
setInterval(tick,700);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
})();
