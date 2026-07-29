/* ChegaJá 14.19.5 — correções isoladas sem reconstruir o painel */
(()=>{
'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const isDriver=()=>window.state?.user?.role==='driver';
const hasSession=()=>Boolean(localStorage.getItem('lg_token'));
let wrappedNavigate=false;

function keepAuthenticatedView(){
  if(!hasSession()||!window.state?.user)return;
  $('#auth-screen')?.classList.add('hidden');
  $('#tracking-screen')?.classList.add('hidden');
  $('#customer-screen')?.classList.add('hidden');
  $('#app-shell')?.classList.remove('hidden');
}

function removeSoundControl(){
  $$('button,a,[role="button"],.btn').forEach(node=>{
    const text=String(node.textContent||'').trim().toLocaleLowerCase('pt-BR');
    if(text==='sons ativos'||text==='ativar sons'||text==='som ativo')node.remove();
  });
}

function cleanDriverInternalPage(){
  if(!isDriver())return;
  const page=window.state?.page||'dashboard';
  if(page==='dashboard')return;
  document.body.classList.remove('cj190-driver-mode','cj194-internal','driver-app-mode','v31-driver-mode','v32-driver-single-menu','cj14-driver');
  $('#cj194-back')?.remove();
  $('#cj190-drawer')?.classList.remove('open');
  const shell=$('#app-shell'),body=$('.app-body'),content=$('#page-content');
  shell?.classList.remove('hidden');
  if(body){body.style.removeProperty('position');body.style.removeProperty('inset');body.style.removeProperty('height');body.style.removeProperty('overflow')}
  if(content){content.style.removeProperty('position');content.style.removeProperty('inset');content.style.removeProperty('height');content.style.removeProperty('overflow');content.scrollTop=0}
  window.scrollTo({top:0,left:0,behavior:'instant'});
}

function wrapNavigation(){
  if(wrappedNavigate||typeof window.navigate!=='function')return;
  const original=window.navigate;
  window.navigate=async function(page,...rest){
    keepAuthenticatedView();
    $('#sidebar')?.classList.remove('open');
    $('#cj190-drawer')?.classList.remove('open');
    const result=await original.call(this,page,...rest);
    keepAuthenticatedView();
    cleanDriverInternalPage();
    requestAnimationFrame(()=>{keepAuthenticatedView();cleanDriverInternalPage()});
    return result;
  };
  wrappedNavigate=true;
}

function makeButtonsImmediate(){
  if(!isDriver())return;
  $$('button,a,[role="button"]').forEach(node=>{
    node.style.touchAction='manipulation';
    node.style.webkitTapHighlightColor='transparent';
  });
}

function correctAddressWarnings(){
  $$('input[type="search"],input[data-address-search],input[placeholder*="endereço" i],input[placeholder*="local" i]').forEach(input=>{
    const value=String(input.value||'').trim();
    if(value.length<3)return;
    const scope=input.closest('fieldset,.form-grid,.address-section,.panel,.modal-card')||input.parentElement?.parentElement;
    if(!scope)return;
    $$('[class*="warning"],.muted,.notice',scope).forEach(message=>{
      if(/digite pelo menos 3 caracteres/i.test(message.textContent||''))message.textContent='Buscando endereço…';
    });
  });
}

function apply(){
  keepAuthenticatedView();
  wrapNavigation();
  removeSoundControl();
  makeButtonsImmediate();
  correctAddressWarnings();
  cleanDriverInternalPage();
}

window.addEventListener('load',apply,{once:true});
document.addEventListener('click',event=>{
  const target=event.target.closest?.('#cj190-drawer [data-go],#sidebar [data-page]');
  if(!target)return;
  keepAuthenticatedView();
  $('#cj190-drawer')?.classList.remove('open');
  $('#sidebar')?.classList.remove('open');
},{capture:true});
new MutationObserver(()=>requestAnimationFrame(apply)).observe(document.documentElement,{childList:true,subtree:true});
setInterval(()=>{if(!document.hidden)apply()},3000);
})();
