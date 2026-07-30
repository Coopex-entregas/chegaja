/* ChegaJá 14.29.8 — acabamento do painel, seleção de cooperado e navegação interna */
(()=>{
'use strict';
if(window.__CJ225_DRIVER_POLISH_14298__)return;
window.__CJ225_DRIVER_POLISH_14298__=true;

const $=(s,r=document)=>r.querySelector(s);
const isDriver=()=>window.state?.user?.role==='driver';
const titles={schedules:'Escala, filtros e trocas',deliveries:'Minhas entregas',routes:'Rotas',financial:'Ganhos e descontos',advances:'Adiantamentos',ratings:'Avaliações',profile:'Perfil e configurações',account:'Alterar senha',attendance:'Check-in'};

function goHome(){
 try{window.navigate?.('dashboard')}catch{location.hash='dashboard'}
}
function ensureBackHeader(){
 if(!isDriver()||window.state?.page==='dashboard')return;
 const content=$('#page-content');if(!content)return;
 document.body.classList.add('cj199-driver-page');
 document.body.classList.remove('cj199-driver');
 let header=$('#cj199-internal-header');
 if(!header){
  header=document.createElement('header');
  header.id='cj199-internal-header';
  header.innerHTML='<button type="button" aria-label="Voltar">←</button><div><small>MEU APLICATIVO</small><strong></strong></div><span aria-hidden="true"></span>';
  content.prepend(header);
 }
 const back=header.querySelector('button');
 if(back){back.type='button';back.setAttribute('aria-label','Voltar para o início');back.onclick=goHome}
 const title=header.querySelector('strong');
 if(title)title.textContent=titles[window.state?.page]||'Meu aplicativo';
 $('#menu-button')?.classList.add('hidden');
 $('#sidebar')?.classList.remove('open');
}

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
 ensureBackHeader();
 polishSwapPicker();
}
function boot(){
 clearInterval(window.__CJ225_HEALTH__);
 window.__CJ225_HEALTH__=setInterval(health,900);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)health()});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();
