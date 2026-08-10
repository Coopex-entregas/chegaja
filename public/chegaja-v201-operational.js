/* ChegaJá 14.32.0 — mapas operacionais Leaflet/OpenStreetMap sem controladores concorrentes */
(()=>{
'use strict';
if(window.__cj201Operational14320)return;
window.__cj201Operational14320=true;

const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const point=(a,b)=>Array.isArray(a)?{lat:Number(a[0]),lng:Number(a[1])}:{lat:Number(a?.lat??a?.latitude??a),lng:Number(a?.lng??a?.longitude??b)};
const runtime={est:null,estHost:null,estTimer:null,estBusy:false,estManual:false,estFitted:false,estSignature:'',observer:null,scheduled:false};

async function api(path){
 const auth=String(window.state?.token||localStorage.getItem('lg_token')||'');
 const response=await fetch(path,{headers:auth?{Authorization:`Bearer ${auth}`}:{},cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
 return data;
}
function ensureLeafletEngine(){if(window.ChegaJaLeafletEngine&&window.ChegaJaMaps!==window.ChegaJaLeafletEngine)window.ChegaJaMaps=window.ChegaJaLeafletEngine}
function removeSoundButtons(){
  $$('button').forEach(button=>{if(/ativar sons|sons ativos/i.test(button.textContent||''))button.remove()});
  $('#cj143-map-tab')?.remove();$('#cj143-est-map-tab')?.remove();
}
function infoCard(item){
 const status=Number(item.online)===1?'Online':'Offline';
 const time=[String(item.schedule_start||'').slice(11,16),String(item.schedule_end||'').slice(11,16)].filter(Boolean).join(' às ');
 const updated=item.location_updated_at?new Date(item.location_updated_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
 const accuracy=Number.isFinite(Number(item.location_accuracy))?`${Math.round(Number(item.location_accuracy))} m`:'—';
 return `<section class="cj201-map-info">${item.photo_url?`<img src="${esc(item.photo_url)}" alt="">`:''}<div><strong>${esc(item.name||'Cooperado')}</strong><span>${esc(status)}${item.schedule_location?` • ${esc(item.schedule_location)}`:''}</span>${time?`<small>Escala: ${esc(time)}</small>`:''}<small>Atualizado: ${esc(updated)} • Precisão: ${esc(accuracy)}</small></div></section>`;
}
function activeDeliveryFor(driverId,deliveries){
 return (deliveries||[]).find(item=>String(item.assigned_driver_id||'')===String(driverId)&&!['delivered','cancelled'].includes(String(item.status)));
}
async function ensureEstablishmentLeaflet(){
 const source=$('#cj14-est-map');
 if(!source||window.state?.user?.role!=='establishment'||window.state?.page!=='dashboard'){destroyEst();return}
 const parent=source.parentElement;if(!parent)return;
 parent.classList.add('cj201-map-parent');
 let host=$('.cj201-est-map',parent);
 if(!host){host=document.createElement('div');host.className='cj201-est-map';parent.appendChild(host)}
 source.style.visibility='hidden';
 if(runtime.estHost!==host||!runtime.est){
  destroyEst(false);runtime.estHost=host;
  try{runtime.est=await window.ChegaJaMaps?.createMap?.(host,{center:[-5.7945,-35.211],zoom:13,zoomControl:true})}catch{return}
  runtime.estManual=false;runtime.estFitted=false;runtime.estSignature='';
  runtime.est?.on?.('dragstart',()=>runtime.estManual=true);runtime.est?.on?.('zoomstart',()=>runtime.estManual=true);
 }
 await refreshEstablishment();
}
async function refreshEstablishment(){
 if(!runtime.est||runtime.estBusy||document.hidden)return;runtime.estBusy=true;
 try{
  const [drivers,deliveries]=await Promise.all([api('/api/app/map/drivers'),api('/api/app/tenant/deliveries')]);
  const items=drivers.items||[],orders=deliveries.items||[];
  const allowed=drivers.location_allowed!==false;
  const parent=runtime.estHost?.parentElement;
  let notice=parent?.querySelector?.('.cj201-map-permission');
  if(!allowed){
   runtime.est.removeGroup?.('drivers');
   if(!notice&&parent){notice=document.createElement('div');notice.className='cj201-map-permission';notice.innerHTML='<strong>Mapa em tempo real</strong><span>Este acesso não está habilitado para o estabelecimento.</span>';parent.appendChild(notice)}
  }else notice?.remove();

  runtime.est.clearGroup?.('drivers');
  runtime.est.clearGroup?.('delivery-stops');
  const points=[],driverIds=[];
  if(allowed)for(const item of items){
   const p=point(item.current_lat,item.current_lng);if(!valid(p))continue;
   const delivery=activeDeliveryFor(item.id,orders),online=Number(item.online)===1;
   runtime.est.addMarker(p,{group:'drivers',key:`driver:${item.id}`,id:item.id,title:item.name||'Cooperado',photo:item.photo_url,online,delivering:Boolean(delivery),status:delivery?'in_route':online?'online':'offline',popup:infoCard(item),size:34});
   points.push(p);driverIds.push(String(item.id));
  }
  for(const item of orders){
   if(['delivered','cancelled'].includes(String(item.status)))continue;
   for(const [kind,lat,lng,label,color] of [['pickup',item.pickup_lat,item.pickup_lng,'Coleta','#1459ff'],['delivery',item.delivery_lat,item.delivery_lng,'Entrega','#ff6a1a']]){
    const p=point(lat,lng);if(!valid(p))continue;
    runtime.est.addCircleMarker(p,{group:'delivery-stops',key:`${item.id}:${kind}`,radius:7,weight:3,color,popup:`<strong>${esc(item.display_code||'Entrega')}</strong><br>${esc(label)}`});
    points.push(p);
   }
  }
  const signature=driverIds.sort().join('|');
  if(points.length&&(!runtime.estFitted||signature!==runtime.estSignature)&&!runtime.estManual){runtime.est.fitBounds(points,{padding:38,maxZoom:16,force:true});runtime.estFitted=true}
  runtime.estSignature=signature;runtime.est.invalidateSize?.();
 }catch{}finally{runtime.estBusy=false}
}
function destroyEst(removeHost=true){
 runtime.estBusy=false;
 if(runtime.est)try{runtime.est.remove()}catch{}
 runtime.est=null;runtime.estManual=false;runtime.estFitted=false;runtime.estSignature='';
 const source=$('#cj14-est-map');if(source)source.style.visibility='';
 if(removeHost){$$('.cj201-est-map,.cj201-map-permission').forEach(node=>node.remove());runtime.estHost=null}
}
function schedule(){
 if(runtime.scheduled)return;runtime.scheduled=true;
 requestAnimationFrame(async()=>{runtime.scheduled=false;ensureLeafletEngine();removeSoundButtons();await ensureEstablishmentLeaflet()});
}
function refreshLoop(){
 clearTimeout(runtime.estTimer);
 const tick=async()=>{
  if(window.state?.user?.role==='establishment'&&window.state?.page==='dashboard'){await ensureEstablishmentLeaflet();runtime.estTimer=setTimeout(tick,8000)}
  else runtime.estTimer=setTimeout(tick,3000);
 };
 runtime.estTimer=setTimeout(tick,1200);
}
function boot(){
 schedule();refreshLoop();
 if(typeof MutationObserver!=='undefined'){runtime.observer=new MutationObserver(schedule);runtime.observer.observe(document.documentElement,{childList:true,subtree:true})}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});
}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();