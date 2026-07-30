/* ChegaJá 14.29.8 — acabamento do painel, seleção de cooperado e GPS */
(()=>{
'use strict';
if(window.__CJ225_DRIVER_POLISH_14298__)return;
window.__CJ225_DRIVER_POLISH_14298__=true;

const $=(s,r=document)=>r.querySelector(s);
const isDriver=()=>window.state?.user?.role==='driver';

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
  if(seen.has(driver.toLocaleLowerCase('pt-BR'))){option.remove();return}
  seen.add(driver.toLocaleLowerCase('pt-BR'));
  option.textContent=driver;
 });
 let detected=$('#cj225-detected-schedule');
 if(!detected){
  detected=document.createElement('div');
  detected.id='cj225-detected-schedule';
  detected.className='cj225-detected-schedule';
  select.closest('label')?.insertAdjacentElement('afterend',detected);
 }
 const update=()=>{
  const option=select.selectedOptions?.[0];
  detected.innerHTML=option?.value
   ? `<small>ESCALA IDENTIFICADA AUTOMATICAMENTE</small><strong>${String(option.dataset.scheduleDescription||option.textContent||'')}</strong><span>O sistema usará esse turno e fará as conferências de bloqueio, afastamento e conflito.</span>`
   : '<small>ESCOLHA UM COOPERADO</small><span>A escala compatível e o mesmo turno serão identificados automaticamente.</span>';
 };
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
