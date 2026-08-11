/* ChegaJá 14.33.5 — GPS resiliente, SOS imediato e botão online persistente */
(()=>{
'use strict';
if(window.__CJ232_DRIVER_CRITICAL_14335__)return;
window.__CJ232_DRIVER_CRITICAL_14335__=true;

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
const home=()=>isDriver()&&window.state?.page==='dashboard';
const valid=(lat,lng)=>Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lng))<=180&&(Math.abs(Number(lat))+Math.abs(Number(lng))>.001);
const R={watch:null,last:null,lastAt:0,sosBusy:false,onlineBusy:false,online:null,menuBound:false};

async function request(path,opt={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||7000);
 try{
  const response=await fetch(path,{method:opt.method||'GET',headers:{...(token()?{Authorization:`Bearer ${token()}`}:{}) ,...(opt.body?{'Content-Type':'application/json'}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
  return data;
 }finally{clearTimeout(timer)}
}
function remember(coords){
 const lat=Number(coords?.latitude??coords?.lat),lng=Number(coords?.longitude??coords?.lng);
 if(!valid(lat,lng))return null;
 const value={lat,lng,accuracy:Number(coords?.accuracy)||null,heading:Number.isFinite(Number(coords?.heading))?Number(coords.heading):null,speed:Number.isFinite(Number(coords?.speed))?Number(coords.speed):null};
 R.last=value;R.lastAt=Date.now();window.ChegaJaLastDriverLocation=value;
 try{window.ChegaJaDriverMap?.move?.(value)}catch{}
 return value;
}
async function serverLocation(){
 try{
  const data=await request('/api/app/driver/live',{timeout:5000}),d=data.driver||{};
  const value=remember({lat:d.current_lat,lng:d.current_lng,accuracy:null});
  if(value)return value;
 }catch{}
 return null;
}
function startGps(){
 if(!isDriver()||!navigator.geolocation||R.watch!=null)return;
 const cached=window.ChegaJaLastDriverLocation;
 if(cached)remember(cached);
 R.watch=navigator.geolocation.watchPosition(
  p=>remember(p.coords),
  ()=>{},
  {enableHighAccuracy:true,maximumAge:15000,timeout:20000}
 );
 if(!R.last)serverLocation();
}
async function currentLocation(){
 const cached=R.last||window.ChegaJaLastDriverLocation;
 if(cached&&valid(cached.lat??cached.latitude,cached.lng??cached.longitude)&&Date.now()-R.lastAt<180000)return remember(cached);
 if(navigator.geolocation){
  try{
   const p=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:120000,timeout:7000}));
   const value=remember(p.coords);if(value)return value;
  }catch{}
 }
 const saved=await serverLocation();
 if(saved)return saved;
 throw new Error('Ainda não consegui obter sua localização. Mantenha a localização do celular ativada e tente novamente.');
}
function toastMessage(text,type='success'){
 try{if(typeof window.toast==='function'){window.toast(text,type==='error'?'error':undefined);return}}catch{}
 let node=$('#cj232-feedback');if(!node){node=document.createElement('div');node.id='cj232-feedback';document.body.appendChild(node)}
 node.textContent=text;node.className=`show ${type}`;clearTimeout(node._t);node._t=setTimeout(()=>node.className='',5000);
}
function closeAnyModal(){
 try{if(typeof window.closeModal==='function'){window.closeModal();return}}catch{}
 const modal=$('#modal');if(modal)modal.classList.add('hidden');document.body.classList.remove('modal-open');
}
function openSos(){
 if(R.sosBusy)return;
 const html=`<form id="cj232-sos-form" class="form-grid"><div class="full notice cj232-sos-note"><strong>SOCORRO COOPEX</strong><br>O alerta será enviado ao local da sua escala atual e aos cooperados online. A localização será anexada automaticamente.</div><label class="full">O que aconteceu?<textarea name="occurrence" maxlength="800" required placeholder="Ex.: pneu furou, problema na moto, preciso de apoio..."></textarea></label><div class="form-actions full"><button class="btn danger" type="submit">ENVIAR SOCORRO</button></div></form>`;
 try{if(typeof window.openModal==='function')window.openModal('PEDIDO DE SOCORRO',html);else{
   const modal=$('#modal'),body=$('#modal-body'),title=$('#modal-title');if(!modal||!body)return;
   if(title)title.textContent='PEDIDO DE SOCORRO';body.innerHTML=html;modal.classList.remove('hidden');document.body.classList.add('modal-open');
 }}catch{return}
 const form=$('#cj232-sos-form');if(form)form.onsubmit=sendSos;
}
async function sendSos(event){
 event?.preventDefault?.();
 if(R.sosBusy)return;
 const form=event?.currentTarget?.matches?.('#cj232-sos-form')?event.currentTarget:$('#cj232-sos-form');
 const occurrence=String(form?.elements?.occurrence?.value||'Solicitação de ajuda enviada pelo aplicativo.').trim()||'Solicitação de ajuda enviada pelo aplicativo.';
 const button=form?.querySelector('button[type="submit"]');
 R.sosBusy=true;if(button){button.disabled=true;button.textContent='ENVIANDO…'}
 try{
  const loc=await currentLocation();
  const data=await request('/api/app/v32/driver/sos',{method:'POST',body:{occurrence,latitude:loc.lat,longitude:loc.lng,accuracy:loc.accuracy},timeout:10000});
  closeAnyModal();
  const place=data.location_name||'o local da sua escala';
  toastMessage(`Socorro enviado para ${place} e para os cooperados online.`);
 }catch(error){toastMessage(error.message||'Não foi possível enviar o socorro.','error')}
 finally{R.sosBusy=false;if(button?.isConnected){button.disabled=false;button.textContent='ENVIAR SOCORRO'}}
}
function ensureSosMenu(){
 const nav=$('#cj199-drawer nav');if(!nav||$('#cj232-sos-menu'))return;
 const logout=nav.querySelector('[data-logout]');
 const button=document.createElement('button');button.id='cj232-sos-menu';button.type='button';button.className='cj232-sos-menu';button.textContent='Socorro';button.onclick=()=>{$('#cj199-drawer')?.classList.remove('open');openSos()};
 if(logout)nav.insertBefore(button,logout);else nav.appendChild(button);
}
async function syncOnline(force=false){
 if(!isDriver()||!token()||R.onlineBusy)return;
 R.onlineBusy=true;
 try{
  const data=await request('/api/app/driver/live',{timeout:5500}),online=Boolean(Number(data.driver?.online||0));
  R.online=online;localStorage.setItem('cj_driver_online',online?'1':'0');
  if(window.state){window.state.online=online;if(window.state.user)window.state.user.online=online?1:0}
  paintOnline();
 }catch{if(force)paintOnline()}finally{R.onlineBusy=false}
}
function paintOnline(){
 const button=$('#cj199-start');if(!button)return;
 button.hidden=false;button.classList.remove('compact');
 let online=R.online;
 if(online==null){const persisted=localStorage.getItem('cj_driver_online');if(persisted==='1'||persisted==='0')online=persisted==='1';else if(window.state?.user?.online!=null)online=Boolean(Number(window.state.user.online))}
 if(online==null)return;
 button.classList.toggle('online',online);
 const label=button.querySelector('span');if(label)label.textContent=online?'PARAR':'INICIAR';
 const status=$('#cj199-online');if(status)status.textContent=online?'Você está online':'Você está offline';
}
function suppressFalseGpsNotice(){
 const n=$('#cj217-notice');if(!n)return;
 if(/Aguardando a localização do GPS/i.test(n.textContent||'')){n.className='';n.textContent=''}
}
function tick(){
 if(!isDriver())return;
 startGps();
 if(home()){
  ensureSosMenu();paintOnline();suppressFalseGpsNotice();
  document.body.classList.remove('cj222-landscape-blocked');$('#cj222-portrait-lock')?.remove();
 }
}

// Captura todas as versões antigas do botão interno de SOS para usar o mesmo
// fluxo resiliente e não deixar o cooperado preso em uma tela de envio.
document.addEventListener('click',event=>{
 const target=event.target?.closest?.('#cj143-send-sos,#v32-send-internal-sos,#v31-internal-sos,#cj232-sos-menu');
 if(!target)return;
 if(target.id==='cj232-sos-menu')return;
 event.preventDefault();event.stopImmediatePropagation();openSos();
},{capture:true});
document.addEventListener('submit',event=>{
 if(!event.target?.matches?.('#v21-sos-form'))return;
 event.preventDefault();event.stopImmediatePropagation();
 const old=event.target,occurrence=String(old.elements?.occurrence?.value||'').trim();
 closeAnyModal();openSos();setTimeout(()=>{const form=$('#cj232-sos-form');if(form&&occurrence)form.elements.occurrence.value=occurrence},0);
},{capture:true});
document.addEventListener('click',event=>{
 const b=event.target?.closest?.('#cj199-start');if(!b)return;
 setTimeout(()=>syncOnline(true),700);
},{capture:true});
window.addEventListener('pageshow',()=>{startGps();syncOnline(true);setTimeout(tick,100)});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){startGps();syncOnline(true);tick()}});
setInterval(tick,700);
setInterval(()=>syncOnline(false),5000);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{startGps();tick();syncOnline(true)},{once:true});else{startGps();tick();syncOnline(true)}
})();
