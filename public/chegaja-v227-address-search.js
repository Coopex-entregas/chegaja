/* ChegaJá 14.29.9 — endereço único: digitar, localizar e confirmar */
(()=>{
'use strict';
if(window.__CJ227_ADDRESS_SEARCH_14299__)return;
window.__CJ227_ADDRESS_SEARCH_14299__=true;

function enhanceBlock(block){
 if(!block||block.dataset.cj227==='1')return;
 block.dataset.cj227='1';
 const prefix=block.dataset.addressBlock||'';
 const input=block.querySelector(`[data-address-autocomplete="${CSS.escape(prefix)}"]`)||block.querySelector('[data-address-autocomplete]');
 const label=input?.closest('label');
 const grid=block.querySelector('.address-grid');
 const button=block.querySelector('[data-address-search]');
 const result=block.querySelector('.address-confirm-result');
 if(label){
  label.childNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE&&String(node.textContent||'').trim())node.textContent='Endereço completo '});
  let help=label.querySelector('.cj227-address-help');
  if(!help){help=document.createElement('small');help.className='cj227-address-help';help.textContent='Digite rua e número ou o nome do local. Depois clique no endereço correto.';label.appendChild(help)}
 }
 if(input){
  input.required=true;
  input.autocomplete='off';
  input.placeholder='Ex.: Rua José Freire de Souza, 22, Natal ou Natal Shopping';
  input.setAttribute('aria-label','Buscar endereço completo');
 }
 if(grid){
  grid.classList.add('cj227-hidden-address-fields');
  grid.querySelectorAll('input,select,textarea').forEach(field=>{field.required=false;field.tabIndex=-1});
 }
 if(button){button.hidden=true;button.tabIndex=-1}
 if(result){
  result.classList.add('cj227-address-result');
  if(!result.querySelector('.confirmed-address'))result.innerHTML='<span class="muted">Digite acima e selecione uma opção para confirmar e calcular a rota.</span>';
 }
 const live=block.querySelector('[data-address-live-results]');
 live?.addEventListener('click',()=>setTimeout(()=>{
  const token=block.querySelector(`input[name="${CSS.escape(prefix)}_confirmation_token"]`);
  if(token?.value&&input)input.setCustomValidity('');
 },0));
 input?.addEventListener('input',()=>{
  const token=block.querySelector(`input[name="${CSS.escape(prefix)}_confirmation_token"]`);
  if(token?.value)token.value='';
  input.setCustomValidity('');
 });
}
function validateForm(form){
 const blocks=[...form.querySelectorAll('[data-address-block]')];
 for(const block of blocks){
  const prefix=block.dataset.addressBlock||'';
  const input=block.querySelector('[data-address-autocomplete]');
  const token=block.querySelector(`input[name="${CSS.escape(prefix)}_confirmation_token"]`);
  if(token&&!token.value){
   input?.setCustomValidity('Selecione um endereço na lista para confirmar e calcular a rota.');
   input?.reportValidity();
   return false;
  }
 }
 return true;
}
function bindValidation(){
 if(document.documentElement.dataset.cj227Validation==='1')return;
 document.documentElement.dataset.cj227Validation='1';
 document.addEventListener('submit',event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||!form.querySelector('[data-address-block]'))return;
  if(!validateForm(form)){event.preventDefault();event.stopImmediatePropagation()}
 },true);
}
function health(){document.querySelectorAll('[data-address-block]').forEach(enhanceBlock)}
function boot(){
 bindValidation();
 const observer=new MutationObserver(()=>requestAnimationFrame(health));
 observer.observe(document.documentElement,{childList:true,subtree:true});
 health();
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();
