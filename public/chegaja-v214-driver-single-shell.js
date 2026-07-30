/* ChegaJá 14.24.1 — painel único do cooperado */
(()=>{
'use strict';
if(window.__CJ214_SINGLE_SHELL__)return;window.__CJ214_SINGLE_SHELL__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const isDriver=()=>window.state?.user?.role==='driver';
const titles={deliveries:'Minhas entregas',routes:'Rotas',financial:'Ganhos e descontos',advances:'Adiantamentos',ratings:'Avaliações',profile:'Perfil e configurações',account:'Alterar senha',attendance:'Check-in'};
let originalNavigate=null,installed=false,busy=false;
function purge(){
 if(!isDriver())return;
 $$('.v31-driver-bottom,#cj143-driver-nav,#cj143-driver-menu,#cj143-driver-drawer,#cj42-driver-nav,#cj42-driver-menu,#cj42-driver-drawer,.driver-bottom-nav,.mobile-bottom-nav,.bottom-navigation,#cj190-page-menu,#cj190-drawer,#cj196-driver-app,#cj24-driver-app,#cj199-internal-header').forEach(n=>n.remove());
 document.body.classList.remove('v31-driver-mode','v32-driver-single-menu','cj14-driver','cj143-driver','cj190-driver-home','cj24-driver-mode','cj196-driver-mode','driver-app-mode','cj199-driver-page');
 document.body.classList.add('cj199-driver');
}
async function goHome(){
 if(busy)return;busy=true;
 try{
  purge();
  $('#cj214-internal')?.remove();
  window.state.page='dashboard';
  history.replaceState(null,'','#dashboard');
  if(window.pages?.dashboard)await window.pages.dashboard();
 }finally{busy=false}
}
async function openInternal(page){
 if(busy)return;busy=true;
 const content=$('#page-content');if(!content){busy=false;return}
 purge();
 let home=$('#cj199-app');
 if(!home&&window.pages?.dashboard){window.state.page='dashboard';await window.pages.dashboard();home=$('#cj199-app')}
 if(!home){busy=false;return}
 const parking=document.createElement('div');parking.style.display='none';document.body.appendChild(parking);parking.appendChild(home);
 try{
  await originalNavigate.call(window,page);
  const fragment=document.createDocumentFragment();
  [...content.childNodes].forEach(node=>fragment.appendChild(node));
  content.replaceChildren(home);
  const overlay=document.createElement('section');overlay.id='cj214-internal';overlay.innerHTML=`<header><button id="cj214-back" type="button">←</button><div><small>MEU APLICATIVO</small><strong>${titles[page]||'Meu aplicativo'}</strong></div></header><main id="cj214-content"></main>`;
  content.appendChild(overlay);overlay.querySelector('#cj214-content').appendChild(fragment);overlay.querySelector('#cj214-back').onclick=goHome;
  purge();window.state.page=page;history.replaceState(null,'',`#${page}`);window.scrollTo(0,0);
 }catch(error){content.replaceChildren(home);throw error}finally{parking.remove();busy=false}
}
function install(){
 if(installed||typeof window.navigate!=='function'||!window.pages)return;installed=true;originalNavigate=window.navigate;
 window.navigate=async function(page,...args){
  if(!isDriver())return originalNavigate.call(this,page,...args);
  if(page==='dashboard')return goHome();
  return openInternal(page);
 };
}
function focusRoute(){
 if(!isDriver())return;
 $('#cj214-internal')?.remove();
 window.state.page='dashboard';
 purge();
 setTimeout(()=>{$('#cj199-center')?.click();const map=$('#cj199-map');map?.scrollIntoView({block:'center',behavior:'smooth'})},80);
}
window.ChegaJaDriverFocusRoute=focusRoute;
function boot(){install();purge();setInterval(()=>{install();purge()},1800);document.addEventListener('click',event=>{if(event.target?.id==='cj212-accept')setTimeout(focusRoute,450)},true)}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();