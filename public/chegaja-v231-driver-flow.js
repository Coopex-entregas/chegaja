/* ChegaJá 14.31.3 — aceite sem travar, online automático e chamada sonora no iPhone */
(()=>{
'use strict';
if(window.__CJ231_DRIVER_FLOW_14313__)return;
window.__CJ231_DRIVER_FLOW_14313__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const F={
 offerId:'',accepting:false,userUnlocked:false,audio:null,audioUrl:'',context:null,
 timers:new Set(),sheetObserver:null,sheetNode:null
};
const isDriver=()=>window.state?.user?.role==='driver';
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const currentDelivery=()=>window.ChegaJaDriverCurrentDelivery||null;
const pendingOffer=()=>window.ChegaJaDriverPendingOffer||null;

async function api(path,opt={}){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),opt.timeout||8000);
 try{
  const response=await fetch(path,{
   method:opt.method||'GET',
   headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},
   body:opt.body?JSON.stringify(opt.body):undefined,
   cache:'no-store',signal:controller.signal
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
  return data;
 }catch(error){
  if(error?.name==='AbortError')throw new Error('A conexão demorou. Toque em ACEITAR novamente.');
  throw error;
 }finally{clearTimeout(timeout)}
}
function schedule(callback,delay){
 const timer=setTimeout(()=>{F.timers.delete(timer);callback()},delay);
 F.timers.add(timer);return timer;
}

function createRingWav(){
 const rate=22050,duration=1.42,count=Math.floor(rate*duration),bytes=44+count*2;
 const buffer=new ArrayBuffer(bytes),view=new DataView(buffer);
 const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i))};
 text(0,'RIFF');view.setUint32(4,bytes-8,true);text(8,'WAVE');text(12,'fmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 text(36,'data');view.setUint32(40,count*2,true);
 const tones=[{start:.16,end:.38,f:740},{start:.49,end:.73,f:940},{start:.83,end:1.24,f:1180}];
 for(let i=0;i<count;i++){
  const t=i/rate;let sample=0;
  for(const tone of tones){
   if(t<tone.start||t>tone.end)continue;
   const local=(t-tone.start)/(tone.end-tone.start),envelope=Math.sin(Math.PI*local);
   sample+=Math.sin(2*Math.PI*tone.f*t)*envelope*.48;
  }
  view.setInt16(44+i*2,Math.max(-1,Math.min(1,sample))*32767,true);
 }
 return new Blob([buffer],{type:'audio/wav'});
}
function ensureAudioElement(){
 if(F.audio)return F.audio;
 try{
  F.audioUrl=URL.createObjectURL(createRingWav());
  F.audio=new Audio(F.audioUrl);F.audio.preload='auto';F.audio.playsInline=true;F.audio.volume=1;
 }catch{}
 return F.audio;
}
function ensureContext(){
 try{
  const Context=window.AudioContext||window.webkitAudioContext;
  if(Context&&!F.context)F.context=new Context();
  return F.context;
 }catch{return null}
}
function unlockMedia(){
 F.userUnlocked=true;
 const context=ensureContext();
 try{
  context?.resume?.();
  if(context&&!context.__cj231Unlocked){
   const gain=context.createGain(),oscillator=context.createOscillator();
   gain.gain.value=.000001;oscillator.connect(gain);gain.connect(context.destination);
   oscillator.start();oscillator.stop(context.currentTime+.025);context.__cj231Unlocked=true;
  }
 }catch{}
 const audio=ensureAudioElement();
 if(audio&&!audio.__cj231Unlocked){
  try{
   audio.volume=.001;audio.currentTime=0;
   const promise=audio.play();
   Promise.resolve(promise).then(()=>schedule(()=>{
    try{audio.pause();audio.currentTime=0;audio.volume=1;audio.__cj231Unlocked=true}catch{}
   },70)).catch(()=>{});
  }catch{}
 }
}
function oscillatorRing(){
 const context=ensureContext();if(!context)return;
 const start=context.currentTime+.02;
 try{context.resume?.()}catch{}
 for(const tone of[{f:740,t:0,d:.19},{f:940,t:.25,d:.21},{f:1180,t:.53,d:.34}]){
  try{
   const oscillator=context.createOscillator(),gain=context.createGain();
   oscillator.type='sine';oscillator.frequency.setValueAtTime(tone.f,start+tone.t);
   gain.gain.setValueAtTime(.0001,start+tone.t);
   gain.gain.exponentialRampToValueAtTime(.32,start+tone.t+.025);
   gain.gain.exponentialRampToValueAtTime(.0001,start+tone.t+tone.d);
   oscillator.connect(gain);gain.connect(context.destination);
   oscillator.start(start+tone.t);oscillator.stop(start+tone.t+tone.d+.04);
  }catch{}
 }
}
async function playOfferSound(){
 const audio=ensureAudioElement();let played=false;
 if(audio){
  try{audio.pause();audio.currentTime=0;audio.volume=1;await audio.play();played=true}catch{}
 }
 if(!played)oscillatorRing();
 if(F.userUnlocked&&'speechSynthesis'in window){
  schedule(()=>{
   try{
    const utterance=new SpeechSynthesisUtterance('Nova entrega disponível');
    utterance.lang='pt-BR';utterance.rate=1;utterance.volume=1;speechSynthesis.speak(utterance);
   }catch{}
  },1050);
 }
}

function decorateSheet(){
 if(!isDriver())return;
 $('#cj217-nav')?.setAttribute('hidden','');
 $$('.cj217-sheet .arrived').forEach(node=>node.remove());
 const status=String(currentDelivery()?.status||''),button=$('#cj217-action');
 if(button&&['accepted','to_pickup','at_pickup'].includes(status)){
  button.disabled=false;button.textContent='COLETA REALIZADA';button.dataset.action='picked_up';
 }
}
function bindSheetObserver(){
 const sheet=$('#cj199-sheet');if(!sheet||F.sheetNode===sheet)return;
 F.sheetObserver?.disconnect();F.sheetNode=sheet;
 F.sheetObserver=new MutationObserver(()=>queueMicrotask(decorateSheet));
 F.sheetObserver.observe(sheet,{childList:true,subtree:true});
}
function openDeliverySheet(){
 if(!isDriver())return;
 window.dispatchEvent(new CustomEvent('cj:driver-open-delivery'));
 const open=()=>{
  bindSheetObserver();const sheet=$('#cj199-sheet');if(!sheet)return;
  sheet.hidden=false;sheet.classList.add('open');const up=$('#cj199-up');if(up)up.textContent='⌄';decorateSheet();
  try{window.ChegaJaDriverMap?.map?.invalidateSize?.(false)}catch{}
 };
 for(const delay of[0,70,180,360,700])schedule(open,delay);
}
function offerId(detail){
 if(detail&&typeof detail==='object')return String(detail.id||detail.item?.id||'');
 return String(detail||'');
}
function receiveOffer(detail){
 const id=offerId(detail);if(!id){F.offerId='';return}
 if(id===F.offerId){openDeliverySheet();return}
 F.offerId=id;playOfferSound();openDeliverySheet();
 schedule(()=>{if(String(pendingOffer()?.id||'')===id)playOfferSound()},1750);
}

function currentGps(){
 const raw=window.ChegaJaLastDriverLocation;
 const latitude=Number(raw?.lat??raw?.latitude),longitude=Number(raw?.lng??raw?.longitude),accuracy=Number(raw?.accuracy);
 return Number.isFinite(latitude)&&Number.isFinite(longitude)?{latitude,longitude,accuracy:Number.isFinite(accuracy)?accuracy:null}:null;
}
function requestGps(){
 const existing=currentGps();if(existing)return Promise.resolve(existing);
 return new Promise(resolve=>{
  if(!navigator.geolocation){resolve(null);return}
  navigator.geolocation.getCurrentPosition(position=>resolve({
   latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy
  }),()=>resolve(null),{enableHighAccuracy:true,maximumAge:4000,timeout:4000});
 });
}
function message(text,error=false){
 const host=$('#cj217-msg');if(host){host.textContent=String(text||'');host.classList.toggle('error',error)}
}
function acceptedState(item,status){
 const accepted={...item,status:status||'to_pickup',accepted_at:new Date().toISOString(),requires_acceptance:false};
 window.ChegaJaDriverCurrentDelivery=accepted;
 window.ChegaJaDriverPendingOffer=null;
 window.ChegaJaDriverActiveDelivery=accepted;
 try{window.ChegaJaDriverMap?.setActive?.(accepted)}catch{}
 document.body.classList.add('cj217-active-delivery');document.body.classList.remove('cj217-pending-offer');
 const online=$('#cj199-online');if(online)online.textContent='Você está online';
 window.dispatchEvent(new CustomEvent('cj:driver-offer',{detail:null}));
 F.offerId='';openDeliverySheet();decorateSheet();
 for(const delay of[80,650,1800])schedule(()=>document.dispatchEvent(new Event('visibilitychange')),delay);
}
async function acceptOffer(button){
 if(F.accepting||!isDriver())return;
 const item=pendingOffer()||currentDelivery();const id=String(item?.id||'');if(!id)return;
 F.accepting=true;message('');button.disabled=true;button.textContent='ACEITANDO…';
 try{
  const location=await requestGps();
  if(!location)throw new Error('Autorize a localização precisa para aceitar a entrega.');
  await api('/api/app/driver/online',{method:'POST',body:{online:true,...location},timeout:7000});
  const result=await api(`/api/app/v28/driver/calls/${encodeURIComponent(id)}/accept`,{
   method:'POST',body:location,timeout:9000
  });
  acceptedState(item,String(result.status||'to_pickup'));
  button.textContent='ACEITA';
 }catch(error){
  const text=String(error?.message||'Não foi possível aceitar a entrega.');
  if(/já foi aceita|já foi aceito|já foi retirada/i.test(text)){
   button.textContent='ATUALIZANDO…';
   for(const delay of[0,500,1400])schedule(()=>document.dispatchEvent(new Event('visibilitychange')),delay);
  }else{
   message(text,true);button.disabled=false;button.textContent='ACEITAR';
  }
 }finally{F.accepting=false}
}

window.addEventListener('cj:driver-offer',event=>receiveOffer(event.detail));
window.addEventListener('cj:driver-navigation',event=>{
 if(event.detail?.arrived){try{window.speechSynthesis?.cancel?.()}catch{}decorateSheet()}
});
window.addEventListener('cj:driver-open-delivery',()=>schedule(decorateSheet,0));
for(const eventName of['pointerdown','touchstart'])document.addEventListener(eventName,unlockMedia,{capture:true,passive:true});
document.addEventListener('click',event=>{
 unlockMedia();
 const button=event.target?.closest?.('#cj217-action[data-action="accept"]');if(!button)return;
 event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();acceptOffer(button);
},{capture:true});

function tick(){
 if(!isDriver())return;bindSheetObserver();decorateSheet();
 const offer=pendingOffer();
 if(offer){const id=String(offer.id||'');if(id&&id!==F.offerId)receiveOffer({id,item:offer})}
 else if(!currentDelivery())F.offerId='';
}
setInterval(tick,450);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
})();
