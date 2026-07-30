/* ChegaJá 14.23.3 — escala estável, serviços unificados, avulso separado e edição completa */
(()=>{
'use strict';
if(window.__CJ211_STABILITY__)return;window.__CJ211_STABILITY__=true;
const originalFetch=window.fetch.bind(window);
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const moneyInput=v=>(Number(v||0)/100).toFixed(2);
const urlOf=input=>{try{return new URL(input instanceof Request?input.url:String(input),location.origin)}catch{return null}};
async function jsonClone(response){try{return await response.clone().json()}catch{return null}}
function jsonResponse(data,response){return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers:{'Content-Type':'application/json'}})}
async function requestJson(path,auth=true,opt={}){const response=await originalFetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(auth&&token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);return data}
window.fetch=async function(input,init={}){
 const url=urlOf(input),method=String(init.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase();
 const response=await originalFetch(input,init);
 if(!url||url.origin!==location.origin)return response;
 if(method==='GET'&&url.pathname==='/api/app/v16/base/delivery-form-data'&&response.ok){
  const data=await jsonClone(response);if(!data)return response;
  try{const fixes=await requestJson(`/api/app/v29/base/form-fixes?base_id=${encodeURIComponent(url.searchParams.get('base_id')||'')}`);data.services=fixes.services||data.services||[];const allowed=new Set(fixes.registered_customer_ids||[]);data.customers=(data.customers||[]).filter(item=>allowed.has(String(item.id)));return jsonResponse(data,response)}catch{return response}
 }
 if(method==='POST'&&/^\/api\/app\/v16\/base\/[^/]+\/services$/.test(url.pathname)&&response.ok){
  const data=await jsonClone(response);if(data?.id)originalFetch(`/api/app/v29/base/services/${encodeURIComponent(data.id)}/activate`,{method:'POST',headers:token()?{Authorization:`Bearer ${token()}`}:{},cache:'no-store'}).catch(()=>{});return response
 }
 if(method==='GET'&&url.pathname==='/api/client/catalog'&&response.ok){
  const data=await jsonClone(response);if(!data)return response;
  const coop=url.searchParams.get('cooperative_id')||url.searchParams.get('coop')||'';
  try{const extra=await requestJson(`/api/client/v29/services?cooperative_id=${encodeURIComponent(coop)}`,false);data.services=extra.items||data.services||[];return jsonResponse(data,response)}catch{return response}
 }
 return response;
};
function bindScale(){
 const sheet=document.querySelector('#cj199-sheet'),list=document.querySelector('#cj199-schedules');
 if(sheet&&!sheet.dataset.cj211){sheet.dataset.cj211='1';new MutationObserver(()=>document.body.classList.toggle('cj210-scale-open',sheet.classList.contains('open'))).observe(sheet,{attributes:true,attributeFilter:['class']});document.body.classList.toggle('cj210-scale-open',sheet.classList.contains('open'))}
 if(list&&!list.dataset.cj211){list.dataset.cj211='1';['touchstart','touchmove','touchend','pointerdown','pointermove','pointerup'].forEach(event=>list.addEventListener(event,e=>e.stopPropagation(),{passive:true}))}
}
function formBody(form){const body={};for(const [key,value] of new FormData(form).entries()){if(key.endsWith('[]')){const name=key.slice(0,-2);(body[name]||(body[name]=[])).push(value)}else body[key]=value}for(const checkbox of form.querySelectorAll('input[type="checkbox"]:not([name$="[]"])'))body[checkbox.name]=checkbox.checked;return body}
function serviceHtml(items,selected){const chosen=new Set((selected||[]).map(String));return `<div class="full service-grid">${(items||[]).map(s=>`<label class="service-option"><input type="checkbox" name="service_ids[]" value="${esc(s.id)}" ${chosen.has(String(s.id))?'checked':''}><span><strong>${esc(s.name)}</strong><small>${esc(s.description||'')}${Number(s.add_cents||0)>0?` • +R$ ${(Number(s.add_cents)/100).toFixed(2).replace('.',',')}`:''}</small></span></label>`).join('')||'<span class="muted">Nenhum serviço cadastrado nesta Base.</span>'}</div>`}
async function editDelivery(id){
 try{
  window.loading?.(true);const data=await requestJson(`/api/app/v16/base/deliveries/${encodeURIComponent(id)}/edit-data`),item=data.item||{};
  const fixes=await requestJson(`/api/app/v29/base/form-fixes?base_id=${encodeURIComponent(item.base_id||'')}`).catch(()=>({services:[]}));
  const status=String(item.status||'new');
  window.openModal?.(`Editar entrega ${item.display_code||''}`,`<form id="cj211-edit-delivery" class="form-grid">
   <input type="hidden" name="status" value="${esc(status)}">
   <div class="full notice"><strong>Status preservado: ${esc(status)}</strong><br>É possível corrigir valores, serviços e observações mesmo após conclusão ou cancelamento. O histórico da edição será mantido.</div>
   <label>Nome do cliente<input name="customer_name" value="${esc(item.customer_name||'')}"></label><label>Telefone do cliente<input name="customer_phone" value="${esc(item.customer_phone||'')}"></label>
   <label>Contato da coleta<input name="pickup_contact_name" value="${esc(item.pickup_contact_name||'')}"></label><label>Telefone da coleta<input name="pickup_phone" value="${esc(item.pickup_phone||'')}"></label>
   <label class="full">Coleta<input value="${esc(item.pickup_address||'')}" readonly></label><label class="full">Entrega<input value="${esc(item.delivery_address||'')}" readonly></label>
   <label>Quem recebe<input name="recipient_name" value="${esc(item.recipient_name||'')}"></label><label>Telefone de quem recebe<input name="recipient_phone" value="${esc(item.recipient_phone||'')}"></label>
   <label class="full">Descrição do item<textarea name="item_description">${esc(item.item_description||'')}</textarea></label>
   <label>Valor atual da entrega<input name="charge_value" type="number" step="0.01" min="0" value="${moneyInput(item.base_charge_cents||item.charge_cents)}"></label>
   <label>Valor da rota<input name="route_charge_value" type="number" step="0.01" min="0" value="${moneyInput(item.route_charge_cents)}"></label>
   <label>Valor já pago<input name="paid_value" type="number" step="0.01" min="0" value="${moneyInput(item.paid_cents)}"></label>
   <label>Pagamento<select name="payment_method"><option value="pix" ${item.payment_method==='pix'?'selected':''}>PIX</option><option value="dinheiro" ${item.payment_method==='dinheiro'?'selected':''}>Dinheiro</option><option value="credit" ${item.payment_method==='credit'?'selected':''}>Crédito pré-pago</option><option value="pix_cooperativa" ${item.payment_method==='pix_cooperativa'?'selected':''}>PIX Cooperativa</option></select></label>
   <label>Status do pagamento<select name="payment_status"><option value="pending" ${item.payment_status!=='paid'?'selected':''}>Pendente</option><option value="paid" ${item.payment_status==='paid'?'selected':''}>Pago</option></select></label>
   <label class="full"><input type="checkbox" name="return_required" ${Number(item.return_required||0)===1?'checked':''}> Cobrar retorno conforme percentual configurado na Base</label>
   <label class="full"><input type="checkbox" name="recalculate_charge"> Recalcular o total usando rota, deslocamento, retorno e serviços</label>
   <div class="full"><strong>Serviços da entrega</strong></div>${serviceHtml(fixes.services||[],data.service_ids||[])}
   <label class="full">Observações<textarea name="notes" rows="4">${esc(item.notes||'')}</textarea></label>
   <div class="form-actions full"><button type="button" class="btn" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Salvar edição</button></div>
  </form>`);
  const form=document.querySelector('#cj211-edit-delivery');if(!form)return;
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;try{window.loading?.(true);await requestJson(`/api/app/v16/base/deliveries/${encodeURIComponent(id)}`,true,{method:'PUT',body:formBody(form)});window.closeModal?.();window.toast?.('Entrega atualizada.');await window.pages?.deliveries?.()}catch(error){window.toast?.(error.message,'error');button.disabled=false}finally{window.loading?.(false)}};
 }catch(error){window.toast?.(error.message,'error')}finally{window.loading?.(false)}
}
function enhanceEditButtons(){
 if(!['cooperative_admin','dispatcher'].includes(window.state?.user?.role||'')||window.state?.page!=='deliveries')return;
 document.querySelectorAll('[data-lg-view]').forEach(view=>{const parent=view.parentElement;if(!parent||parent.querySelector(`[data-cj211-edit="${view.dataset.lgView}"]`))return;const button=document.createElement('button');button.type='button';button.className='table-action primary';button.dataset.cj211Edit=view.dataset.lgView;button.textContent='Editar';button.onclick=()=>editDelivery(button.dataset.cj211Edit);parent.insertBefore(button,view.nextSibling)})
}
function boot(){bindScale();enhanceEditButtons();new MutationObserver(()=>requestAnimationFrame(()=>{bindScale();enhanceEditButtons()})).observe(document.documentElement,{childList:true,subtree:true})}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();