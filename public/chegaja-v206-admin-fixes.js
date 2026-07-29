/* ChegaJá 14.22.3 — permissões e fotos sem ciclo de atualização */
(()=>{
'use strict';
if(window.__CJ206_ADMIN_FIXES__)return;window.__CJ206_ADMIN_FIXES__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const auth=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const R={photos:new Map(),photoByInitials:new Map(),lastPhotoLoad:0,loadingPhotos:false,paintQueued:false,userQueued:false};
async function api(path,opt={}){const response=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(auth()?{Authorization:`Bearer ${auth()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`Erro ${response.status}`);return data}
function notify(text,type='success'){try{window.toast?.(text,type)}catch{alert(text)}}
function initials(name){return String(name||'CJ').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}

function permissionForm(data){
 const user=data.user||{},modules=data.modules||[];
 return `<div class="cj206-permission-head"><div><small>USUÁRIO</small><strong>${esc(user.name||'Acesso')}</strong><span>${esc(user.email||'')}</span></div><label><input id="cj206-all-view" type="checkbox"> Marcar todas para visualizar</label></div><form id="cj206-permissions-form"><div class="cj206-permission-table"><div class="head"><b>Aba</b><b>Ver</b><b>Criar</b><b>Editar</b><b>Excluir</b></div>${modules.map(item=>`<div class="row" data-module="${esc(item.key)}"><strong>${esc(item.label)}</strong><label><input type="checkbox" data-action="view" ${item.can_view?'checked':''}></label><label><input type="checkbox" data-action="create" ${item.can_create?'checked':''}></label><label><input type="checkbox" data-action="edit" ${item.can_edit?'checked':''}></label><label><input type="checkbox" data-action="delete" ${item.can_delete?'checked':''}></label></div>`).join('')}</div><div class="cj206-permission-note">Para somente consultar uma aba, marque apenas <b>Ver</b>.</div><div class="form-actions"><button type="button" class="btn" id="cj206-reset-permissions">Usar acesso padrão</button><button class="btn primary" type="submit">Salvar permissões</button></div></form>`
}
async function openPermissions(userId){
 try{
  window.loading?.(true);const data=await api(`/api/app/v26/users/${encodeURIComponent(userId)}/permissions`);
  if(data.user?.permissions_locked)throw new Error('Este perfil utiliza permissões fixas do sistema.');
  window.openModal?.('Permissões do usuário',permissionForm(data));
  const form=$('#cj206-permissions-form'),all=$('#cj206-all-view');
  all.onchange=()=>{$$('[data-action="view"]',form).forEach(input=>{input.checked=all.checked;if(!all.checked)$$('input',input.closest('.row')).forEach(x=>x.checked=false)})};
  $$('[data-action]:not([data-action="view"])',form).forEach(input=>input.onchange=()=>{if(input.checked)input.closest('.row').querySelector('[data-action="view"]').checked=true});
  $$('[data-action="view"]',form).forEach(input=>input.onchange=()=>{if(!input.checked)$$('input',input.closest('.row')).forEach(x=>x.checked=false)});
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;try{const items=$$('.row[data-module]',form).map(row=>({module_key:row.dataset.module,can_view:row.querySelector('[data-action="view"]').checked,can_create:row.querySelector('[data-action="create"]').checked,can_edit:row.querySelector('[data-action="edit"]').checked,can_delete:row.querySelector('[data-action="delete"]').checked}));await api(`/api/app/v26/users/${encodeURIComponent(userId)}/permissions`,{method:'PUT',body:{items}});window.closeModal?.();notify('Permissões salvas.')}catch(error){notify(error.message,'error')}finally{button.disabled=false}};
  $('#cj206-reset-permissions').onclick=async()=>{if(!confirm('Voltar ao acesso padrão deste perfil?'))return;try{await api(`/api/app/v26/users/${encodeURIComponent(userId)}/permissions`,{method:'DELETE'});window.closeModal?.();notify('Acesso padrão restaurado.')}catch(error){notify(error.message,'error')}};
 }catch(error){notify(error.message,'error')}finally{window.loading?.(false)}
}
function enhanceUsers(){
 if(!['cooperative_admin','platform_admin'].includes(window.state?.user?.role||'')||window.state?.page!=='users')return;
 $$('[data-cj149-edit-user]').forEach(edit=>{const actions=edit.parentElement;if(!actions||actions.querySelector('[data-cj206-permissions]'))return;const button=document.createElement('button');button.type='button';button.className='table-action primary';button.dataset.cj206Permissions=edit.dataset.cj149EditUser;button.textContent='Permissões';button.onclick=()=>openPermissions(button.dataset.cj206Permissions);actions.insertBefore(button,edit)});
 const panel=$('#page-content .panel');if(panel&&!panel.querySelector('.cj206-users-help'))panel.querySelector('.panel-header')?.insertAdjacentHTML('afterend','<div class="cj206-users-help"><strong>Acessos personalizados</strong><span>Defina o que cada atendente pode ver, cadastrar, editar ou excluir.</span></div>')
}
function queueUsers(){if(R.userQueued)return;R.userQueued=true;setTimeout(()=>{R.userQueued=false;enhanceUsers()},120)}

async function loadPhotoCache(force=false){
 if(!['cooperative_admin','dispatcher'].includes(window.state?.user?.role||'')||window.state?.page!=='bases')return;
 if(R.loadingPhotos||(!force&&Date.now()-R.lastPhotoLoad<12000))return;
 R.loadingPhotos=true;
 try{
  const data=await api('/api/app/drivers');R.photos.clear();R.photoByInitials.clear();
  for(const driver of data.items||[]){if(!driver.photo_url)continue;R.photos.set(String(driver.id),{url:driver.photo_url,name:driver.name||'Cooperado'});const key=initials(driver.name);if(!R.photoByInitials.has(key))R.photoByInitials.set(key,[]);R.photoByInitials.get(key).push({id:String(driver.id),url:driver.photo_url,name:driver.name||'Cooperado'})}
  R.lastPhotoLoad=Date.now();paintPhotos();
 }catch{}finally{R.loadingPhotos=false}
}
function paintPhotos(){
 if(window.state?.page!=='bases'||!R.photos.size)return;
 $$('[data-v30-driver]').forEach(row=>{const photo=R.photos.get(String(row.dataset.v30Driver));if(!photo)return;let avatar=$('.cj206-list-photo',row);if(!avatar){avatar=document.createElement('span');avatar.className='cj206-list-photo';row.insertAdjacentElement('afterbegin',avatar)}if(!avatar.querySelector('img'))avatar.innerHTML=`<img src="${esc(photo.url)}" alt="Foto de ${esc(photo.name)}">`});
 $$('.v30-driver-marker span').forEach(node=>{if(node.querySelector('img'))return;const candidates=R.photoByInitials.get(String(node.textContent||'').trim().toUpperCase())||[];if(candidates.length===1)node.innerHTML=`<img src="${esc(candidates[0].url)}" alt="Foto de ${esc(candidates[0].name)}">`})
}
function queuePaint(){if(R.paintQueued)return;R.paintQueued=true;requestAnimationFrame(()=>{R.paintQueued=false;paintPhotos();queueUsers()})}
function boot(){
 enhanceUsers();loadPhotoCache(true);
 new MutationObserver(queuePaint).observe(document.documentElement,{childList:true,subtree:true});
 setInterval(()=>{if(document.hidden)return;if(window.state?.page==='bases')loadPhotoCache();else if(window.state?.page==='users')enhanceUsers()},12000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadPhotoCache(true);enhanceUsers()}})
}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();