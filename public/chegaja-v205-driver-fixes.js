/* ChegaJá 14.22.1 — SOS, sons automáticos e navegação interna única */
(()=>{
'use strict';
if(window.__CJ205_DRIVER_FIXES__)return;
window.__CJ205_DRIVER_FIXES__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
const S={audio:null,unlocked:false,lastOnline:null,lastCall:null,poll:null,busy:false};

function unlockAudio(){
 if(S.unlocked)return;
 try{
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx)return;
  S.audio=S.audio||new AudioCtx();
  S.audio.resume?.();
  const oscillator=S.audio.createOscillator(),gain=S.audio.createGain();
  gain.gain.value=.00001;oscillator.connect(gain);gain.connect(S.audio.destination);oscillator.start();oscillator.stop(S.audio.currentTime+.02);
  S.unlocked=true;
 }catch{}
}
function tone(frequency,duration,delay=0,volume=.09){
 if(!S.unlocked||!S.audio)return;
 try{
  const start=S.audio.currentTime+delay,oscillator=S.audio.createOscillator(),gain=S.audio.createGain();
  oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);
  gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(volume,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  oscillator.connect(gain);gain.connect(S.audio.destination);oscillator.start(start);oscillator.stop(start+duration+.03);
 }catch{}
}
function onlineSound(online){
 if(online){tone(620,.13,0);tone(830,.16,.15)}else{tone(620,.13,0);tone(390,.2,.15)}
}
function callSound(){tone(880,.16,0,.11);tone(880,.16,.25,.11);tone(1040,.25,.5,.12)}

async function api(path,opt={}){
 const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
 return data;
}
function removeRoutineBalloons(){
 if(!isDriver())return;
 $$('.toast,.notification-toast,.notice-toast,#toast-container>*').forEach(node=>{
  const text=String(node.textContent||'').trim();
  if(/^(você está |voce esta )?(online|offline)|sons? (ativados?|ativos?)|localização atualizada|localizacao atualizada/i.test(text))node.remove();
 });
}
function cleanInternalPage(){
 if(!isDriver())return;
 const internal=document.body.classList.contains('cj199-driver-page');
 if(!internal)return;
 $$('.v31-driver-bottom,#cj143-driver-nav,#cj42-driver-nav,#cj42-driver-menu,#cj143-driver-menu,.driver-bottom-nav,.mobile-bottom-nav,.bottom-navigation').forEach(node=>node.remove());
 const header=$('#cj199-internal-header');
 if(header){
  const back=header.querySelector('button:not(.menu)');
  if(back){back.onclick=event=>{event.preventDefault();event.stopPropagation();window.navigate?.('dashboard')}}
  header.querySelector('.menu')?.remove();
 }
}
function sosMarkup(){return `<section id="cj205-sos-modal"><button class="backdrop" type="button"></button><article><header><div><small>AJUDA E EMERGÊNCIA</small><h2>Como podemos ajudar?</h2></div><button class="close" type="button">×</button></header><button id="cj205-send-sos" class="internal" type="button"><b>!</b><span><strong>Enviar SOS para a cooperativa</strong><small>A Base receberá sua localização e o pedido de ajuda.</small></span></button><div class="public"><strong>Ajuda pública</strong><div><a href="tel:190"><b>190</b><span>Polícia</span></a><a href="tel:192"><b>192</b><span>SAMU</span></a><a href="tel:193"><b>193</b><span>Bombeiros</span></a></div></div></article></section>`}
function closeSos(){$('#cj205-sos-modal')?.remove()}
function fastPosition(){return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:15000,timeout:10000}):reject(new Error('GPS indisponível.')))}
async function sendSos(){
 const button=$('#cj205-send-sos');if(!button||button.disabled)return;button.disabled=true;
 try{
  const p=await fastPosition(),live=await api('/api/app/driver/live'),active=live.active||live.call;
  const path=active?.id?`/api/app/v15/driver/deliveries/${encodeURIComponent(active.id)}/sos`:'/api/app/v15/driver/sos';
  await api(path,{method:'POST',body:{occurrence:'Pedido de ajuda enviado pelo painel do cooperado.',latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}});
  closeSos();
  try{window.toast?.('SOS enviado para a Base.','success')}catch{alert('SOS enviado para a Base.')}
 }catch(error){button.disabled=false;try{window.toast?.(error.message,'error')}catch{alert(error.message)}}
}
function openSos(){
 unlockAudio();closeSos();document.body.insertAdjacentHTML('beforeend',sosMarkup());
 $('#cj205-sos-modal .backdrop').onclick=$('#cj205-sos-modal .close').onclick=closeSos;
 $('#cj205-send-sos').onclick=sendSos;
}
function installSosButton(){
 if(!isDriver())return;
 const button=$('#cj199-center');if(!button)return;
 button.classList.add('cj205-sos');button.innerHTML='<b>!</b><small>SOS</small>';button.setAttribute('aria-label','Pedir ajuda');button.title='Pedir ajuda';button.onclick=openSos;
}
async function pollSound(){
 if(!isDriver()||!token()||document.hidden||S.busy)return;S.busy=true;
 try{
  const data=await api('/api/app/driver/live'),online=Boolean(Number(data.driver?.online)),callId=data.call?.id||null;
  if(S.lastOnline===null)S.lastOnline=online;else if(S.lastOnline!==online){S.lastOnline=online;onlineSound(online)}
  if(callId&&callId!==S.lastCall){S.lastCall=callId;callSound()}else if(!callId)S.lastCall=null;
 }catch{}finally{S.busy=false}
}
function apply(){installSosButton();cleanInternalPage();removeRoutineBalloons()}
function boot(){
 ['pointerdown','touchstart','keydown'].forEach(event=>document.addEventListener(event,unlockAudio,{once:true,passive:true}));
 apply();new MutationObserver(()=>requestAnimationFrame(apply)).observe(document.documentElement,{childList:true,subtree:true});
 clearInterval(S.poll);S.poll=setInterval(pollSound,6000);pollSound();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){apply();pollSound()}});
}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();