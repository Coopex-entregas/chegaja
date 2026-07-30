/* ChegaJá 14.23.3 — chamada fixa, botões confiáveis, som iPhone e escala estável */
(()=>{
'use strict';
if(window.__CJ210_DRIVER_CALL_14233__)return;
window.__CJ210_DRIVER_CALL_14233__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)/100);
const km=v=>Number(v||0)>0?`${(Number(v)/1000).toFixed(2).replace('.',',')} km`:'—';
const meters=v=>Number(v||0)>0?`${Math.round(Number(v))} m`:'—';
const mins=v=>Number(v||0)>0?`${Math.max(1,Math.round(Number(v)/60))} min`:'—';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
const R={audio:null,lastOnline:null,call:null,detail:null,poll:null,ring:null,busy:false,decision:null,autoSent:0,toastOriginal:null};
async function api(path,opt={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||5500);
 try{
  const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
  return data;
 }finally{clearTimeout(timer)}
}
async function ensureAudio(){
 try{
  const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return false;
  R.audio=R.audio||new AudioCtx();if(R.audio.state!=='running')await R.audio.resume();
  return R.audio.state==='running';
 }catch{return false}
}
function tone(freq,duration,delay=0,volume=.14,type='square'){
 if(!R.audio||R.audio.state!=='running')return;
 try{const start=R.audio.currentTime+delay,o=R.audio.createOscillator(),g=R.audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,start);g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(volume,start+.02);g.gain.exponentialRampToValueAtTime(.0001,start+duration);o.connect(g);g.connect(R.audio.destination);o.start(start);o.stop(start+duration+.05)}catch{}
}
async function soundCall(){if(!(await ensureAudio()))return;tone(930,.18,0,.16);tone(1180,.22,.24,.17);tone(930,.18,.55,.16);navigator.vibrate?.([350,100,350,100,500])}
async function soundOnline(){if(!(await ensureAudio()))return;tone(520,.13,0,.12,'sine');tone(790,.22,.15,.13,'sine')}
async function soundOffline(){if(!(await ensureAudio()))return;tone(620,.13,0,.12,'sine');tone(350,.28,.15,.13,'sine')}
async function soundCancelled(){if(!(await ensureAudio()))return;tone(430,.23,0,.13,'triangle');tone(300,.32,.27,.13,'triangle');navigator.vibrate?.([140,80,140])}
function current(){return R.detail||R.call}
function startRing(){stopRing();soundCall();R.ring=setInterval(()=>{const item=current();if(item?.requires_acceptance&&!R.decision)soundCall();else stopRing()},3500)}
function stopRing(){clearInterval(R.ring);R.ring=null;navigator.vibrate?.(0)}
function inline(text,error=false){const line=$('#cj210-inline')||$('#cj199-queue-text');if(line){line.textContent=text||'';line.classList.toggle('error',error);line.classList.toggle('cj210-error',error)}}
function removeBalloons(){if(!isDriver())return;$$('#toast-container>*,.toast,.notification-toast,.notice-toast,#cj199-notice,[role="status"]').forEach(n=>n.remove())}
function patchToast(){if(window.__CJ210_TOAST_PATCHED||typeof window.toast!=='function')return;window.__CJ210_TOAST_PATCHED=true;R.toastOriginal=window.toast;window.toast=function(message,type='success',...rest){if(isDriver()){inline(String(message||''),type==='error');return}return R.toastOriginal.call(this,message,type,...rest)}}
function panelShell(){let host=$('#cj210-call');if(host)return host;host=document.createElement('section');host.id='cj210-call';host.innerHTML='<div id="cj210-body"></div><div id="cj210-inline"></div>';$('#cj199-app')?.appendChild(host);return host}
function statusLabel(status){return ({assigned:'NOVA ENTREGA',offered:'NOVA ENTREGA',accepted:'ACEITA',to_pickup:'INDO PARA COLETA',at_pickup:'NA COLETA',picked_up:'COLETADA',in_route:'INDO AO CLIENTE',problem:'COM PROBLEMA'})[status]||String(status||'').toUpperCase()}
function payment(value){const map={pix:'PIX',dinheiro:'Dinheiro',cash:'Dinheiro',credit:'Crédito pré-pago',credito:'Crédito pré-pago',card:'Cartão',cortesia:'Cortesia'};return map[String(value||'').toLowerCase()]||String(value||'Não informado')}
function row(label,value){return `<span><small>${esc(label)}</small><b>${esc(value)}</b></span>`}
function render(){
 const host=panelShell(),body=$('#cj210-body'),item=current();if(!host||!body)return;
 if(!item){host.classList.remove('show','offer');body.innerHTML='';return}
 const offer=Boolean(item.requires_acceptance)||(['assigned','offered'].includes(item.status)&&!item.accepted_at);
 const services=(item.services||[]).map(x=>x.service_name).filter(Boolean).join(', '),receive=Number(item.driver_net_cents||item.driver_earnings_cents||item.driver_gross_cents||0),charge=Number(item.charge_cents||0);
 const displacementDistance=Number(item.distance_to_pickup_meters||item.displacement_distance_meters||0),displacementRate=Number(item.displacement_rate_cents_per_km||0);
 host.classList.add('show');host.classList.toggle('offer',offer);
 body.innerHTML=`<header><div><small>${esc(offer?'NOVA ENTREGA':statusLabel(item.status))}</small><strong>${esc(item.display_code||'Entrega')}</strong></div><b>${money(receive||charge)}</b></header>
 <div class="cj210-route"><article><i>C</i><div><small>COLETA</small><strong>${esc(item.pickup_address||'Endereço não informado')}</strong>${item.pickup_complement?`<span>${esc(item.pickup_complement)}</span>`:''}</div></article><article><i>E</i><div><small>ENTREGA</small><strong>${esc(item.delivery_address||'Endereço não informado')}</strong>${item.delivery_complement?`<span>${esc(item.delivery_complement)}</span>`:''}</div></article></div>
 <div class="cj210-metrics">${row('Até coleta',displacementDistance<1000?meters(displacementDistance):km(displacementDistance))}${row('Rota',km(item.route_distance_meters||item.distance_meters))}${row('Total',km(item.total_distance_meters||item.distance_meters))}${row('Tempo',mins(item.duration_seconds))}</div>
 <div class="cj210-info">${row('Valor da corrida',money(charge))}${row('Você recebe',money(receive))}${row('Pagamento',payment(item.payment_method))}${row('Gasto com combustível',item.fuel_cost_cents==null?'Não configurado':money(item.fuel_cost_cents))}${row('Consumo da moto',item.fuel_km_per_liter?`${Number(item.fuel_km_per_liter).toFixed(1).replace('.',',')} km/L`:'Não configurado')}${row('Preço combustível',item.fuel_price_cents?`${money(item.fuel_price_cents)}/L`:'Não configurado')}${row('Deslocamento',money(item.displacement_cents))}${row('Tarifa deslocamento',displacementRate?`${money(displacementRate)}/km`:'Não configurada')}${row('Retorno',money(item.return_cents))}${row('Serviços',money(item.service_charge_cents||item.services_cents))}${Number(item.wait_charge_cents||0)>0?row('Espera',money(item.wait_charge_cents)):''}${Number(item.cancellation_charge_cents||0)>0?row('Cancelamento',money(item.cancellation_charge_cents)):''}</div>
 ${services?`<div class="cj210-note"><small>SERVIÇOS SELECIONADOS</small><p>${esc(services)}</p></div>`:''}${item.item_description?`<div class="cj210-note"><small>ITEM</small><p>${esc(item.item_description)}</p></div>`:''}${item.notes?`<div class="cj210-note"><small>OBSERVAÇÕES</small><p>${esc(item.notes)}</p></div>`:''}
 ${offer?`<div class="cj210-actions"><button id="cj210-decline" type="button">RECUSAR</button><button id="cj210-accept" type="button">ACEITAR</button></div><div id="cj210-decline-box"><textarea id="cj210-reason" maxlength="500" placeholder="Motivo da recusa"></textarea><div><button id="cj210-cancel-decline" type="button">Voltar</button><button id="cj210-confirm-decline" type="button">Confirmar recusa</button></div></div>`:`<div class="cj210-progress">${esc(statusLabel(item.status))}<small>As etapas da coleta são atualizadas automaticamente pelo GPS.</small></div>`}`;
 if(offer){$('#cj210-accept').onclick=accept;$('#cj210-decline').onclick=()=>$('#cj210-decline-box').classList.add('open');$('#cj210-cancel-decline').onclick=()=>$('#cj210-decline-box').classList.remove('open');$('#cj210-confirm-decline').onclick=decline}
}
async function detail(id){try{const data=await api(`/api/app/v28/driver/calls/${encodeURIComponent(id)}`,{timeout:4500});R.detail=data.item;if(!R.call)R.call=data.item;render();if(data.item?.requires_acceptance&&!R.ring)startRing()}catch(error){inline(error.message,true)}}
async function accept(){const item=current();if(R.decision||!item?.id)return;await ensureAudio();R.decision='accept';stopRing();const button=$('#cj210-accept');if(button){button.disabled=true;button.textContent='ACEITANDO…'}try{const data=await api(`/api/app/v28/driver/calls/${encodeURIComponent(item.id)}/accept`,{method:'POST',timeout:5500,body:{}});R.call=null;R.detail={...item,requires_acceptance:false,accepted_at:new Date().toISOString(),status:data.status||'accepted'};render();inline(data.message||'Entrega aceita.');setTimeout(poll,100)}catch(error){R.decision=null;if(button){button.disabled=false;button.textContent='ACEITAR'}inline(error.message,true);startRing()}}
async function decline(){const item=current();if(R.decision||!item?.id)return;await ensureAudio();R.decision='decline';stopRing();const reason=String($('#cj210-reason')?.value||'').trim()||'Não consigo realizar esta entrega.';const button=$('#cj210-confirm-decline');if(button){button.disabled=true;button.textContent='RECUSANDO…'}try{await api(`/api/app/v28/driver/calls/${encodeURIComponent(item.id)}/decline`,{method:'POST',timeout:5500,body:{reason}});R.call=R.detail=null;R.decision=null;render();inline('Entrega recusada.')}catch(error){R.decision=null;if(button){button.disabled=false;button.textContent='Confirmar recusa'}inline(error.message,true);startRing()}}
function guardQueue(){const button=$('#cj199-queue');if(!button||button.dataset.cj210Guard)return;button.dataset.cj210Guard='1';button.addEventListener('click',event=>{const item=current(),active=item&&!item.requires_acceptance&&!['assigned','offered','delivered','cancelled'].includes(item.status);if(!active)return;event.preventDefault();event.stopImmediatePropagation();inline(`Finalize a entrega ${item.display_code||''} antes de entrar na fila.`,true)},true)}
async function poll(){
 if(!isDriver()||!token()||document.hidden||R.busy)return;R.busy=true;
 try{
  const data=await api('/api/app/driver/live',{timeout:4200}),online=Boolean(Number(data.driver?.online)),call=data.call||null,active=data.active||null;
  if(R.lastOnline===null)R.lastOnline=online;else if(R.lastOnline!==online){R.lastOnline=online;online?soundOnline():soundOffline()}
  const item=call||active;
  if(item){const changed=!current()||current().id!==item.id;R.call=item;R.detail={...(changed?{}:R.detail),...item};if(changed)R.decision=null;await detail(item.id)}
  else if(current()&&!R.decision){const wasOffer=Boolean(current()?.requires_acceptance);R.call=R.detail=null;stopRing();render();if(wasOffer)soundCancelled()}
  guardQueue();
 }catch{}finally{R.busy=false}
}
function autoGps(){const item=current();if(!isDriver()||document.hidden||Date.now()-R.autoSent<7000||item?.requires_acceptance)return;R.autoSent=Date.now();navigator.geolocation?.getCurrentPosition(p=>api('/api/app/v28/driver/auto-location',{method:'POST',timeout:4200,body:{latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}}).then(data=>{if(R.detail&&data.status&&R.detail.status!==data.status){R.detail.status=data.status;render()}}).catch(()=>{}),()=>{},{enableHighAccuracy:true,maximumAge:5000,timeout:6000})}
function apply(){patchToast();removeBalloons();if(isDriver()&&$('#cj199-app')){panelShell();guardQueue()}}
function boot(){
 ['pointerdown','touchstart','click','keydown'].forEach(event=>document.addEventListener(event,()=>ensureAudio(),{passive:true}));
 apply();new MutationObserver(()=>requestAnimationFrame(apply)).observe(document.documentElement,{childList:true,subtree:true});
 clearInterval(R.poll);R.poll=setInterval(()=>{poll();autoGps()},3000);poll();autoGps();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){ensureAudio();poll()}})
}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();