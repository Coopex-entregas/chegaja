/* ChegaJá 14.29.8 — acabamento do painel, seleção de cooperado e GPS */
(()=>{
'use strict';
if(window.__CJ225_DRIVER_POLISH_14298__)return;
window.__CJ225_DRIVER_POLISH_14298__=true;

const $=(s,r=document)=>r.querySelector(s);
const isDriver=()=>window.state?.user?.role==='driver';

function fillDetected(detected,option){
 const small=document.createElement('small');
 const span=document.createElement('span');
 if(option?.value){
  const strong=document.createElement('strong');
  small.textContent='ESCALA IDENTIFICADA AUTOMATICAMENTE';
  strong.textContent=String(option.dataset.scheduleDescription||option.textContent||'');
  span.textContent='O sistema usará esse turno e fará as conferências de bloqueio, afastamento e conflito.';
  detected.replaceChildren(small,strong,span);
 }else{
  small.textContent='ESCOLHA UM COOPERADO';
  span.textContent='A escala compatível e o mesmo turno serão identificados automaticamente.';
  detected.replaceChildren(small,span);
 }
}

function polishSwapPicker(){
 if(!isDriver())return;
 const select=$('#cj223-target');
 if(!select||select.dataset.cj225Polished==='1')return;
 select.dataset.cj225Polished='1';
 const label=select.closest('label');
 if(label?.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent='Escolha o cooperado';
 const seen=new Set();
 [...select.options].slice(1).forEach(option=>{
  const original=String(option.textContent||'').trim();
  const driver=original.split(' — ')[0].trim()||original;
  option.dataset.scheduleDescription=original;
  option.dataset.driverName=driver;
  const key=driver.toLocaleLowerCase('pt-BR');
  if(seen.has(key)){option.remove();return}
  seen.add(key);
  option.textContent=driver;
 });
 let detected=$('#cj225-detected-schedule');
 if(!detected){
  detected=document.createElement('div');
  detected.id='cj225-detected-schedule';
  detected.className='cj225-detected-schedule';
  label?.insertAdjacentElement('afterend',detected);
 }
 const update=()=>fillDetected(detected,select.selectedOptions?.[0]);
 select.addEventListener('change',update);
 update();
}

function health(){
 if(!isDriver())return;
 polishSwapPicker();
}
function boot(){
 const observer=new MutationObserver(health);
 observer.observe(document.documentElement,{childList:true,subtree:true});
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)health()});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();
