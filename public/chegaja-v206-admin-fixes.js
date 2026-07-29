/* ChegaJá 14.22.2 — permissões por aba e fotos dos cooperados na operação */
(()=>{
'use strict';
if(window.__CJ206_ADMIN_FIXES__)return;window.__CJ206_ADMIN_FIXES__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const auth=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
async function api(path,opt={}){const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(auth()?{Authorization:`Bearer ${auth()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);return data}
function notify(text,type='success'){try{window.toast?.(text,type)}catch{alert(text)}}

function permissionForm(data){
 const user=data.user||{},modules=data.modules||[];
 return `<div class="cj206-permission-head"><div><small>USUÁRIO</small><strong>${esc(user.name||'Acesso')}</strong><span>${esc(user.email||'')}</span></div><label><input id="cj206-all-view" type="checkbox"> Marcar todas para visualizar</label></div>
 <form id="cj206-permissions-form"><div class="cj206-permission-table"><div class="head"><b>Aba</b><b>Ver</b><b>Criar</b><b>Editar</b><b>Excluir</b></div>${modules.map(item=>`<div class="row" data-module="${esc(item.key)}"><strong>${esc(item.label)}</strong><label title="Visualizar"><input type="checkbox" data-action="view" ${item.can_view?'checked':''}></label><label title="Cadastrar"><input type="checkbox" data-action="create" ${item.can_create?'checked':''}></label><label title="Editar"><input type="checkbox" data-action="edit" ${item.can_edit?'checked':''}></label><label title="Excluir"><input type="checkbox" data-action="delete" ${item.can_delete?'checked':''}></label></div>`).join('')}</div><div class="cj206-permission-note">Quando qualquer permissão personalizada é salva, o usuário passa a acessar somente as abas marcadas. Para apenas consultar uma aba, marque somente <b>Ver</b>.</div><div class="form-actions"><button type="button" class="btn" id="cj206-reset-permissions">Usar acesso padrão</button><button class="btn primary" type="submit">Salvar permissões</button></div></form>`
}
async function openPermissions(userId){
 try{
  window.loading?.(true);const data=await api(`/api/app/v26/users/${encodeURIComponent(userId)}/permissions`);
  if(data.user?.permissions_locked)throw new Error('Este perfil utiliza permissões fixas do sistema.');
  window.openModal?.('Permissões do usuário',permissionForm(data));
  const form=$('#cj206-permissions-form'),all=$('#cj206-all-view');
  all.onchange=()=>{$$('[data-action="view"]',form).forEach(input=>{input.checked=all.checked;if(!all.checked){const row=input.closest('.row');$$('input',row).forEach(x=>x.checked=false)}})};
  $$('[data-action]:not([data-action="view"])',form).forEach(input=>input.onchange=()=>{if(input.checked)input.closest('.row').querySelector('[data-action="view"]').checked=true});
  $$('[data-action="view"]',form).forEach(input=>input.onchange=()=>{if(!input.checked)$$('input',input.closest('.row')).forEach(x=>x.checked=false)});
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;try{const items=$$('.row[data-module]',form).map(row=>({module_key:row.dataset.module,can_view:row.querySelector('[data-action="view"]').checked,can_create:row.querySelector('[data-action="create"]').checked,can_edit:row.querySelector('[data-action="edit"]').checked,can_delete:row.querySelector('[data-action="delete"]').checked}));await api(`/api/app/v26/users/${encodeURIComponent(userId)}/permissions`,{method:'PUT',body:{items}});window.closeModal?.();notify('Permissões salvas. O novo acesso valerá no próximo carregamento do usuário.')}catch(error){notify(error.message,'error')}finally{button.disabled=false}};
  $('#cj206-reset-permissions').onclick=async()=>{if(!confirm('Remover as permissões personalizadas e voltar ao acesso padrão deste perfil?'))return;try{await api(`/api/app/v26/users/${encodeURIComponent(userId)}/permissions`,{method:'DELETE'});window.closeModal?.();notify('O usuário voltou ao acesso padrão.')}catch(error){notify(error.message,'error')}};
 }catch(error){notify(error.message,'error')}finally{window.loading?.(false)}
}
function enhanceUsers(){
 if(!['cooperative_admin','platform_admin'].includes(window.state?.user?.role||'')||window.state?.page!=='users')return;
 $$('[data-cj149-edit-user]').forEach(edit=>{
  const actions=edit.parentElement;if(!actions||actions.querySelector('[data-cj206-permissions]'))return;
  const button=document.createElement('button');button.type='button';button.className='table-action primary';button.dataset.cj206Permissions=edit.dataset.cj149EditUser;button.textContent='Permissões';button.onclick=()=>openPermissions(button.dataset.cj206Permissions);actions.insertBefore(button,edit);
 });
 const panel=$('#page-content .panel');if(panel&&!panel.querySelector('.cj206-users-help'))panel.querySelector('.panel-header')?.insertAdjacentHTML('afterend','<div class="cj206-users-help"><strong>Acessos personalizados</strong><span>Cadastre o atendente ou usuário e use “Permissões” para definir o que ele pode visualizar, criar, editar ou excluir em cada aba.</span></div>');
}
function initials(name){return String(name||'CJ').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}
async function basePhotos(){
 if(!['cooperative_admin','dispatcher'].includes(window.state?.user?.role||'')||window.state?.page!=='bases')return;
 const baseId=String(window.state?.cache?.baseViewId||$('#v31-base-select')?.value||$('#base-view-select')?.value||'');if(!baseId)return;
 try{
  const data=await api(`/api/app/v16/base/live-map?base_id=${encodeURIComponent(baseId)}`),drivers=(data.items||[]).filter(x=>x.photo_url);
  for(const driver of drivers){
   const init=initials(driver.name);
   $$('.v30-driver-marker span,.cj201-photo-icon span,.cj-leaflet-photo').forEach(node=>{
    const current=String(node.textContent||'').trim().toUpperCase();if(current!==init||node.querySelector('img'))return;
    node.innerHTML=`<img src="${esc(driver.photo_url)}" alt="Foto de ${esc(driver.name)}">`;
   });
   $$('[data-v30-driver]').forEach(row=>{if(String(row.dataset.v30Driver)!==String(driver.id)||row.querySelector('.cj206-list-photo'))return;row.insertAdjacentHTML('afterbegin',`<span class="cj206-list-photo"><img src="${esc(driver.photo_url)}" alt=""></span>`)});
  }
 }catch{}
}
function apply(){enhanceUsers();basePhotos()}
function boot(){apply();new MutationObserver(()=>requestAnimationFrame(apply)).observe(document.documentElement,{childList:true,subtree:true});setInterval(()=>{if(!document.hidden)basePhotos()},6000)}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();