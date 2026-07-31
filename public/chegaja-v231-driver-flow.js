/* ChegaJá 14.30.9 — chamada sonora e fluxo simples do cooperado */
(()=>{
'use strict';
if(window.__CJ231_DRIVER_FLOW_14309__)return;
window.__CJ231_DRIVER_FLOW_14309__=true;

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const F={offerId:'',audio:null,timers:new Set(),sheetObserver:null,sheetNode:null};
const isDriver=()=>window.state?.user?.role==='driver';
const currentDelivery=()=>window.ChegaJaDriverCurrentDelivery||null;
const pendingOffer=()=>window.ChegaJaDriverPendingOffer||null;

function unlockAudio(){
 try{
  const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
  if(!F.audio)F.audio=new Context();
  if(F.audio.state==='suspended')F.audio.resume().catch(()=>{});
  if(!F.audio.__cjUnlocked){
   const gain=F.audio.createGain(),oscillator=F.audio.createOscillator();
   gain.gain.value=.00001;oscillator.connect(gain);gain.connect(F.audio.destination);oscillator.start();oscillator.stop(F.audio.currentTime+.02);F.audio.__cjUnlocked=true;
  }
 }catch{}
}
function playOfferSound(){
 unlockAudio();const context=F.audio;if(!context||context.state!=='running')return;
 const start=context.currentTime+.02;
 for(const tone of[{f:740,t:0,d:.16},{f:940,t:.21,d:.18},{f:1180,t:.45,d:.28}]){
  try{
   const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(tone.f,start+tone.t);
   gain.gain.setValueAtTime(.0001,start+tone.t);gain.gain.exponentialRampToValueAtTime(.22,start+tone.t+.025);gain.gain.exponentialRampToValueAtTime(.0001,start+tone.t+tone.d);
   oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start+tone.t);oscillator.stop(start+tone.t+tone.d+.03);
  }catch{}
 }
}
function schedule(callback,delay){const timer=setTimeout(()=>{F.timers.delete(timer);callback()},delay);F.timers.add(timer)}
function decorateSheet(){
 if(!isDriver())return;
 $('#cj217-nav')?.setAttribute('hidden','');$$('.cj217-sheet .arrived').forEach(node=>node.remove());
 const status=String(currentDelivery()?.status||''),button=$('#cj217-action');
 if(button&&['accepted','to_pickup','at_pickup'].includes(status)){button.textContent='COLETA REALIZADA';button.dataset.action='picked_up'}
}
function bindSheetObserver(){
 const sheet=$('#cj199-sheet');if(!sheet||F.sheetNode===sheet)return;
 F.sheetObserver?.disconnect();F.sheetNode=sheet;F.sheetObserver=new MutationObserver(()=>queueMicrotask(decorateSheet));F.sheetObserver.observe(sheet,{childList:true,subtree:true});
}
function openDeliverySheet(){
 if(!isDriver())return;window.dispatchEvent(new CustomEvent('cj:driver-open-delivery'));
 const open=()=>{bindSheetObserver();const sheet=$('#cj199-sheet');if(!sheet)return;sheet.hidden=false;sheet.classList.add('open');const up=$('#cj199-up');if(up)up.textContent='⌄';decorateSheet();try{window.ChegaJaDriverMap?.map?.invalidateSize?.(false)}catch{}};
 for(const delay of[0,70,180,360,700])schedule(open,delay);
}
function offerId(detail){if(detail&&typeof detail==='object')return String(detail.id||detail.item?.id||'');return String(detail||'')}
function receiveOffer(detail){
 const id=offerId(detail);if(!id){F.offerId='';return}
 if(id===F.offerId){openDeliverySheet();return}
 F.offerId=id;playOfferSound();openDeliverySheet();
}
function tick(){
 if(!isDriver())return;bindSheetObserver();decorateSheet();
 const offer=pendingOffer();
 if(offer){const id=String(offer.id||'');if(id&&id!==F.offerId)receiveOffer({id,item:offer})}
 else if(!currentDelivery())F.offerId='';
}
window.addEventListener('cj:driver-offer',event=>receiveOffer(event.detail));
window.addEventListener('cj:driver-navigation',event=>{if(event.detail?.arrived){try{window.speechSynthesis?.cancel?.()}catch{};decorateSheet()}});
window.addEventListener('cj:driver-open-delivery',()=>schedule(decorateSheet,0));
for(const eventName of['pointerdown','touchstart','click'])document.addEventListener(eventName,unlockAudio,{capture:true,passive:true});
setInterval(tick,500);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
})();
