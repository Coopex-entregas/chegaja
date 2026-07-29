/* ChegaJá 14.22.5 — trava definitiva: somente um painel do cooperado */
(()=>{
'use strict';
if(window.__CJ209_DRIVER_SINGLE__)return;
window.__CJ209_DRIVER_SINGLE__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const R={restoring:false,queued:false,lastRestore:0};
const isDriver=()=>window.state?.user?.role==='driver';
const isDashboard=()=>isDriver()&&window.state?.page==='dashboard';

function removeLegacy(){
 if(!isDriver())return false;
 let found=false;
 const selectors=[
  '.v31-driver-app','#v32-driver-drawer','.v31-driver-bottom',
  '#cj143-driver-nav','#cj143-driver-menu','#cj143-driver-drawer',
  '#cj42-driver-nav','#cj42-driver-menu','#cj42-driver-drawer',
  '#cj190-page-menu','#cj190-drawer','#cj196-driver-app','#cj24-driver-app'
 ];
 for(const selector of selectors){
  $$(selector).forEach(node=>{found=true;node.remove()});
 }
 document.body.classList.remove('v31-driver-mode','v32-driver-single-menu','cj143-driver','cj190-driver-home','cj196-driver-mode','cj24-driver-mode','driver-app-mode');
 try{window.ChegaJaV31?.stopDriver?.()}catch{}
 return found;
}

async function restoreNewPanel(force=false){
 if(!isDashboard()||R.restoring)return;
 const legacy=removeLegacy();
 const current=$('#cj199-app');
 if(current&&!legacy&&!force)return;
 if(Date.now()-R.lastRestore<250&&!force)return;
 R.lastRestore=Date.now();R.restoring=true;
 try{
  if(typeof window.pages?.dashboard==='function')await window.pages.dashboard();
 }catch(error){console.error('Não foi possível restaurar o painel único do cooperado:',error)}
 finally{R.restoring=false}
}
function scheduleRestore(force=false){
 if(R.queued)return;R.queued=true;
 queueMicrotask(()=>{R.queued=false;restoreNewPanel(force)});
}
function lockLegacyApi(){
 const old=window.ChegaJaV31;if(!old||old.__cj209Locked)return;
 try{old.stopDriver?.()}catch{}
 old.__cj209Locked=true;
 old.installDriver=()=>restoreNewPanel(true);
 old.loadDriverDashboard=()=>Promise.resolve();
}
function enforce(){
 if(!isDriver())return;
 lockLegacyApi();
 if(isDashboard()){
  const hadLegacy=Boolean($('.v31-driver-app'));
  removeLegacy();
  if(hadLegacy||!$('#cj199-app'))scheduleRestore(true);
 }
}

// O evento antigo de visibilitychange recriava o V31 ao voltar para a aba.
// Esta captura impede apenas esse fluxo quando o usuário é cooperado.
document.addEventListener('visibilitychange',event=>{
 if(!isDriver())return;
 event.stopImmediatePropagation();
 if(!document.hidden)setTimeout(()=>{enforce();scheduleRestore(true)},0);
},true);

new MutationObserver(()=>requestAnimationFrame(enforce)).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('pageshow',()=>{enforce();scheduleRestore(true)});
window.addEventListener('load',()=>{enforce();scheduleRestore(true)},{once:true});
setInterval(()=>{if(!document.hidden)enforce()},2000);
if(document.readyState==='complete'){enforce();scheduleRestore(true)}
})();