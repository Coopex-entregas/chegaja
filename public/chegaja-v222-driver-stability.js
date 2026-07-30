/* ChegaJá 14.29.3 — cooperado: mapa único, estado online estável e painel deslizante persistente */
(()=>{
'use strict';
if(window.__CJ222_DRIVER_STABILITY__)return;
window.__CJ222_DRIVER_STABILITY__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const isDriver=()=>window.state?.user?.role==='driver';
const isDriverHome=()=>isDriver()&&window.state?.page==='dashboard';
const bool=value=>value===true||value===1||value==='1'||String(value).toLowerCase()==='true';
const S={online:null,candidate:null,candidateCount:0,toggleBusy:false,sheetWantedOpen:false,sheetObserver:null,observedSheet:null,timer:null};

function token(){return String(window.state?.token||localStorage.getItem('lg_token')||'').trim()}
function endpoint(input){try{return new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return null}}
function requestMethod(input,init){return String(init?.method||input?.method||'GET').toUpperCase()}
function requestBody(input,init){const body=init?.body??input?.body;if(typeof body!=='string')return null;try{return JSON.parse(body)}catch{return null}}

function applyOnlineUi(){
  if(S.online===null||!isDriverHome())return;
  const button=$('#cj199-start');
  if(button){button.classList.toggle('online',S.online);const text=button.querySelector('span');if(text)text.textContent=S.online?'PARAR':'INICIAR'}
  const label=$('#cj199-online');if(label)label.textContent=S.online?'Você está online':'Você está offline';
  try{if(window.state)window.state.online=S.online}catch{}
}
function setOnline(value){S.online=Boolean(value);S.candidate=null;S.candidateCount=0;applyOnlineUi()}
function observeOnline(value){
  const next=Boolean(value);
  if(S.online===null){setOnline(next);return}
  if(next===S.online){S.candidate=null;S.candidateCount=0;return}
  if(S.candidate===next)S.candidateCount+=1;else{S.candidate=next;S.candidateCount=1}
  if(S.candidateCount>=3)setOnline(next);
}

const nativeFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
  const url=endpoint(input),method=requestMethod(input,init);
  const response=await nativeFetch(input,init);
  if(!url||!url.pathname.startsWith('/api/app/'))return response;
  if(method==='POST'&&/\/driver\/online$/.test(url.pathname)&&response.ok){const body=requestBody(input,init);if(body&&Object.prototype.hasOwnProperty.call(body,'online'))setOnline(bool(body.online));return response}
  if(method==='GET'&&/\/driver\/live$/.test(url.pathname)&&response.ok){
    try{
      const data=await response.clone().json(),raw=bool(data?.driver?.online);
      observeOnline(raw);
      if(data?.driver&&S.online!==null&&raw!==S.online){
        data.driver.online=S.online?1:0;
        const headers=new Headers(response.headers);headers.set('content-type','application/json; charset=utf-8');
        return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
      }
    }catch{}
  }
  return response;
};

function currentPosition(){return new Promise((resolve,reject)=>{if(!navigator.geolocation){reject(new Error('GPS indisponível.'));return}navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:3000,timeout:15000})})}
function showInlineMessage(message,error=false){let node=$('#cj222-inline-message');if(!node){node=document.createElement('div');node.id='cj222-inline-message';document.body.appendChild(node)}node.textContent=String(message||'');node.className=error?'show error':'show';clearTimeout(node._timer);node._timer=setTimeout(()=>node.className='',3200)}

async function toggleOnlineStable(){
  if(S.toggleBusy||window.ChegaJaDriverCurrentDelivery)return;
  const button=$('#cj199-start');if(!button)return;
  S.toggleBusy=true;button.disabled=true;
  const previous=S.online===null?button.classList.contains('online'):S.online,next=!previous;
  setOnline(next);
  try{
    let body={online:next};
    if(next){
      const p=await currentPosition();
      window.ChegaJaLastDriverLocation={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,heading:p.coords.heading};
      window.ChegaJaDriverMap?.move?.({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,heading:p.coords.heading});
      body={online:true,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy};
    }
    const response=await window.fetch('/api/app/driver/online',{method:'POST',headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`}:{})},body:JSON.stringify(body),cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
    setOnline(next);
  }catch(error){setOnline(previous);showInlineMessage(error?.message||'Não foi possível alterar seu status.',true)}finally{S.toggleBusy=false;if(button?.isConnected)button.disabled=false}
}

document.addEventListener('click',event=>{
  const start=event.target?.closest?.('#cj199-start');
  if(start&&isDriverHome()){event.preventDefault();event.stopImmediatePropagation();toggleOnlineStable();return}
  if(event.target?.closest?.('#cj199-up'))S.sheetWantedOpen=true;
  if(event.target?.closest?.('#cj199-down,#cj199-sheet .handle'))S.sheetWantedOpen=false;
},true);

function stopSheetSwipeClose(node){
  if(!node||node.dataset.cj222TouchBound)return;
  node.dataset.cj222TouchBound='1';
  node.addEventListener('touchstart',event=>event.stopPropagation(),{passive:true});
  node.addEventListener('touchmove',event=>event.stopPropagation(),{passive:true});
  node.addEventListener('touchend',event=>event.stopPropagation(),{passive:true});
  node.addEventListener('touchcancel',event=>event.stopPropagation(),{passive:true});
}
function watchSheet(){
  const sheet=$('#cj199-sheet');if(!sheet)return;
  stopSheetSwipeClose($('#cj199-schedules',sheet));stopSheetSwipeClose($('header',sheet));
  if(S.observedSheet===sheet)return;
  S.sheetObserver?.disconnect();S.observedSheet=sheet;
  S.sheetObserver=new MutationObserver(()=>{if(!isDriverHome())return;if(sheet.classList.contains('open'))S.sheetWantedOpen=true;else if(S.sheetWantedOpen)queueMicrotask(()=>sheet.classList.add('open'))});
  S.sheetObserver.observe(sheet,{attributes:true,attributeFilter:['class']});
}
function keepSheetState(){if(!isDriverHome()){S.sheetWantedOpen=false;return}watchSheet();const sheet=$('#cj199-sheet');if(sheet&&S.sheetWantedOpen&&!sheet.classList.contains('open'))sheet.classList.add('open')}
window.addEventListener('cj:driver-open-delivery',()=>{if(!isDriverHome())return;S.sheetWantedOpen=true;requestAnimationFrame(keepSheetState)});
window.addEventListener('cj:driver-navigation',()=>requestAnimationFrame(keepSheetState));

function enforceNavigationArrow(){if(!isDriverHome())return;$$('.cj199-photo-marker').forEach(marker=>marker.classList.add('cj222-navigation-marker'))}
function restyleAlerts(){if(!isDriver())return;const nodes=$$('.toast,.notification-toast,.notice-toast,#toast-container>*,[role="status"]');for(const node of nodes){const text=String(node.textContent||'').trim();if(/PEDIDO DE SOCORRO|SOCORRO|SOS/i.test(text))node.classList.add('cj222-sos-alert');else node.classList.add('cj222-compact-alert')}}
function removeDuplicatePanels(){
  if(!isDriverHome())return;
  const content=$('#page-content');if(!content)return;
  const apps=$$('#cj199-app',content);for(const duplicate of apps.slice(1))duplicate.remove();
  const legacy=['.v31-driver-app','.v31-driver-shell','#v31-driver-app','#cj190-driver-app','#cj196-driver-app','#cj24-driver-app','#cj212-call','#cj214-internal','.driver-dashboard','.driver-home','.v31-driver-map-card'];
  for(const selector of legacy)$$(selector,content).forEach(node=>node.remove());
}
function tick(){if(!isDriver())return;removeDuplicatePanels();keepSheetState();enforceNavigationArrow();restyleAlerts();applyOnlineUi()}
new MutationObserver(()=>queueMicrotask(tick)).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
window.addEventListener('pageshow',tick);window.addEventListener('load',tick,{once:true});
clearInterval(S.timer);S.timer=setInterval(tick,500);
if(document.readyState!=='loading')tick();else document.addEventListener('DOMContentLoaded',tick,{once:true});
})();
