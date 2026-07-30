/* ChegaJá 14.29.8 — navegação interna, troca por cooperado e check-in da escala */
(()=>{
'use strict';
if(window.__CJ225_DRIVER_POLISH_14298__)return;
window.__CJ225_DRIVER_POLISH_14298__=true;

const $=(s,r=document)=>r.querySelector(s);
const isDriver=()=>window.state?.user?.role==='driver';
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const titles={schedules:'Escala, filtros e trocas',deliveries:'Minhas entregas',routes:'Rotas',financial:'Ganhos e descontos',advances:'Adiantamentos',ratings:'Avaliações',profile:'Perfil e configurações',account:'Alterar senha',attendance:'Check-in'};
let checkingIn=false;
let stableEarnings='';

async function api(path,opt={}){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),opt.timeout||7000);
 try{
  const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:ctl.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);
  return data;
 }finally{clearTimeout(timer)}
}
function notice(message,error=false){
 let node=$('#cj223-message');
 if(!node){node=document.createElement('div');node.id='cj223-message';document.body.appendChild(node)}
 node.textContent=String(message||'');
 node.className=`show${error?' error':''}`;
 clearTimeout(node._timer);
 node._timer=setTimeout(()=>node.className='',4800);
}
function getPosition(){
 const cached=window.ChegaJaLastDriverLocation;
 if(cached?.lat!=null&&cached?.lng!=null&&Number(cached.accuracy||999)<=80)return Promise.resolve({coords:{latitude:Number(cached.lat),longitude:Number(cached.lng),accuracy:Number(cached.accuracy||0)}});
 return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:1500,timeout:12000}):reject(new Error('GPS indisponível.')));
}
function distanceMeters(aLat,aLng,bLat,bLng){
 const lat1=Number(aLat),lng1=Number(aLng),lat2=Number(bLat),lng2=Number(bLng);
 if(![lat1,lng1,lat2,lng2].every(Number.isFinite))return Infinity;
 const rad=x=>x*Math.PI/180,earth=6371000,dLat=rad(lat2-lat1),dLng=rad(lng2-lng1);
 const h=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLng/2)**2;
 return Math.round(2*earth*Math.asin(Math.min(1,Math.sqrt(h))));
}
function formatTime(value){
 if(!value)return '';
 const date=new Date(value);
 return Number.isNaN(date.getTime())?'':date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
function goHome(){
 try{window.navigate?.('dashboard')}catch{location.hash='dashboard'}
}
function ensureBackHeader(){
 if(!isDriver()||window.state?.page==='dashboard')return;
 const content=$('#page-content');if(!content)return;
 document.body.classList.add('cj199-driver-page');
 document.body.classList.remove('cj199-driver');
 let header=$('#cj199-internal-header');
 if(!header){
  header=document.createElement('header');
  header.id='cj199-internal-header';
  header.innerHTML='<button type="button" aria-label="Voltar">←</button><div><small>MEU APLICATIVO</small><strong></strong></div><span aria-hidden="true"></span>';
  content.prepend(header);
 }
 const back=header.querySelector('button');
 if(back){back.type='button';back.setAttribute('aria-label','Voltar para o início');back.onclick=goHome}
 const title=header.querySelector('strong');
 if(title)title.textContent=titles[window.state?.page]||'Meu aplicativo';
 $('#menu-button')?.classList.add('hidden');
 $('#sidebar')?.classList.remove('open');
}
function fillDetected(detected,option){
 const small=document.createElement('small'),span=document.createElement('span');
 if(option?.value){
  const strong=document.createElement('strong');
  small.textContent='ESCALA IDENTIFICADA AUTOMATICAMENTE';
  strong.textContent=String(option.dataset.scheduleDescription||option.textContent||'');
  span.textContent='O sistema usará esse turno e conferirá bloqueio, afastamento, conflito e tempo de deslocamento.';
  detected.replaceChildren(small,strong,span);
 }else{
  small.textContent='ESCOLHA UM COOPERADO';
  span.textContent='A escala compatível e o mesmo turno serão identificados automaticamente.';
  detected.replaceChildren(small,span);
 }
}
function polishSwapPicker(){
 if(!isDriver())return;
 const select=$('#cj223-target');
 if(!select||select.dataset.cj225Polished==='1')return;
 select.dataset.cj225Polished='1';
 const label=select.closest('label');
 if(label?.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent='Escolha o cooperado';
 const seen=new Set();
 [...select.options].slice(1).forEach(option=>{
  const original=String(option.textContent||'').trim();
  const driver=original.split(' — ')[0].trim()||original;
  option.dataset.scheduleDescription=original;
  const key=driver.toLocaleLowerCase('pt-BR');
  if(seen.has(key)){option.remove();return}
  seen.add(key);
  option.textContent=driver;
 });
 let detected=$('#cj225-detected-schedule');
 if(!detected){
  detected=document.createElement('div');
  detected.id='cj225-detected-schedule';
  detected.className='cj225-detected-schedule';
  label?.insertAdjacentElement('afterend',detected);
 }
 const update=()=>fillDetected(detected,select.selectedOptions?.[0]);
 select.addEventListener('change',update);
 update();
}
async function performCheckin(button){
 if(checkingIn)return;
 if(window.ChegaJaDriverCurrentDelivery){notice('Finalize a entrega atual antes de fazer o check-in.',true);return}
 checkingIn=true;
 const previous=button?.innerHTML;
 if(button){button.disabled=true;if(button.id==='cj199-checkin')button.innerHTML='<b>…</b><small>AGUARDE</small>';else button.textContent='Fazendo check-in…'}
 try{
  const locations=await api('/api/app/v25/driver/checkin/locations');
  if(locations.active){
   const when=formatTime(locations.active.checkin_at);
   notice(`Check-in já ativo em ${locations.active.location_name||'seu local'}${when?` desde ${when}`:''}.`);
   return;
  }
  const items=locations.items||[];
  if(!items.length)throw new Error('Você não possui escala ativa agora. O check-in só é liberado no estabelecimento ou na Base em que estiver escalado.');
  const position=await getPosition(),lat=position.coords.latitude,lng=position.coords.longitude;
  const ranked=items.map(item=>({...item,_distance:distanceMeters(lat,lng,item.latitude,item.longitude)})).sort((a,b)=>a._distance-b._distance);
  const selected=ranked[0];
  if(!selected)throw new Error('Não foi possível identificar o local da sua escala.');
  const result=await api('/api/app/v25/driver/checkin',{method:'POST',body:{schedule_id:selected.schedule_id,location_type:selected.location_type,location_id:selected.location_id,latitude:lat,longitude:lng,accuracy:position.coords.accuracy},timeout:8000});
  const when=formatTime(result.checkin_at)||new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  notice(`${result.message||`Check-in confirmado em ${selected.location_name||'seu local'}.`} Horário: ${when}.`);
 }catch(error){notice(error.name==='AbortError'?'A conexão demorou. Tente novamente.':error.message,true)}
 finally{
  checkingIn=false;
  if(button){button.disabled=false;if(previous!==undefined)button.innerHTML=previous}
 }
}
function bindCheckin(){
 if(document.documentElement.dataset.cj225CheckinBound==='1')return;
 document.documentElement.dataset.cj225CheckinBound='1';
 document.addEventListener('click',event=>{
  const button=event.target?.closest?.('#cj199-checkin,#cj199-drawer [data-checkin]');
  if(!button||!isDriver())return;
  event.preventDefault();
  event.stopImmediatePropagation();
  performCheckin(button);
 },true);
}
function stabilizeEarnings(){
 const label=$('#cj199-metric-label'),value=$('#cj199-metric-value');
 if(!label||!value||String(label.textContent||'').trim()!=='GANHOS HOJE')return;
 const text=String(value.textContent||'').trim(),compact=text.replace(/\s/g,'');
 const zero=/^(?:R\$)?0(?:[.,]00)?$/.test(compact);
 if(!zero){stableEarnings=text;return}
 if(stableEarnings&&value.textContent!==stableEarnings)value.textContent=stableEarnings;
}
function health(){
 if(!isDriver())return;
 stabilizeEarnings();
 ensureBackHeader();
 polishSwapPicker();
 const quick=$('#cj199-drawer [data-scale]');if(quick)quick.hidden=false;
}
function boot(){
 bindCheckin();
 clearInterval(window.__CJ225_HEALTH__);
 window.__CJ225_HEALTH__=setInterval(health,700);
 health();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)health()});
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();
