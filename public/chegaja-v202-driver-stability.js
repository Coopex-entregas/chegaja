/* ChegaJá 14.20.2 — estabilidade do painel único do cooperado */
(()=>{
'use strict';
if(window.__cj202DriverStability)return;
window.__cj202DriverStability=true;
const $=(selector,root=document)=>root.querySelector(selector);
const isDriverHome=()=>window.state?.user?.role==='driver'&&window.state?.page==='dashboard';
let restoring=false;
let restoreTimer=null;

function removeLegacyDriverScreen(){
 const legacy=$('#cj190-driver-app');
 if(legacy&&!legacy.dataset.cj202Sentinel)legacy.remove();
 for(const selector of ['#cj190-page-menu','#cj190-drawer','#cj196-driver-app','#cj24-driver-app','.v31-driver-app']){
  const node=$(selector);
  if(node&&!node.closest('#cj199-app'))node.remove();
 }
 document.body.classList.remove('cj190-driver-home','cj190-driver-page','cj194-internal','cj196-driver-mode','cj24-driver-mode','v31-driver-mode','v32-driver-single-menu','driver-app-mode');
}

function ensureLegacySentinel(){
 if(!isDriverHome()){
  $('#cj190-driver-app[data-cj202-sentinel]')?.remove();
  return;
 }
 let sentinel=$('#cj190-driver-app');
 if(sentinel&&!sentinel.dataset.cj202Sentinel){sentinel.remove();sentinel=null;}
 if(!sentinel){
  sentinel=document.createElement('div');
  sentinel.id='cj190-driver-app';
  sentinel.dataset.cj202Sentinel='1';
  sentinel.hidden=true;
  sentinel.setAttribute('aria-hidden','true');
  document.body.appendChild(sentinel);
 }
}

function unlockDriverSurface(){
 if(!isDriverHome())return;
 const app=$('#cj199-app');
 if(!app)return;
 document.body.classList.add('cj199-driver','cj202-driver-ready');
 $('#auth-screen')?.classList.add('hidden');
 $('#customer-screen')?.classList.add('hidden');
 $('#tracking-screen')?.classList.add('hidden');
 $('#app-shell')?.classList.remove('hidden');
 app.style.removeProperty('transform');
 app.style.removeProperty('zoom');
 for(const button of app.querySelectorAll('button')){
  button.style.pointerEvents='auto';
  button.style.touchAction='manipulation';
 }
 const loading=$('#loading');
 if(loading?.classList.contains('hidden'))loading.style.pointerEvents='none';
 window.dispatchEvent(new Event('resize'));
}

async function restoreDriverPanel(){
 if(!isDriverHome()||restoring)return;
 removeLegacyDriverScreen();
 ensureLegacySentinel();
 if($('#cj199-app')){unlockDriverSurface();return;}
 if(!window.pages?.dashboard)return;
 restoring=true;
 try{
  await window.pages.dashboard();
  ensureLegacySentinel();
  unlockDriverSurface();
  setTimeout(()=>{unlockDriverSurface();window.dispatchEvent(new Event('resize'));},180);
 }catch(error){
  console.error('Falha ao restaurar painel do cooperado:',error);
 }finally{restoring=false;}
}

function scheduleRestore(){
 clearTimeout(restoreTimer);
 restoreTimer=setTimeout(()=>{restoreDriverPanel();},40);
}

function boot(){
 ensureLegacySentinel();
 scheduleRestore();
 new MutationObserver(()=>{
  if(!isDriverHome())return;
  ensureLegacySentinel();
  if(!$('#cj199-app'))scheduleRestore();
 }).observe(document.documentElement,{childList:true,subtree:true});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleRestore();});
 window.addEventListener('pageshow',scheduleRestore);
 window.addEventListener('orientationchange',()=>setTimeout(()=>{unlockDriverSurface();window.dispatchEvent(new Event('resize'));},180));
 setInterval(()=>{
  if(!document.hidden&&isDriverHome()){
   ensureLegacySentinel();
   if(!$('#cj199-app'))scheduleRestore();
   else unlockDriverSurface();
  }
 },1500);
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();