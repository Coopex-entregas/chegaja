/* ChegaJá 14.33.37 — mapa operacional sem rota administrativa; linha azul somente no cooperado */
(()=>{
'use strict';
if(window.__cj201Operational143337)return;window.__cj201Operational143337=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const point=(a,b)=>Array.isArray(a)?{lat:Number(a[0]),lng:Number(a[1])}:{lat:Number(a?.lat??a?.latitude??a),lng:Number(a?.lng??a?.longitude??b)};
const ADMIN_ROUTE_GROUPS=['route','routes','navigation','cj190-route','driver-route','delivery-route','active-route'];
const ADMIN_MAP_SELECTORS='#v31-base-map,#cj14-est-map,.cj201-est-map,#cj17-fleet-map,.cj17-main-map';
const R={map:null,host:null,timer:null,busy:false,manual:false,fitted:false,signature:'',observer:null,scheduled:false,routeGuarded:false,mapEngineGuarded:false};
async function api(path){const auth=String(window.state?.token||localStorage.getItem('lg_token')||'');const r=await fetch(path,{headers:auth?{Authorization:`Bearer ${auth}`}:{},cache:'no-store'}),d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw new Error(d.error||`Erro ${r.status}`);return d}
function engine(){if(window.ChegaJaLeafletEngine&&window.ChegaJaMaps!==window.ChegaJaLeafletEngine)window.ChegaJaMaps=window.ChegaJaLeafletEngine}
function administrativeRole(){return['platform_admin','cooperative_admin','dispatcher','establishment'].includes(String(window.state?.user?.role||''))}
function administrativeMapHost(host){return Boolean(host?.matches?.(ADMIN_MAP_SELECTORS)||host?.closest?.(ADMIN_MAP_SELECTORS))}
function stripAdapterRoutes(adapter,host){
 if(!adapter||!administrativeRole()||!administrativeMapHost(host||adapter.host))return;
 for(const group of ADMIN_ROUTE_GROUPS){try{adapter.removeGroup?.(group)}catch{}try{adapter.clearGroup?.(group)}catch{}}
 if(!adapter.__cjAdminRouteBlocked){
  adapter.__cjAdminRouteBlocked=true;
  const addPolyline=adapter.addPolyline?.bind(adapter),addGeoJSON=adapter.addGeoJSON?.bind(adapter);
  if(addPolyline)adapter.addPolyline=(values,opt={})=>administrativeRole()&&administrativeMapHost(host||adapter.host)?null:addPolyline(values,opt);
  if(addGeoJSON)adapter.addGeoJSON=(raw,opt={})=>administrativeRole()&&administrativeMapHost(host||adapter.host)?null:addGeoJSON(raw,opt);
 }
}
function protectMapEngineRoutes(){
 engine();
 const maps=window.ChegaJaMaps;
 if(maps?.createMap&&!maps.createMap.__cjAdminRouteBlocked){
  const original=maps.createMap.bind(maps);
  const guarded=async(hostOrId,options={})=>{const adapter=await original(hostOrId,options),host=typeof hostOrId==='string'?document.getElementById(hostOrId):hostOrId;stripAdapterRoutes(adapter,host);return adapter};
  guarded.__cjAdminRouteBlocked=true;maps.createMap=guarded;R.mapEngineGuarded=true;
 }
 const instances=window.ChegaJaLeafletEngine?.instances;
 if(instances?.forEach)instances.forEach((adapter,host)=>stripAdapterRoutes(adapter,host));
}
function protectRouteRenderer(){
 if(R.routeGuarded)return;
 const original=window.renderLineMap;
 if(typeof original!=='function')return;
 const guarded=function(id,geometry=[],markers=[]){return original.call(this,id,administrativeRole()?[]:geometry,markers)};
 guarded.__cjDriverRouteOnly=true;window.renderLineMap=guarded;R.routeGuarded=true;
}
function clearDirectLeafletRoutes(){
 if(!administrativeRole())return;
 for(const host of $$(ADMIN_MAP_SELECTORS)){
  for(const path of $$('.leaflet-overlay-pane svg path',host))try{path.remove()}catch{}
  const adapter=window.ChegaJaLeafletEngine?.instances?.get?.(host);if(adapter)stripAdapterRoutes(adapter,host);
 }
}
function removeLegacy(){$$('button').forEach(b=>{if(/ativar sons|sons ativos/i.test(b.textContent||''))b.remove()});$('#cj143-map-tab')?.remove();$('#cj143-est-map-tab')?.remove();clearDirectLeafletRoutes()}
function activeDelivery(driverId,items){return(items||[]).find(x=>String(x.assigned_driver_id||'')===String(driverId)&&!['delivered','cancelled'].includes(String(x.status)))}
async function ensure(){const source=$('#cj14-est-map');if(!source||window.state?.user?.role!=='establishment'||window.state?.page!=='dashboard'){destroy();return}const parent=source.parentElement;if(!parent)return;parent.classList.add('cj201-map-parent');let host=$('.cj201-est-map',parent);if(!host){host=document.createElement('div');host.className='cj201-est-map';parent.appendChild(host)}source.style.visibility='hidden';if(R.host!==host||!R.map){destroy(false);R.host=host;try{R.map=await window.ChegaJaMaps?.createMap?.(host,{center:[-5.7945,-35.211],zoom:13,zoomControl:true})}catch{return}stripAdapterRoutes(R.map,host);R.manual=false;R.fitted=false;R.signature='';R.map?.on?.('dragstart',()=>R.manual=true);R.map?.on?.('zoomstart',()=>R.manual=true)}await refresh()}
async function refresh(){if(!R.map||R.busy||document.hidden)return;R.busy=true;try{const [drivers,deliveries]=await Promise.all([api('/api/app/map/drivers'),api('/api/app/tenant/deliveries')]),allowed=drivers.location_allowed!==false,parent=R.host?.parentElement;let warning=parent?.querySelector?.('.cj201-map-permission');stripAdapterRoutes(R.map,R.host);if(!allowed){R.map.removeGroup?.('drivers');if(!warning&&parent){warning=document.createElement('div');warning.className='cj201-map-permission';warning.innerHTML='<strong>Mapa em tempo real</strong><span>Este acesso não está habilitado para o estabelecimento.</span>';parent.appendChild(warning)}return}else warning?.remove();R.map.clearGroup?.('drivers');const points=[],ids=[];for(const item of drivers.items||[]){const p=point(item.current_lat,item.current_lng);if(!valid(p))continue;const current=activeDelivery(item.id,deliveries.items||[]),online=Number(item.online)===1;R.map.addMarker(p,{group:'drivers',key:`driver:${item.id}`,id:item.id,title:item.name||'Cooperado',photo:item.photo_url,online,delivering:Boolean(current),status:current?'in_route':online?'online':'offline',meta:{...item,active_delivery_code:current?.display_code||null}});points.push(p);ids.push(String(item.id))}const signature=ids.sort().join('|');if(points.length&&(!R.fitted||signature!==R.signature)&&!R.manual){R.map.fitBounds(points,{padding:38,maxZoom:16,force:true});R.fitted=true}R.signature=signature;clearDirectLeafletRoutes()}catch{}finally{R.busy=false}}
function destroy(removeHost=true){R.busy=false;if(R.map)try{R.map.remove()}catch{}R.map=null;R.manual=false;R.fitted=false;R.signature='';const source=$('#cj14-est-map');if(source)source.style.visibility='';if(removeHost){$$('.cj201-est-map,.cj201-map-permission').forEach(n=>n.remove());R.host=null}}
function schedule(){if(R.scheduled)return;R.scheduled=true;requestAnimationFrame(async()=>{R.scheduled=false;protectMapEngineRoutes();protectRouteRenderer();removeLegacy();await ensure();clearDirectLeafletRoutes()})}
function loop(){clearTimeout(R.timer);const tick=async()=>{protectMapEngineRoutes();protectRouteRenderer();clearDirectLeafletRoutes();if(window.state?.user?.role==='establishment'&&window.state?.page==='dashboard'){await ensure();R.timer=setTimeout(tick,6000)}else R.timer=setTimeout(tick,2500)};R.timer=setTimeout(tick,900)}
function boot(){protectMapEngineRoutes();protectRouteRenderer();schedule();loop();if(typeof MutationObserver!=='undefined'){R.observer=new MutationObserver(schedule);R.observer.observe(document.documentElement,{childList:true,subtree:true})}document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()})}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();