/* ChegaJá 14.29.6 — painel do cooperado: escala completa, trocas e navegação estável */
(()=>{
'use strict';
if(window.__CJ223_DRIVER_FINAL_14296__)return;
window.__CJ223_DRIVER_FINAL_14296__=true;

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
const isoDate=(d=new Date())=>{const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)};
const addDays=(date,n)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+n);return isoDate(d)};
const mondayOf=date=>{const d=new Date(`${date}T12:00:00`),day=d.getDay();d.setDate(d.getDate()-(day===0?6:day-1));return isoDate(d)};
const dateBR=value=>{const raw=String(value||'').slice(0,10);if(!raw)return '—';const d=new Date(`${raw}T12:00:00`);return d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).replace('.','')};
const timeOf=value=>String(value||'').slice(11,16)||'—';
const statusText={scheduled:'Agendada',confirmed:'Confirmada',pending:'Pendente',accepted:'Aceita',rejected:'Recusada',cancelled:'Cancelada'};
const F={sheetWanted:false,restoring:false,boundSheet:null,metricObserver:null,metricValues:new Map(),metricZeros:new Map(),routeMain:null,routeCasing:null,routeKey:'',navigation:null,moveHooked:false,timer:null,lastFollowAt:0,scheduleInstalled:false};

async function api(path,opt={}){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),opt.timeout||7000);
 try{
  const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:ctl.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false){const error=new Error(data.error||`Erro ${response.status}`);error.data=data;throw error}
  return data;
 }finally{clearTimeout(timer)}
}

function notice(message,error=false){
 let node=$('#cj223-message');
 if(!node){node=document.createElement('div');node.id='cj223-message';document.body.appendChild(node)}
 node.textContent=String(message||'');node.className=`show${error?' error':''}`;clearTimeout(node._timer);node._timer=setTimeout(()=>node.className='',4200);
}

function sheet(){return $('#cj199-sheet')}
function markOpen(){F.sheetWanted=true;const node=sheet();if(node&&!node.classList.contains('open'))node.classList.add('open')}
function markClosed(){F.sheetWanted=false}
function bindSheet(){
 const node=sheet();if(!node||F.boundSheet===node)return;
 F.boundSheet=node;F.sheetWanted=node.classList.contains('open');
 const down=node.querySelector('#cj199-down'),handle=node.querySelector('.handle'),up=$('#cj199-up');
 down?.addEventListener('pointerdown',markClosed,true);handle?.addEventListener('pointerdown',markClosed,true);up?.addEventListener('pointerdown',markOpen,true);
 let startY=null;const bottom=$('#cj199-bottom');
 bottom?.addEventListener('touchstart',event=>{startY=event.touches[0]?.clientY??null},{passive:true});
 bottom?.addEventListener('touchend',event=>{if(startY==null)return;const end=event.changedTouches[0]?.clientY??startY;if(end-startY<-28)markOpen();startY=null},{passive:true});
 new MutationObserver(()=>{
  const open=node.classList.contains('open');
  if(open){if(!F.restoring)F.sheetWanted=true;return}
  if(F.sheetWanted&&isDriver()&&document.body.classList.contains('cj199-driver')){
   F.restoring=true;queueMicrotask(()=>{node.classList.add('open');F.restoring=false});
  }
 }).observe(node,{attributes:true,attributeFilter:['class']});
}

function bindMetric(){
 const value=$('#cj199-metric-value'),label=$('#cj199-metric-label');if(!value||!label||F.metricObserver)return;
 const inspect=()=>{
  const key=String(label.textContent||'').trim(),text=String(value.textContent||'').trim();if(!key||!text)return;
  const compact=text.replace(/\s/g,''),isZero=/^(?:R\$)?0(?:[.,]00)?$/.test(compact),previous=F.metricValues.get(key);
  if(!isZero){F.metricValues.set(key,text);F.metricZeros.set(key,0);return}
  const zeros=(F.metricZeros.get(key)||0)+1;F.metricZeros.set(key,zeros);
  if(previous&&zeros<3&&value.textContent!==previous)queueMicrotask(()=>{value.textContent=previous});
 };
 F.metricObserver=new MutationObserver(inspect);F.metricObserver.observe(value,{childList:true,characterData:true,subtree:true});F.metricObserver.observe(label,{childList:true,characterData:true,subtree:true});inspect();
}

function routePoints(route){return(route?.geometry||[]).filter(p=>Array.isArray(p)&&p.length>1&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))).map(p=>[Number(p[0]),Number(p[1])])}
function clearRoute(){for(const layer of [F.routeMain,F.routeCasing])if(layer)try{layer.remove()}catch{}F.routeMain=F.routeCasing=null;F.routeKey=''}
function drawRoute(route){
 const map=window.ChegaJaDriverMap?.map;if(!map||typeof L==='undefined')return;
 const points=routePoints(route);if(points.length<2){clearRoute();return}
 const first=points[0],last=points[points.length-1],key=`${points.length}:${first[0].toFixed(5)}:${first[1].toFixed(5)}:${last[0].toFixed(5)}:${last[1].toFixed(5)}`;
 if(key===F.routeKey)return;clearRoute();F.routeKey=key;
 F.routeCasing=L.polyline(points,{color:'#fff',weight:14,opacity:.96,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
 F.routeMain=L.polyline(points,{color:'#1459ff',weight:8,opacity:1,dashArray:'18 10',lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
 F.routeCasing.bringToFront?.();F.routeMain.bringToFront?.();
}
function immersiveFollow(force=false){
 if(!isDriver()||!window.ChegaJaDriverActiveDelivery||!F.navigation)return;
 const map=window.ChegaJaDriverMap?.map,raw=window.ChegaJaLastDriverLocation;if(!map||!raw)return;
 const lat=Number(raw.lat),lng=Number(raw.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
 if(!force&&Date.now()-F.lastFollowAt<900)return;F.lastFollowAt=Date.now();
 try{map.setView([lat,lng],19,{animate:!force,duration:.35,noMoveStart:true});requestAnimationFrame(()=>{try{const size=map.getSize();map.panBy([0,-Math.round(size.y*.22)],{animate:!force,duration:.28,noMoveStart:true})}catch{}})}catch{}
}
function hookMapMove(){
 const mapApi=window.ChegaJaDriverMap;if(!mapApi||F.moveHooked||typeof mapApi.move!=='function')return;
 F.moveHooked=true;const original=mapApi.move.bind(mapApi);
 mapApi.move=position=>{const result=original(position);if(F.navigation&&window.ChegaJaDriverActiveDelivery)immersiveFollow(false);return result};
}
function navigationEvent(event){
 const detail=event.detail||null;
 if(!detail||!window.ChegaJaDriverActiveDelivery){F.navigation=null;clearRoute();return}
 F.navigation=detail;if(detail.arrived||!detail.route)clearRoute();else drawRoute(detail.route);immersiveFollow(true);
}

function enhanceDrawer(){
 if(!isDriver())return;const nav=$('#cj199-drawer nav'),quick=nav?.querySelector('[data-scale]');if(!nav||!quick)return;
 quick.textContent='Visualização rápida da escala';quick.hidden=false;
 let full=nav.querySelector('[data-cj223-schedules]');
 if(!full){full=document.createElement('button');full.type='button';full.dataset.cj223Schedules='1';full.textContent='Escala, filtros e trocas';quick.insertAdjacentElement('afterend',full);full.onclick=()=>window.navigate?.('schedules')}
}

function scheduleCard(item){
 const local=item.base_name||item.establishment_name||item.location_name||'Local não informado',status=statusText[item.status]||item.status||'Agendada';
 return `<article class="cj223-schedule-card" data-schedule-id="${esc(item.id)}"><div class="cj223-date"><small>${esc(dateBR(item.start_at).split(',')[0]||'')}</small><strong>${esc(String(item.start_at||'').slice(8,10))}</strong><span>${esc(String(item.start_at||'').slice(5,7))}</span></div><div class="cj223-schedule-info"><small>${esc(item.shift_label||'TURNO')}</small><h3>${esc(local)}</h3><b>${esc(timeOf(item.start_at))} às ${esc(timeOf(item.end_at))}</b><p>${esc(item.location_address||item.base_address||item.establishment_address||item.address||'Endereço não informado')}</p><em>${esc(status)}</em></div><button class="cj223-swap-start" type="button" data-source-schedule="${esc(item.id)}">Trocar este turno</button></article>`;
}
function swapCard(item,driverId){
 const incoming=String(item.requested_to_driver_id||'')===String(driverId),outgoing=String(item.requested_by_driver_id||'')===String(driverId),pending=item.status==='pending';
 const other=incoming?item.requester_name:item.target_name;
 return `<article class="cj223-swap-card"><header><span>${esc(statusText[item.status]||item.status)}</span><strong>${incoming?'Recebida de':'Enviada para'} ${esc(other||'cooperado')}</strong></header><div><p><b>Sua escala:</b> ${esc(dateBR(incoming?item.target_start:item.source_start))}, ${esc(timeOf(incoming?item.target_start:item.source_start))}–${esc(timeOf(incoming?item.target_end:item.source_end))}, ${esc(incoming?item.target_local:item.source_local)}</p><p><b>Escala recebida:</b> ${esc(dateBR(incoming?item.source_start:item.target_start))}, ${esc(timeOf(incoming?item.source_start:item.target_start))}–${esc(timeOf(incoming?item.source_end:item.target_end))}, ${esc(incoming?item.source_local:item.target_local)}</p></div>${pending&&incoming?`<footer><button type="button" class="secondary" data-swap-reject="${esc(item.id)}">Recusar</button><button type="button" data-swap-accept="${esc(item.id)}">Aceitar troca</button></footer>`:''}${pending&&outgoing?`<footer><button type="button" class="secondary" data-swap-cancel="${esc(item.id)}">Cancelar solicitação</button></footer>`:''}</article>`;
}

async function renderDriverSchedules(){
 if(!isDriver())return;
 const content=$('#page-content');if(!content)return;
 const today=isoDate(),from=window.state.cache.cj223From||mondayOf(today),to=window.state.cache.cj223To||addDays(from,13),tab=window.state.cache.cj223Tab||'schedule';
 content.innerHTML='<div class="cj223-loading">Carregando escala…</div>';
 try{
  const [scheduleData,swapData]=await Promise.all([api(`/api/app/schedule-grid?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),api(`/api/app/schedule-swaps?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)]);
  const schedules=scheduleData.items||[],swaps=swapData.items||[],driverId=window.state?.user?.driver_id||window.state?.user?.linked_driver_id||'';
  content.innerHTML=`<section class="cj223-schedule-page"><div class="cj223-filter"><label>De<input id="cj223-from" type="date" value="${esc(from)}"></label><label>Até<input id="cj223-to" type="date" value="${esc(to)}"></label><button id="cj223-filter" type="button">Aplicar</button></div><nav class="cj223-tabs"><button data-tab="schedule" class="${tab==='schedule'?'active':''}">Minha escala</button><button data-tab="swaps" class="${tab==='swaps'?'active':''}">Trocas ${swaps.filter(x=>x.status==='pending').length?`(${swaps.filter(x=>x.status==='pending').length})`:''}</button></nav><div id="cj223-tab-content">${tab==='schedule'?(schedules.length?schedules.map(scheduleCard).join(''):'<p class="cj223-empty">Nenhuma escala encontrada nesse período.</p>'):(swaps.length?swaps.map(x=>swapCard(x,driverId)).join(''):'<p class="cj223-empty">Nenhuma solicitação de troca nesse período.</p>')}</div><section id="cj223-swap-picker" hidden></section></section>`;
  $('#cj223-filter').onclick=()=>{const a=$('#cj223-from').value,b=$('#cj223-to').value;if(!a||!b||a>b){notice('Informe um período válido.',true);return}window.state.cache.cj223From=a;window.state.cache.cj223To=b;renderDriverSchedules()};
  $$('.cj223-tabs [data-tab]').forEach(button=>button.onclick=()=>{window.state.cache.cj223Tab=button.dataset.tab;renderDriverSchedules()});
  $$('[data-source-schedule]').forEach(button=>button.onclick=()=>openSwapPicker(schedules.find(x=>String(x.id)===String(button.dataset.sourceSchedule))));
  $$('[data-swap-accept]').forEach(button=>button.onclick=()=>respondSwap(button.dataset.swapAccept,'accepted'));
  $$('[data-swap-reject]').forEach(button=>button.onclick=()=>respondSwap(button.dataset.swapReject,'rejected'));
  $$('[data-swap-cancel]').forEach(button=>button.onclick=()=>cancelSwap(button.dataset.swapCancel));
 }catch(error){content.innerHTML=`<p class="cj223-empty error">${esc(error.message)}</p>`}
}

async function openSwapPicker(source){
 if(!source)return;const picker=$('#cj223-swap-picker');if(!picker)return;
 picker.hidden=false;picker.innerHTML='<div class="cj223-loading">Buscando cooperados disponíveis para o mesmo turno…</div>';picker.scrollIntoView({behavior:'smooth',block:'start'});
 try{
  const data=await api('/api/app/schedule-swaps/options'),start=timeOf(source.start_at),end=timeOf(source.end_at),shift=String(source.shift_label||'').trim().toLowerCase();
  const candidates=(data.items||[]).filter(item=>String(item.id)!==String(source.id)&&String(item.driver_id)!==String(source.driver_id)&&timeOf(item.start_at)===start&&timeOf(item.end_at)===end&&(!shift||String(item.shift_label||'').trim().toLowerCase()===shift));
  picker.innerHTML=`<header><div><small>TROCAR O MESMO TURNO</small><strong>${esc(dateBR(source.start_at))} • ${esc(start)} às ${esc(end)}</strong></div><button type="button" id="cj223-close-picker">×</button></header>${candidates.length?`<label>Escolha a escala do outro cooperado<select id="cj223-target"><option value="">Selecione</option>${candidates.map(item=>`<option value="${esc(item.id)}">${esc(item.driver_name)} — ${esc(dateBR(item.start_at))} — ${esc(item.local_name||'Sem local')}</option>`).join('')}</select></label><label>Mensagem opcional<textarea id="cj223-swap-message" maxlength="500" placeholder="Ex.: Preciso trocar este dia."></textarea></label><p class="cj223-rule">O sistema confere afastamentos, bloqueios no estabelecimento, conflitos e tempo de deslocamento antes de enviar.</p><button id="cj223-send-swap" type="button">Enviar solicitação de troca</button>`:'<p class="cj223-empty">Não há outro cooperado elegível com o mesmo turno e horário. Bloqueios e afastamentos já foram considerados.</p>'}`;
  $('#cj223-close-picker').onclick=()=>{picker.hidden=true;picker.innerHTML=''};
  $('#cj223-send-swap')?.addEventListener('click',async()=>{const target=$('#cj223-target').value;if(!target){notice('Selecione a escala do outro cooperado.',true);return}const button=$('#cj223-send-swap');button.disabled=true;try{const result=await api('/api/app/schedule-swaps',{method:'POST',body:{source_schedule_id:source.id,target_schedule_id:target,message:$('#cj223-swap-message').value}});const warnings=(result.warnings||[]).join(' ');notice(result.message||`Solicitação enviada.${warnings?` ${warnings}`:''}`);window.state.cache.cj223Tab='swaps';await renderDriverSchedules()}catch(error){notice(error.message,true);button.disabled=false}});
 }catch(error){picker.innerHTML=`<p class="cj223-empty error">${esc(error.message)}</p>`}
}
async function respondSwap(id,decision){
 const text=decision==='accepted'?'aceitar':'recusar';if(!confirm(`Confirma ${text} esta troca?`))return;
 try{const result=await api(`/api/app/schedule-swaps/${encodeURIComponent(id)}/respond`,{method:'POST',body:{decision}});notice(`Troca ${decision==='accepted'?'aceita':'recusada'}.${(result.warnings||[]).length?` ${(result.warnings||[]).join(' ')}`:''}`);await renderDriverSchedules()}catch(error){notice(error.message,true)}
}
async function cancelSwap(id){if(!confirm('Cancelar esta solicitação de troca?'))return;try{await api(`/api/app/schedule-swaps/${encodeURIComponent(id)}/cancel`,{method:'POST',body:{}});notice('Solicitação cancelada.');await renderDriverSchedules()}catch(error){notice(error.message,true)}}

function installSchedulePage(){
 if(F.scheduleInstalled||!window.pages)return;F.scheduleInstalled=true;
 const original=window.pages.schedules;
 window.pages.schedules=async function(){if(isDriver())return renderDriverSchedules();return original?.apply(this,arguments)};
}
function health(){
 if(!isDriver())return;installSchedulePage();bindSheet();bindMetric();hookMapMove();enhanceDrawer();
 if(F.sheetWanted&&sheet()&&!sheet().classList.contains('open')&&document.body.classList.contains('cj199-driver'))sheet().classList.add('open');
 if(F.navigation&&!F.navigation.arrived){drawRoute(F.navigation.route);immersiveFollow(false)}
}
function boot(){window.addEventListener('cj:driver-navigation',navigationEvent);clearInterval(F.timer);F.timer=setInterval(health,900);health();document.addEventListener('visibilitychange',()=>{if(!document.hidden){health();immersiveFollow(true)}})}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();
