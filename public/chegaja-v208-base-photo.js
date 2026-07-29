/* ChegaJá 14.22.6 — foto real disponível antes de desenhar o mapa da Base */
(()=>{
'use strict';
if(window.__CJ208_BASE_PHOTO__)return;
window.__CJ208_BASE_PHOTO__=true;
const originalFetch=window.fetch.bind(window);
const runtime={items:[],scheduled:false};
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const initials=name=>String(name||'CJ').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
const photosByName=new Map(),photosById=new Map();
window.ChegaJaBasePhotos={
 find(name){return photosByName.get(normalize(name))||null},
 byId(id){return photosById.get(String(id))||null},
 items(){return [...runtime.items]}
};
function requestUrl(input){try{return new URL(input instanceof Request?input.url:String(input),location.origin)}catch{return null}}
function isBaseMapRequest(input){const url=requestUrl(input);return Boolean(url&&url.origin===location.origin&&['/api/app/v16/base/live-map','/api/app/v27/base/live-map'].includes(url.pathname))}
function replacement(input){const url=requestUrl(input);if(!url)return input;url.pathname='/api/app/v27/base/live-map';return url.toString()}
function rememberData(data){
 if(!data?.ok)return;
 runtime.items=data.items||[];photosByName.clear();photosById.clear();
 for(const item of runtime.items){
  if(!item?.photo_url)continue;
  const photo={id:String(item.id),name:item.name||'Cooperado',url:item.photo_url};
  photosById.set(photo.id,photo);photosByName.set(normalize(photo.name),photo);
 }
 schedulePaint();
}
window.fetch=async function(input,init={}){
 if(!isBaseMapRequest(input))return originalFetch(input,init);
 const response=await originalFetch(replacement(input),init);
 try{rememberData(await response.clone().json())}catch{}
 return response;
};
function schedulePaint(){if(runtime.scheduled)return;runtime.scheduled=true;requestAnimationFrame(()=>{runtime.scheduled=false;paintExisting()})}
function paintExisting(){
 if(window.state?.page!=='bases'||!runtime.items.length)return;
 const available=runtime.items.filter(item=>item.photo_url),used=new Set();
 for(const span of document.querySelectorAll('.v30-driver-marker span,.cj201-photo-icon span')){
  if(span.querySelector('img'))continue;
  const key=String(span.textContent||'').trim().toUpperCase();
  const matches=available.filter(item=>!used.has(String(item.id))&&initials(item.name)===key);
  if(matches.length!==1)continue;
  const item=matches[0];used.add(String(item.id));
  span.innerHTML=`<img src="${esc(item.photo_url)}" alt="Foto de ${esc(item.name||'Cooperado')}">`;
  span.closest('.v30-driver-marker,.cj201-photo-icon')?.classList.add('has-photo');
 }
 for(const row of document.querySelectorAll('[data-v30-driver]')){
  const item=runtime.items.find(driver=>String(driver.id)===String(row.dataset.v30Driver));
  if(!item?.photo_url)continue;
  let photo=row.querySelector('.cj208-list-photo');
  if(!photo){photo=document.createElement('span');photo.className='cj208-list-photo';row.insertAdjacentElement('afterbegin',photo)}
  photo.innerHTML=`<img src="${esc(item.photo_url)}" alt="Foto de ${esc(item.name||'Cooperado')}">`;
 }
}
function boot(){new MutationObserver(schedulePaint).observe(document.documentElement,{childList:true,subtree:true});schedulePaint()}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();