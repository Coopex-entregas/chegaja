/* ChegaJá 14.23.3 — escala estável, serviços unificados e avulso fora do cadastro */
(()=>{
'use strict';
if(window.__CJ211_STABILITY__)return;window.__CJ211_STABILITY__=true;
const originalFetch=window.fetch.bind(window);
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const urlOf=input=>{try{return new URL(input instanceof Request?input.url:String(input),location.origin)}catch{return null}};
async function jsonClone(response){try{return await response.clone().json()}catch{return null}}
function jsonResponse(data,response){return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers:{'Content-Type':'application/json'}})}
async function requestJson(path,auth=true){const response=await originalFetch(path,{headers:auth&&token()?{Authorization:`Bearer ${token()}`}:{},cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);return data}
window.fetch=async function(input,init={}){
 const url=urlOf(input),method=String(init.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase();
 const response=await originalFetch(input,init);
 if(!url||url.origin!==location.origin)return response;
 if(method==='GET'&&url.pathname==='/api/app/v16/base/delivery-form-data'&&response.ok){
  const data=await jsonClone(response);if(!data)return response;
  try{const fixes=await requestJson(`/api/app/v29/base/form-fixes?base_id=${encodeURIComponent(url.searchParams.get('base_id')||'')}`);data.services=fixes.services||data.services||[];const allowed=new Set(fixes.registered_customer_ids||[]);data.customers=(data.customers||[]).filter(item=>allowed.has(String(item.id)));return jsonResponse(data,response)}catch{return response}
 }
 if(method==='POST'&&/^\/api\/app\/v16\/base\/[^/]+\/services$/.test(url.pathname)&&response.ok){
  const data=await jsonClone(response);if(data?.id)originalFetch(`/api/app/v29/base/services/${encodeURIComponent(data.id)}/activate`,{method:'POST',headers:token()?{Authorization:`Bearer ${token()}`}:{},cache:'no-store'}).catch(()=>{});return response
 }
 if(method==='GET'&&url.pathname==='/api/client/catalog'&&response.ok){
  const data=await jsonClone(response);if(!data)return response;
  const coop=url.searchParams.get('cooperative_id')||url.searchParams.get('coop')||'';
  try{const extra=await requestJson(`/api/client/v29/services?cooperative_id=${encodeURIComponent(coop)}`,false);data.services=extra.items||data.services||[];return jsonResponse(data,response)}catch{return response}
 }
 return response;
};
function bindScale(){
 const sheet=document.querySelector('#cj199-sheet'),list=document.querySelector('#cj199-schedules');
 if(sheet&&!sheet.dataset.cj211){sheet.dataset.cj211='1';new MutationObserver(()=>document.body.classList.toggle('cj210-scale-open',sheet.classList.contains('open'))).observe(sheet,{attributes:true,attributeFilter:['class']});document.body.classList.toggle('cj210-scale-open',sheet.classList.contains('open'))}
 if(list&&!list.dataset.cj211){list.dataset.cj211='1';['touchstart','touchmove','touchend','pointerdown','pointermove','pointerup'].forEach(event=>list.addEventListener(event,e=>e.stopPropagation(),{passive:true}))}
}
function boot(){bindScale();new MutationObserver(()=>requestAnimationFrame(bindScale)).observe(document.documentElement,{childList:true,subtree:true})}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();