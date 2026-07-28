/* ChegaJá 14.18.1 — fotos no mapa, diagnóstico Google e formulário rápido */
(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let baseFormBusy=false,lastPhotoSignature='';
function syncDriverPhotos(){
  const items=window.ChegaJaV31?.baseData?.mapData?.items||window.ChegaJaV36?.estDrivers||[];
  const map={};
  for(const item of items){if(item?.name&&item?.photo_url)map[String(item.name)]=String(item.photo_url)}
  window.ChegaJaDriverPhotosByName=map;
  const signature=JSON.stringify(Object.entries(map));
  if(signature!==lastPhotoSignature){lastPhotoSignature=signature;window.ChegaJaV31?.baseMap?.invalidateSize?.()}
}
async function openFastBaseOrder(event){
  const button=event.target.closest('#v31-new-delivery');
  if(!button||baseFormBusy)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  baseFormBusy=true;button.disabled=true;const original=button.textContent;button.textContent='Abrindo…';
  try{
    let data=state?.cache?.lgBaseData||state?.cache?.baseData||null;
    if(!data&&typeof lgBase==='function')data=await lgBase(false);
    if(!data&&typeof lgBase==='function')data=await lgBase();
    if(!window.ChegaJaV16?.baseOrderForm)throw new Error('Formulário de entrega indisponível.');
    await window.ChegaJaV16.baseOrderForm(data||{});
  }catch(error){
    if(typeof toast==='function')toast(error.message||'Não foi possível abrir a nova entrega.','error');
  }finally{baseFormBusy=false;if(button.isConnected){button.disabled=false;button.textContent=original}}
}
async function diagnoseBlankMaps(){
  for(const host of document.querySelectorAll('#v31-driver-map,#v31-base-map,#v32-client-map,#cj180-client-google-map,#cj14-est-map')){
    if(host.dataset.cj181Checked==='1')continue;
    const rect=host.getBoundingClientRect();if(rect.width<20||rect.height<20)continue;
    host.dataset.cj181Checked='1';
    setTimeout(async()=>{
      if(!host.isConnected||host.querySelector('.gm-style,canvas,.cj149-map-error'))return;
      try{await window.ChegaJaMaps?.ensureGoogle?.();if(!host.querySelector('.gm-style'))throw new Error('O mapa não foi inicializado nesta tela.');}
      catch(error){host.innerHTML=`<div class="cj149-map-error"><div><strong>Google Maps não carregou</strong><br><span>${esc(error.message||'Verifique a chave do Google Maps no Administrador Master.')}</span></div></div>`}
    },3500);
  }
}
function apply(){syncDriverPhotos();diagnoseBlankMaps()}
document.addEventListener('click',openFastBaseOrder,true);
const observer=new MutationObserver(()=>requestAnimationFrame(apply));observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('load',apply);setInterval(()=>{if(!document.hidden)apply()},5000);
})();
