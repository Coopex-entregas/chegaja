/* ChegaJá 14.22.2 — navegação única, SOS imediato, sons e botões responsivos */
(()=>{
'use strict';
if(window.__CJ205_DRIVER_FIXES_14222__)return;
window.__CJ205_DRIVER_FIXES_14222__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
const S={audio:null,unlocked:false,lastOnline:null,lastCall:null,poll:null,busy:false,toastPatched:false,lastPosition:null};
const routine=/\b(online|offline|sons? (ativados?|ativos?)|localiza[cç][aã]o atualizada|entrou na fila|saiu da fila|check-?in confirmado|chegada confirmada)\b/i;

function unlockAudio(){
 if(S.unlocked)return;
 try{
  const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
  S.audio=S.audio||new AudioCtx();S.audio.resume?.();
  const oscillator=S.audio.createOscillator(),gain=S.audio.createGain();gain.gain.value=.00001;oscillator.connect(gain);gain.connect(S.audio.destination);oscillator.start();oscillator.stop(S.audio.currentTime+.02);S.unlocked=true;
 }catch{}
}
function tone(frequency,duration,delay=0,volume=.1){if(!S.unlocked||!S.audio)return;try{const start=S.audio.currentTime+delay,oscillator=S.audio.createOscillator(),gain=S.audio.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(volume,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);oscillator.connect(gain);gain.connect(S.audio.destination);oscillator.start(start);oscillator.stop(start+duration+.03)}catch{}}
function onlineSound(online){if(online){tone(620,.13);tone(830,.17,.15)}else{tone(620,.13);tone(390,.22,.15)}}
function callSound(){tone(880,.17,0,.12);tone(880,.17,.25,.12);tone(1040,.28,.5,.13);navigator.vibrate?.([260,100,320])}
async function api(path,opt={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||6500);try{const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);return data}finally{clearTimeout(timer)}}
function patchToast(){
 if(S.toastPatched||typeof window.toast!=='function')return;S.toastPatched=true;
 const original=window.toast;window.toast=function(message,type='success',...rest){if(isDriver()&&type!=='error'&&routine.test(String(message||'')))return;return original.call(this,message,type,...rest)};
}
function removeRoutineBalloons(){if(!isDriver())return;$$('.toast,.notification-toast,.notice-toast,#toast-container>*,[role="status"]',document).forEach(node=>{const text=String(node.textContent||'').trim();if(text&&routine.test(text)&&!/erro|falha|não foi possível|nao foi possivel/i.test(text))node.remove()})}
function removeDuplicateDriverUi(){
 if(!isDriver())return;
 $$('.v31-driver-bottom,#cj143-driver-nav,#cj42-driver-nav,#cj42-driver-menu,#cj143-driver-menu,.driver-bottom-nav,.mobile-bottom-nav,.bottom-navigation,#cj190-page-menu,#cj190-drawer,#cj196-driver-app,#cj24-driver-app').forEach(node=>node.remove());
 if(document.body.classList.contains('cj199-driver'))$$('#v31-driver-app,.v31-driver-shell,.cj144-driver-dashboard').forEach(node=>node.remove());
}
async function homeNow(event){
 event?.preventDefault?.();event?.stopPropagation?.();
 try{window.state.page='dashboard';history.replaceState(null,'','#dashboard')}catch{}
 document.body.classList.remove('cj199-driver-page');
 try{if(window.pages?.dashboard)await window.pages.dashboard();else await window.navigate?.('dashboard')}catch{location.hash='dashboard';location.reload()}
}
function cleanInternalPage(){
 if(!isDriver())return;removeDuplicateDriverUi();
 if(!document.body.classList.contains('cj199-driver-page'))return;
 const header=$('#cj199-internal-header');if(!header)return;
 header.querySelector('.menu')?.remove();const back=header.querySelector('button');if(back){back.type='button';back.onclick=homeNow;back.addEventListener('pointerup',homeNow,{once:true})}
}
function sosMarkup(){return `<section id="cj205-sos-modal"><button class="backdrop" type="button"></button><article><header><div><small>AJUDA E EMERGÊNCIA</small><h2>Como podemos ajudar?</h2></div><button class="close" type="button">×</button></header><button id="cj205-send-sos" class="internal" type="button"><b>!</b><span><strong>Enviar SOS para a cooperativa</strong><small>Envia sua localização imediatamente para a Base.</small></span></button><div class="public"><strong>Ajuda pública</strong><div><button type="button" data-call="190"><b>190</b><span>Polícia</span></button><button type="button" data-call="192"><b>192</b><span>SAMU</span></button><button type="button" data-call="193"><b>193</b><span>Bombeiros</span></button></div></div></article></section>`}
function closeSos(){$('#cj205-sos-modal')?.remove()}
function getPositionFast(){
 if(S.lastPosition&&Date.now()-S.lastPosition.at<60000)return Promise.resolve(S.lastPosition.value);
 const cached=window.ChegaJaLastDriverLocation;if(cached?.lat!=null&&cached?.lng!=null)return Promise.resolve({coords:{latitude:Number(cached.lat),longitude:Number(cached.lng),accuracy:cached.accuracy||null}});
 return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>{S.lastPosition={at:Date.now(),value:p};resolve(p)},reject,{enableHighAccuracy:false,maximumAge:60000,timeout:6000}):reject(new Error('GPS indisponível.')));
}
async function sendSos(){
 const button=$('#cj205-send-sos');if(!button||button.disabled)return;button.disabled=true;button.classList.add('sending');button.querySelector('strong').textContent='Enviando SOS…';
 try{const p=await getPositionFast();await api('/api/app/v15/driver/sos',{method:'POST',timeout:7000,body:{occurrence:'Pedido de ajuda enviado pelo painel do cooperado.',latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}});closeSos();callSound();window.toast?.('SOS enviado para a Base.','success')}
 catch(error){button.disabled=false;button.classList.remove('sending');button.querySelector('strong').textContent='Enviar SOS para a cooperativa';window.toast?.(error.message,'error')}
}
function callNumber(number){
 try{navigator.clipboard?.writeText(number).catch(()=>{})}catch{}
 window.location.href=`tel:${number}`;
}
function openSos(){unlockAudio();closeSos();document.body.insertAdjacentHTML('beforeend',sosMarkup());$('#cj205-sos-modal .backdrop').onclick=$('#cj205-sos-modal .close').onclick=closeSos;$('#cj205-send-sos').onclick=sendSos;$$('#cj205-sos-modal [data-call]').forEach(button=>button.onclick=()=>callNumber(button.dataset.call))}
function installSosButton(){if(!isDriver())return;const button=$('#cj199-center');if(!button)return;button.classList.add('cj205-sos');button.innerHTML='<b>!</b><small>SOS</small>';button.setAttribute('aria-label','Pedir ajuda');button.title='Pedir ajuda';button.onclick=openSos}
function optimisticOnline(online){const button=$('#cj199-start');button?.classList.toggle('online',online);const span=button?.querySelector('span');if(span)span.textContent=online?'PARAR':'INICIAR';const label=$('#cj199-online');if(label)label.textContent=online?'Você está online':'Você está offline'}
async function fastToggleOnline(){
 const button=$('#cj199-start');if(!button||button.disabled)return;unlockAudio();button.disabled=true;
 const current=button.classList.contains('online');optimisticOnline(!current);
 try{let body={online:!current};if(!current){const p=await getPositionFast();body={online:true,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}}await api('/api/app/driver/online',{method:'POST',body,timeout:7000});S.lastOnline=!current;onlineSound(!current);try{window.state.online=!current}catch{}}
 catch(error){optimisticOnline(current);window.toast?.(error.message,'error')}
 finally{button.disabled=false}
}
function installFastButtons(){if(!isDriver())return;const button=$('#cj199-start');if(button&&!button.dataset.cj205){button.dataset.cj205='1';button.onclick=fastToggleOnline}}
async function pollSound(){if(!isDriver()||!token()||document.hidden||S.busy)return;S.busy=true;try{const data=await api('/api/app/driver/live',{timeout:5000}),online=Boolean(Number(data.driver?.online)),callId=data.call?.id||null;if(S.lastOnline===null)S.lastOnline=online;else if(S.lastOnline!==online){S.lastOnline=online;onlineSound(online)}if(callId&&callId!==S.lastCall){S.lastCall=callId;callSound()}else if(!callId)S.lastCall=null}catch{}finally{S.busy=false}}
function apply(){patchToast();installSosButton();installFastButtons();cleanInternalPage();removeRoutineBalloons()}
function boot(){['pointerdown','touchstart','keydown'].forEach(event=>document.addEventListener(event,unlockAudio,{once:true,passive:true}));apply();new MutationObserver(()=>requestAnimationFrame(apply)).observe(document.documentElement,{childList:true,subtree:true});clearInterval(S.poll);S.poll=setInterval(pollSound,6000);pollSound();document.addEventListener('visibilitychange',()=>{if(!document.hidden){apply();pollSound()}})}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();