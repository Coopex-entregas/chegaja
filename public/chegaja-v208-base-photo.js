/* ChegaJá 14.22.4 — foto real no marcador da Base sem mapa duplicado */
(()=>{
'use strict';
if(window.__CJ208_BASE_PHOTO__)return;
window.__CJ208_BASE_PHOTO__=true;
const originalFetch=window.fetch.bind(window);
const state={items:[],scheduled:false};
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function isBaseMapRequest(input){
 try{const url=new URL(input instanceof Request?input.url:String(input),location.origin);return url.origin===location.origin&&url.pathname==='/api/app/v16/base/live-map'}catch{return false}
}
function replacement(input){
 const url=new URL(input instanceof Request?input.url:String(input),location.origin);
 url.pathname='/api/app/v27/base/live-map';
 return url.toString();
}
function remember(response){
 response.clone().json().then(data=>{if(data?.ok){state.items=data.items||[];schedulePaint()}}).catch(()=>{});
}
window.fetch=async function(input,init={}){
 if(!isBaseMapRequest(input))return originalFetch(input,init);
 const target=replacement(input);
 const response=await originalFetch(target,init);
 remember(response);
 return response;
};
function initials(name){return String(name||'CJ').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}
function schedulePaint(){if(state.scheduled)return;state.scheduled=true;requestAnimationFrame(()=>{state.scheduled=false;paint()})}
function paint(){
 if(window.state?.page!=='bases'||!state.items.length)return;
 const online=state.items.filter(item=>item.photo_url&&item.current_lat!=null&&item.current_lng!=null);
 const markers=[...document.querySelectorAll('.v30-driver-marker span')];
 const used=new Set();
 for(const marker of markers){
  if(marker.querySelector('img'))continue;
  const key=String(marker.textContent||'').trim().toUpperCase();
  const match=online.find(item=>!used.has(String(item.id))&&initials(item.name)===key);
  if(!match)continue;
  used.add(String(match.id));
  marker.innerHTML=`<img src="${esc(match.photo_url)}" alt="Foto de ${esc(match.name||'Cooperado')}">`;
  marker.closest('.v30-driver-marker')?.classList.add('has-photo');
 }
 for(const row of document.querySelectorAll('[data-v30-driver]')){
  const item=state.items.find(driver=>String(driver.id)===String(row.dataset.v30Driver));
  if(!item?.photo_url)continue;
  let photo=row.querySelector('.cj208-list-photo');
  if(!photo){photo=document.createElement('span');photo.className='cj208-list-photo';row.insertAdjacentElement('afterbegin',photo)}
  photo.innerHTML=`<img src="${esc(item.photo_url)}" alt="Foto de ${esc(item.name||'Cooperado')}">`;
 }
}
function boot(){
 new MutationObserver(schedulePaint).observe(document.documentElement,{childList:true,subtree:true});
 schedulePaint();
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();