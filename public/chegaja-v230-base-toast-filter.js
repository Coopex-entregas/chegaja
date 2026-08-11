/* ChegaJá 14.33.11 — filtro de toasts, mapas e estabilização do online/GPS do cooperado */
(()=>{
'use strict';
if(window.__CJ230_TOAST_FILTER_143311__)return;
window.__CJ230_TOAST_FILTER_143311__=true;

const isDriver=()=>window.state?.user?.role==='driver';
const isDriverHome=()=>isDriver()&&window.state?.page==='dashboard';
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const presenceText=text=>/^\s*Cooperado\s+(online|offline)\b/i.test(String(text||''));
const offerText=text=>/(nova\s+entrega|entrega\s+dispon[ií]vel|nova\s+chamada|entrega\s+recebida)/i.test(String(text||''));

let driverWatch=null;
let driverBusy=false;
let driverOnline=null;
let lastPosition=null;
let lastSentAt=0;
let syncTimer=null;
const positionWaiters=new Set();

async function driverApi(path,opt={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||9000);
  try{
    const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false){const error=new Error(data.error||`Erro ${response.status}`);error.status=response.status;throw error}
    return data;
  }catch(error){
    if(error?.name==='AbortError')throw new Error('A conexão demorou. Tente novamente.');
    throw error;
  }finally{clearTimeout(timer)}
}

function validCoords(lat,lng){
  const a=Number(lat),b=Number(lng);
  return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180;
}

function payloadFromPosition(position){
  return {latitude:Number(position.coords.latitude),longitude:Number(position.coords.longitude),accuracy:Number(position.coords.accuracy)||null,heading:Number.isFinite(Number(position.coords.heading))?Number(position.coords.heading):null,speed:Number.isFinite(Number(position.coords.speed))?Number(position.coords.speed):null};
}

function driverNotice(text,error=false){
  let node=document.querySelector('#cj217-notice');
  if(!node){node=document.createElement('div');node.id='cj217-notice';document.body.appendChild(node)}
  node.textContent=String(text||'');
  node.className=`show${error?' error':''}`;
  clearTimeout(node._cj230Timer);
  node._cj230Timer=setTimeout(()=>node.className='',4200);
}

function currentActiveDelivery(live){return Boolean(live?.active||live?.call||window.ChegaJaDriverActiveDelivery)}

function unlockDriverButton(){
  const button=document.querySelector('#cj199-start');
  if(!button)return null;
  button.disabled=false;
  button.removeAttribute('disabled');
  button.hidden=false;
  button.style.setProperty('pointer-events','auto','important');
  button.style.setProperty('opacity','1','important');
  return button;
}

function paintDriverButton(online,active=false){
  driverOnline=Boolean(online);
  const button=unlockDriverButton();
  if(button){
    button.classList.toggle('online',driverOnline);
    button.classList.toggle('busy',driverBusy);
    const label=button.querySelector('span');
    if(label)label.textContent=active&&driverOnline?'ONLINE':driverOnline?'PARAR':'INICIAR';
  }
  const status=document.querySelector('#cj199-online');
  if(status)status.textContent=driverOnline?'Você está online':'Você está offline';
  if(window.state){window.state.online=driverOnline;if(window.state.user)window.state.user.online=driverOnline?1:0}
}

async function sendDriverLocation(loc,force=false){
  if(!driverOnline||!loc||!validCoords(loc.latitude,loc.longitude))return;
  const now=Date.now();
  if(!force&&now-lastSentAt<4500)return;
  lastSentAt=now;
  await driverApi('/api/app/map/location',{method:'POST',body:loc,timeout:6000});
}

function resolvePositionWaiters(position){
  for(const waiter of [...positionWaiters]){positionWaiters.delete(waiter);try{waiter.resolve(position)}catch{}}
}

function rememberPosition(position){
  const loc=payloadFromPosition(position);
  if(!validCoords(loc.latitude,loc.longitude))return;
  lastPosition={position,loc,at:Date.now()};
  window.ChegaJaLastDriverLocation={lat:loc.latitude,lng:loc.longitude,accuracy:loc.accuracy,heading:loc.heading,speed:loc.speed};
  try{window.ChegaJaDriverMap?.move?.({lat:loc.latitude,lng:loc.longitude,accuracy:loc.accuracy,heading:loc.heading,speed:loc.speed})}catch{}
  resolvePositionWaiters(position);
  if(driverOnline)sendDriverLocation(loc,false).catch(()=>{});
}

function startDriverTracking(force=false){
  if(!navigator.geolocation)return false;
  if(force&&driverWatch!=null){try{navigator.geolocation.clearWatch(driverWatch)}catch{}driverWatch=null}
  if(driverWatch!=null)return true;
  driverWatch=navigator.geolocation.watchPosition(
    rememberPosition,
    error=>{
      if(error?.code===1){
        if(driverWatch!=null)try{navigator.geolocation.clearWatch(driverWatch)}catch{}
        driverWatch=null;
        driverNotice('Permita o acesso à localização do celular para usar o rastreamento.',true);
      }
      // TIMEOUT/posição temporariamente indisponível não encerram o rastreamento.
    },
    {enableHighAccuracy:true,maximumAge:30000,timeout:30000}
  );
  return true;
}

function stopDriverTracking(){
  if(driverWatch!=null&&navigator.geolocation){try{navigator.geolocation.clearWatch(driverWatch)}catch{}}
  driverWatch=null;
}

function waitForWatchPosition(timeout=12000){
  if(lastPosition&&Date.now()-lastPosition.at<120000)return Promise.resolve(lastPosition.position);
  return new Promise((resolve,reject)=>{
    const waiter={resolve,reject};
    positionWaiters.add(waiter);
    setTimeout(()=>{if(positionWaiters.delete(waiter))reject(new Error('A localização ainda não respondeu. O GPS continuará tentando.'))},timeout);
  });
}

function quickPosition(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('GPS indisponível neste aparelho.'));
    navigator.geolocation.getCurrentPosition(resolve,error=>{
      if(error?.code===1)return reject(new Error('Permita a localização precisa para continuar.'));
      if(error?.code===3)return reject(new Error('O GPS demorou para responder. O rastreamento continuará tentando.'));
      reject(new Error('Não foi possível obter a localização agora. O rastreamento continuará tentando.'));
    },{enableHighAccuracy:false,maximumAge:120000,timeout:7000});
  });
}

async function acquireDeviceLocation(){
  startDriverTracking();
  const attempts=[quickPosition(),waitForWatchPosition(12000)];
  try{
    const position=await Promise.any(attempts);
    rememberPosition(position);
    return payloadFromPosition(position);
  }catch{
    if(lastPosition&&Date.now()-lastPosition.at<180000)return lastPosition.loc;
    throw new Error('GPS ativado, mas ainda aguardando uma posição do celular.');
  }
}

async function syncDriverPresence(showError=false){
  if(!isDriverHome()||!token())return null;
  try{
    const live=await driverApi('/api/app/driver/live',{timeout:7000});
    const online=Boolean(Number(live.driver?.online));
    const active=currentActiveDelivery(live);
    paintDriverButton(online,active);
    if(online){startDriverTracking();if(lastPosition)sendDriverLocation(lastPosition.loc,false).catch(()=>{})}
    else if(!active)stopDriverTracking();
    return live;
  }catch(error){if(showError)driverNotice(error.message||'Não foi possível verificar seu status.',true);return null}
}

async function toggleDriverPresence(){
  if(driverBusy||!isDriverHome())return;
  driverBusy=true;
  const button=unlockDriverButton();
  button?.classList.add('busy');
  try{
    const live=await syncDriverPresence(true);
    if(!live)return;
    const active=currentActiveDelivery(live);
    const online=Boolean(Number(live.driver?.online));

    if(active){
      // Durante entrega ativa nunca permite ficar offline. O toque serve para recuperar/forçar o GPS.
      if(!online){
        const loc=await acquireDeviceLocation();
        await driverApi('/api/app/driver/online',{method:'POST',body:{online:true,...loc},timeout:9000});
        driverOnline=true;
        paintDriverButton(true,true);
        await sendDriverLocation(loc,true);
        startDriverTracking(true);
        driverNotice('Você está online. Rastreamento ativo durante a entrega.');
        return;
      }
      driverOnline=true;
      paintDriverButton(true,true);
      startDriverTracking(true);
      try{
        const loc=await acquireDeviceLocation();
        await sendDriverLocation(loc,true);
        driverNotice('Localização atualizada. Rastreamento ativo.');
      }catch{
        driverNotice('GPS ligado. Aguardando o celular atualizar sua posição.');
      }
      return;
    }

    if(online){
      await driverApi('/api/app/driver/online',{method:'POST',body:{online:false},timeout:8000});
      driverOnline=false;
      stopDriverTracking();
      paintDriverButton(false,false);
      driverNotice('Você está offline.');
      return;
    }

    const loc=await acquireDeviceLocation();
    await driverApi('/api/app/driver/online',{method:'POST',body:{online:true,...loc},timeout:9000});
    driverOnline=true;
    paintDriverButton(true,false);
    await sendDriverLocation(loc,true);
    startDriverTracking(true);
    driverNotice('Você está online. Rastreamento ativo.');
  }catch(error){
    driverNotice(error.message||'Não foi possível atualizar seu status.',true);
  }finally{
    driverBusy=false;
    const current=unlockDriverButton();
    current?.classList.remove('busy');
    syncDriverPresence(false).catch(()=>{});
  }
}

function schedulePresenceSync(){
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>syncDriverPresence(false),180);
}

function restoreOtherMaps(){
  let style=document.getElementById('cj230-map-restore');
  if(!style){
    style=document.createElement('style');
    style.id='cj230-map-restore';
    style.textContent='body:not(.cj199-driver) .leaflet-container{display:block!important;visibility:visible!important;opacity:1!important} body:not(.cj199-driver) .leaflet-map-pane,body:not(.cj199-driver) .leaflet-tile-pane{visibility:visible!important;opacity:1!important}';
    document.head.appendChild(style);
  }
  if(!isDriver()){
    document.querySelectorAll('.leaflet-container').forEach(node=>{
      node.style.removeProperty('display');
      node.style.removeProperty('visibility');
      node.style.removeProperty('opacity');
      try{node._leaflet_map?.invalidateSize?.(false)}catch{}
    });
  }
}

function shouldRemove(node){
  if(!node?.classList?.contains('toast'))return false;
  const text=String(node.textContent||'');
  if(presenceText(text))return true;
  if(!isDriver())return false;
  if(offerText(text))return true;
  return node.classList.contains('success')&&!node.classList.contains('error');
}

function clearFilteredToasts(root=document){
  const nodes=[];
  if(root?.matches?.('.toast'))nodes.push(root);
  if(root?.querySelectorAll)nodes.push(...root.querySelectorAll('.toast'));
  for(const node of nodes)if(shouldRemove(node))node.remove();
}

function patchToast(){
  const original=window.toast;
  if(typeof original!=='function'||original.__cj230Filtered143311)return;
  const filtered=function(message,type='success',...args){
    if(presenceText(message))return;
    if(isDriver()&&(offerText(message)||String(type||'success').toLowerCase()==='success'))return;
    return original.call(this,message,type,...args);
  };
  filtered.__cj230Filtered143311=true;
  filtered.__cj230Original=original;
  window.toast=filtered;
}

function boot(){
  restoreOtherMaps();
  patchToast();
  clearFilteredToasts();

  document.addEventListener('click',event=>{
    const target=event.target?.closest?.('#cj199-start');
    if(!target||!isDriverHome())return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    toggleDriverPresence();
  },true);

  const toastHost=document.querySelector('#toast-container')||document.body;
  new MutationObserver(records=>{
    restoreOtherMaps();
    patchToast();
    for(const record of records)for(const node of record.addedNodes)clearFilteredToasts(node);
  }).observe(toastHost,{childList:true,subtree:true});

  new MutationObserver(records=>{
    let relevant=false;
    for(const record of records){
      if(record.target?.id==='cj199-start'||record.addedNodes?.length){relevant=true;break}
    }
    if(relevant){unlockDriverButton();schedulePresenceSync()}
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden']});

  setTimeout(schedulePresenceSync,500);
  setTimeout(schedulePresenceSync,1800);
}

window.addEventListener('resize',restoreOtherMaps);
window.addEventListener('orientationchange',restoreOtherMaps);
window.addEventListener('pageshow',()=>{restoreOtherMaps();schedulePresenceSync()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedulePresenceSync()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();
