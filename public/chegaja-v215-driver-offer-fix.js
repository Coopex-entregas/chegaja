/* ChegaJá 14.24.2 — oferta compacta e detalhes na gaveta */
(()=>{
'use strict';
if(window.__CJ215_OFFER_FIX__)return;window.__CJ215_OFFER_FIX__=true;
const $=(s,r=document)=>r.querySelector(s);
function cloneDetails(){
 const offer=$('#cj212-call.offer'),sheet=$('#cj199-schedules');if(!offer||!sheet)return;
 const route=$('.cj212-route',offer),grid=$('.cj212-grid',offer),notes=[...offer.querySelectorAll('.cj212-note')];
 if(!route&&!grid)return;
 let host=$('.cj215-offer-detail',sheet);if(!host){sheet.innerHTML='';host=document.createElement('section');host.className='cj215-offer-detail';sheet.appendChild(host)}
 host.innerHTML='<h3>Detalhes da nova entrega</h3>';
 if(route){const box=document.createElement('div');box.className='route';box.innerHTML=route.innerHTML;host.appendChild(box)}
 if(grid){const box=document.createElement('div');box.className='values';box.innerHTML=grid.innerHTML;host.appendChild(box)}
 notes.forEach(note=>host.appendChild(note.cloneNode(true)));
 const title=$('#cj199-sheet header strong');if(title)title.textContent='Detalhes da entrega';
}
function restoreTitle(){if(!$('#cj212-call.offer')){const title=$('#cj199-sheet header strong');if(title&&title.textContent==='Detalhes da entrega')title.textContent='Datas, horários e locais'}}
function requireReason(event){
 const target=event.target;if(target?.id!=='cj212-confirm')return;
 const reason=String($('#cj212-reason')?.value||'').trim();
 if(reason.length>=3)return;
 event.preventDefault();event.stopImmediatePropagation();
 const box=$('#cj212-decline-box');box?.classList.add('open');const input=$('#cj212-reason');if(input){input.focus();input.placeholder='Escreva o motivo da recusa'}
}
function focusAfterAccepted(event){
 if(event.target?.id!=='cj212-accept')return;
 const started=Date.now();const timer=setInterval(()=>{const panel=$('#cj212-call');if(panel&&!panel.classList.contains('offer')){clearInterval(timer);window.ChegaJaDriverFocusRoute?.()}else if(Date.now()-started>8000)clearInterval(timer)},180)
}
function tick(){cloneDetails();restoreTitle()}
document.addEventListener('click',requireReason,true);document.addEventListener('click',focusAfterAccepted,true);
setInterval(tick,650);window.addEventListener('load',tick,{once:true});if(document.readyState==='complete')tick();
})();