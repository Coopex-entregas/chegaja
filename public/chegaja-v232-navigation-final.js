/* ChegaJá 14.33.6 — GPS imediato/contínuo, online persistente, sons e SOS resiliente */
(()=>{
'use strict';
if(window.__CJ232_DRIVER_CRITICAL_14336__)return;
window.__CJ232_DRIVER_CRITICAL_14336__=true;

const $=(s,r=document)=>r.querySelector(s);
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
const R={last:null,lastAt:0,lastSent:0,gpsWatch:null,sosBusy:false,onlineBusy:false,toggleBusy:false,online:null,active:null,offerId:'',offerTimer:null,offerCount:0,declineCandidate:'',audio:null};

const valid=(lat,lng)=>Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lng))<=180&&(Math.abs(Number(lat))+Math.abs(Number(lng))>.001);
async function request(path,opt={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||8000);
 try{
  const response=await fetch(path,{method:opt.method||'GET',headers:{...(token()?{Authorization:`Bearer ${token()}`}:{}) ,...(opt.body?{'Content-Type':'application/json'}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false){const error=new Error(data.error||`Erro ${response.status}`);error.status=response.status;throw error}
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
function toastMessage(text,type='success'){
 try{if(typeof window.toast==='function'){window.toast(text,type==='error'?'error':undefined);return}}catch{}
 let node=$('#cj232-feedback');if(!node){node=document.createElement('div');node.id='cj232-feedback';document.body.appendChild(node)}
 node.textContent=text;node.className=`show ${type}`;clearTimeout(node._t);node._t=setTimeout(()=>node.className='',5200);
}
function unlockSound(){
 try{
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;
  R.audio=R.audio||new C();
  if(R.audio.state==='suspended')R.audio.resume?.().catch?.(()=>{});
  return R.audio;
 }catch{return null}
}
function tone(ctx,freq,at,duration=.13,gain=.13){
 try{const osc=ctx.createOscillator(),vol=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(freq,ctx.currentTime+at);vol.gain.setValueAtTime(.0001,ctx.currentTime+at);vol.gain.exponentialRampToValueAtTime(gain,ctx.currentTime+at+.018);vol.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+at+duration);osc.connect(vol);vol.connect(ctx.destination);osc.start(ctx.currentTime+at);osc.stop(ctx.currentTime+at+duration+.03)}catch{}
}
async function playSound(kind='ok'){
 const patterns={offer:[360,100,360,100,520],online:[110],offline:[80,80,80],decline:[180,70,180],accept:[120,60,120]};
 try{navigator.vibrate?.(patterns[kind]||[100])}catch{}
 const ctx=unlockSound();if(!ctx)return;
 try{if(ctx.state!=='running')await ctx.resume()}catch{}
 if(ctx.state!=='running')return;
 if(kind==='offer'){tone(ctx,880,0,.16,.18);tone(ctx,1040,.23,.16,.18);tone(ctx,1240,.46,.22,.2);return}
 if(kind==='online'){tone(ctx,660,0,.12,.13);tone(ctx,880,.15,.16,.15);return}
 if(kind==='offline'){tone(ctx,700,0,.13,.12);tone(ctx,470,.17,.18,.12);return}
 if(kind==='decline'){tone(ctx,520,0,.13,.13);tone(ctx,360,.16,.18,.13);return}
 if(kind==='accept'){tone(ctx,620,0,.1,.12);tone(ctx,820,.12,.1,.12);tone(ctx,1040,.24,.16,.14);return}
 tone(ctx,760,0,.14,.12);
}
window.ChegaJaSound=playSound;
function stopOfferSound(){clearInterval(R.offerTimer);R.offerTimer=null;R.offerCount=0}
function startOfferSound(id){
 if(!id||R.offerTimer)return;
 const fire=()=>{if(R.offerId!==id||R.offerCount>=6){stopOfferSound();return}R.offerCount+=1;playSound('offer')};
 fire();R.offerTimer=setInterval(fire,4500);
}
function locationError(error){
 if(Number(error?.code)===1)return new Error('Autorize a localização do celular para ficar online.');
 if(Number(error?.code)===2)return new Error('O celular ainda não conseguiu determinar sua localização. Tente novamente.');
 if(Number(error?.code)===3)return new Error('A localização demorou para responder. Tente novamente.');
 return new Error('Autorize a localização precisa para continuar.');
}
function askLocation(){
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation)return reject(new Error('Este aparelho não disponibilizou o GPS.'));
  navigator.geolocation.getCurrentPosition(
   position=>{const value=remember(position.coords);value?resolve(value):reject(new Error('A localização recebida é inválida.'))},
   error=>reject(locationError(error)),
   {enableHighAccuracy:true,maximumAge:0,timeout:20000}
  );
 });
}
function stopGpsWatch(){
 if(R.gpsWatch==null)return;
 try{navigator.geolocation?.clearWatch?.(R.gpsWatch)}catch{}
 R.gpsWatch=null;
}
function ensureGpsWatch(){
 if(R.gpsWatch!=null||!navigator.geolocation)return;
 R.gpsWatch=navigator.geolocation.watchPosition(position=>{
  const value=remember(position.coords);if(!value)return;
  if(R.online&&Date.now()-R.lastSent>5000){R.lastSent=Date.now();request('/api/app/map/location',{method:'POST',body:{latitude:value.lat,longitude:value.lng,accuracy:value.accuracy,heading:value.heading,speed:value.speed},timeout:5500}).catch(()=>{})}
 },error=>{
  if(Number(error?.code)===1){stopGpsWatch();toastMessage('A localização foi bloqueada no celular. Autorize o GPS para continuar online.','error')}
 },{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
}
function knownOnline(){
 if(R.online!=null)return R.online;
 const saved=localStorage.getItem('cj_driver_online');if(saved==='1'||saved==='0')return saved==='1';
 if(window.state?.user?.online!=null)return Boolean(Number(window.state.user.online));
 if(window.state?.online!=null)return Boolean(window.state.online);
 return false;
}
async function serverLocation(){
 try{
  const data=await request('/api/app/driver/live',{timeout:5500}),d=data.driver||{},previousOffer=R.offerId,nextOffer=String(data.call?.id||''),active=data.active||null;
  R.online=Boolean(Number(d.online||0));R.active=active;
  if(window.state){window.state.online=R.online;if(window.state.user)window.state.user.online=R.online?1:0}
  localStorage.setItem('cj_driver_online',R.online?'1':'0');
  if(R.online)ensureGpsWatch();else stopGpsWatch();
  if(nextOffer&&nextOffer!==previousOffer){stopOfferSound();R.offerId=nextOffer;startOfferSound(nextOffer)}
  if(!nextOffer&&previousOffer){
   stopOfferSound();R.offerId='';
   if(active&&String(active.id)===previousOffer)playSound('accept');
   else if(R.declineCandidate===previousOffer)playSound('decline');
   R.declineCandidate='';
  }
  const value=remember({lat:d.current_lat,lng:d.current_lng,accuracy:d.location_accuracy});
  return value;
 }catch{return null}
}
function activeDelivery(){return R.active||window.ChegaJaDriverActiveDelivery||null}
function paintOnline(){
 const button=$('#cj199-start');if(!button)return;
 const online=knownOnline(),active=Boolean(activeDelivery());
 button.hidden=false;button.classList.toggle('online',online);
 button.disabled=R.toggleBusy||(active&&online);
 button.dataset.cj232Locked=active&&online?'1':'0';
 const label=button.querySelector('span');
 if(label)label.textContent=R.toggleBusy?'GPS…':active&&online?'ONLINE':online?'PARAR':'INICIAR';
 button.title=active&&online?'Entrega em andamento: você permanecerá online até finalizar.':'';
 const status=$('#cj199-online');
 if(status)status.textContent=active&&online?'Você está online • entrega em andamento':online?'Você está online':'Você está offline';
 const queue=$('#cj199-queue-text');
 if(queue&&active&&online)queue.textContent='Você não pode ficar offline durante a entrega';
}
async function syncOnline(force=false){
 if(!isDriver()||!token()||R.onlineBusy)return;
 R.onlineBusy=true;
 try{await serverLocation();paintOnline()}catch{if(force)paintOnline()}finally{R.onlineBusy=false}
}
async function toggleOnline(event){
 event?.preventDefault?.();event?.stopImmediatePropagation?.();
 if(!isDriver()||R.toggleBusy)return;
 unlockSound();
 const assumedOnline=knownOnline(),activeNow=Boolean(activeDelivery());
 if(assumedOnline&&activeNow){toastMessage('Há uma entrega em andamento. Você permanecerá online até finalizar.');paintOnline();return}
 /* O pedido do GPS é disparado imediatamente dentro do gesto do usuário, antes de qualquer await/fetch. */
 const locationPromise=!assumedOnline?askLocation():null;
 R.toggleBusy=true;paintOnline();
 try{
  if(!assumedOnline){
   const loc=await locationPromise;
   await syncOnline(true);
   if(!R.online){
    const data=await request('/api/app/driver/online',{method:'POST',body:{online:true,latitude:loc.lat,longitude:loc.lng,accuracy:loc.accuracy,heading:loc.heading,speed:loc.speed},timeout:10000});
    R.online=Boolean(data.online);
   }
   localStorage.setItem('cj_driver_online','1');
   if(window.state){window.state.online=true;if(window.state.user)window.state.user.online=1}
   ensureGpsWatch();playSound('online');toastMessage('Você está online. GPS ativo.');
  }else{
   await syncOnline(true);
   if(R.online&&Boolean(activeDelivery())){toastMessage('Há uma entrega em andamento. Você permanecerá online até finalizar.');return}
   if(R.online){
    const data=await request('/api/app/driver/online',{method:'POST',body:{online:false},timeout:8000});
    R.online=Boolean(data.online);localStorage.setItem('cj_driver_online','0');
    if(window.state){window.state.online=false;if(window.state.user)window.state.user.online=0}
    stopGpsWatch();playSound('offline');toastMessage('Você ficou offline.');
   }else{
    /* Estado local estava desatualizado: pede GPS sem exigir um segundo toque. */
    const loc=await askLocation();
    const data=await request('/api/app/driver/online',{method:'POST',body:{online:true,latitude:loc.lat,longitude:loc.lng,accuracy:loc.accuracy,heading:loc.heading,speed:loc.speed},timeout:10000});
    R.online=Boolean(data.online);localStorage.setItem('cj_driver_online','1');
    if(window.state){window.state.online=true;if(window.state.user)window.state.user.online=1}
    ensureGpsWatch();playSound('online');toastMessage('Você está online. GPS ativo.');
   }
  }
 }catch(error){toastMessage(error.message||'Não foi possível alterar seu status.','error')}
 finally{R.toggleBusy=false;paintOnline();setTimeout(()=>syncOnline(true),500)}
}
async function currentLocation(){
 const cached=R.last||window.ChegaJaLastDriverLocation;
 if(cached&&valid(cached.lat??cached.latitude,cached.lng??cached.longitude))return remember(cached);
 const saved=await serverLocation();if(saved)return saved;
 return askLocation();
}
function closeAnyModal(){
 try{if(typeof window.closeModal==='function'){window.closeModal();return}}catch{}
 const modal=$('#modal');if(modal)modal.classList.add('hidden');document.body.classList.remove('modal-open');
}
function openSos(){
 if(R.sosBusy)return;
 const html=`<form id="cj232-sos-form" class="form-grid"><div class="full notice cj232-sos-note"><strong>SOCORRO COOPEX</strong><br>O alerta será enviado ao local da sua escala atual e aos cooperados online. A localização será anexada automaticamente.</div><label class="full">O que aconteceu?<textarea name="occurrence" maxlength="800" required placeholder="Ex.: pneu furou, problema na moto, preciso de apoio..."></textarea></label><div class="form-actions full"><button class="btn danger" type="submit">ENVIAR SOCORRO</button></div></form>`;
 try{if(typeof window.openModal==='function')window.openModal('PEDIDO DE SOCORRO',html);else{const modal=$('#modal'),body=$('#modal-body'),title=$('#modal-title');if(!modal||!body)return;if(title)title.textContent='PEDIDO DE SOCORRO';body.innerHTML=html;modal.classList.remove('hidden');document.body.classList.add('modal-open')}}catch{return}
 const form=$('#cj232-sos-form');if(form)form.onsubmit=sendSos;
}
async function sendSos(event){
 event?.preventDefault?.();if(R.sosBusy)return;
 const form=event?.currentTarget?.matches?.('#cj232-sos-form')?event.currentTarget:$('#cj232-sos-form'),occurrence=String(form?.elements?.occurrence?.value||'Solicitação de ajuda enviada pelo aplicativo.').trim()||'Solicitação de ajuda enviada pelo aplicativo.',button=form?.querySelector('button[type="submit"]');
 R.sosBusy=true;if(button){button.disabled=true;button.textContent='ENVIANDO…'}
 try{const loc=await currentLocation(),data=await request('/api/app/v32/driver/sos',{method:'POST',body:{occurrence,latitude:loc.lat,longitude:loc.lng,accuracy:loc.accuracy},timeout:10000});closeAnyModal();toastMessage(data.message||`Socorro enviado para ${data.location_name||'o local da sua escala'} e para os cooperados online.`)}
 catch(error){toastMessage(error.message||'Não foi possível enviar o socorro.','error')}
 finally{R.sosBusy=false;if(button?.isConnected){button.disabled=false;button.textContent='ENVIAR SOCORRO'}}
}
function ensureSosMenu(){
 const nav=$('#cj199-drawer nav');if(!nav||$('#cj232-sos-menu'))return;
 const logout=nav.querySelector('[data-logout]'),button=document.createElement('button');button.id='cj232-sos-menu';button.type='button';button.className='cj232-sos-menu';button.textContent='Socorro';button.onclick=()=>{$('#cj199-drawer')?.classList.remove('open');openSos()};
 if(logout)nav.insertBefore(button,logout);else nav.appendChild(button);
}
function tick(){if(!isDriver())return;if(window.state?.page==='dashboard'){ensureSosMenu();paintOnline();document.body.classList.remove('cj222-landscape-blocked');$('#cj222-portrait-lock')?.remove()}}

for(const ev of ['pointerdown','touchstart'])document.addEventListener(ev,unlockSound,{capture:true,passive:true});
document.addEventListener('click',event=>{
 const start=event.target?.closest?.('#cj199-start');if(start){toggleOnline(event);return}
 const decline=event.target?.closest?.('#cj217-secondary');if(decline&&/RECUSAR/i.test(String(decline.textContent||'')))R.declineCandidate=R.offerId||String(window.ChegaJaDriverActiveDelivery?.id||'');
 const target=event.target?.closest?.('#cj143-send-sos,#v32-send-internal-sos,#v31-internal-sos');if(!target)return;event.preventDefault();event.stopImmediatePropagation();openSos();
},{capture:true});
document.addEventListener('submit',event=>{
 if(!event.target?.matches?.('#v21-sos-form'))return;event.preventDefault();event.stopImmediatePropagation();const old=event.target,occurrence=String(old.elements?.occurrence?.value||'').trim();closeAnyModal();openSos();setTimeout(()=>{const form=$('#cj232-sos-form');if(form&&occurrence)form.elements.occurrence.value=occurrence},0);
},{capture:true});
window.addEventListener('pageshow',()=>{syncOnline(true);setTimeout(tick,100)});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncOnline(true);tick()}});
setInterval(tick,800);setInterval(()=>syncOnline(false),5000);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{tick();syncOnline(true)},{once:true});else{tick();syncOnline(true)}
})();
