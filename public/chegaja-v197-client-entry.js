/* ChegaJá 14.20.1 — entrada simples: avulso direto ou conta */
(()=>{
'use strict';
const previousOpen=window.chegajaOpenCustomer;
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const cooperativeId=()=>String(new URLSearchParams(location.search).get('coop')||localStorage.getItem('chegaja_customer_cooperative')||'').trim();

function clearCustomerSession(){
 localStorage.removeItem('ligerim_customer_token');
 sessionStorage.removeItem('chegaja_guest_mode');
 try{lg.customerToken='';lg.customer=null}catch{}
}
function setBusy(form,on){
 const button=form?.querySelector('button[type="submit"]');
 if(button){button.disabled=on;button.dataset.label||=button.textContent;button.textContent=on?'Aguarde…':button.dataset.label}
 try{typeof loading==='function'&&loading(on)}catch{}
}
function message(text,type='error'){
 try{if(typeof toast==='function')return toast(text,type)}catch{}
 alert(text);
}
async function loadCooperative(){
 const id=cooperativeId();
 if(!id)throw new Error('Abra o link oficial enviado pela cooperativa.');
 localStorage.setItem('chegaja_customer_cooperative',id);
 const catalog=await clientApi(`/catalog?cooperative_id=${encodeURIComponent(id)}`);
 lg.catalog=catalog;
 const cooperative=(catalog.cooperatives||[]).find(item=>String(item.id)===id);
 if(!cooperative)throw new Error('A cooperativa deste link não está disponível.');
 return cooperative;
}
function storeSession(data,cooperative){
 const received=String(data?.customer?.cooperative_id||'');
 if(!data?.token||received!==String(cooperative.id))throw new Error('O acesso retornado não pertence à cooperativa deste link.');
 lg.customerToken=data.token;
 lg.customer=data.customer;
 localStorage.setItem('ligerim_customer_token',data.token);
 localStorage.setItem('chegaja_customer_cooperative',String(cooperative.id));
}
function applyCustomerMode(forceGuest=null){
 const guest=forceGuest===null?Boolean(lg.customer?.guest):Boolean(forceGuest);
 document.body.classList.toggle('cj201-guest-customer',guest);
 sessionStorage.setItem('chegaja_guest_mode',guest?'1':'0');
 if(!guest)return;
 const apply=()=>{
  document.body.classList.add('cj201-guest-customer');
  ['#v32-credit-section','#v32-history-section','.v32-map-wallet'].forEach(selector=>$$(selector).forEach(node=>node.remove()));
  $$('.v32-client-bottom a[href="#v32-credit-section"],.v32-client-bottom a[href="#v32-history-section"]').forEach(node=>node.remove());
  $('.v32-client-bottom')?.classList.add('guest-only');
  const active=$('.v32-active-card:not(.empty)');
  if(!active)setTimeout(()=>$('#v32-request-section')?.scrollIntoView({block:'start'}),80);
 };
 requestAnimationFrame(apply);
 setTimeout(apply,180);
}
async function openExistingApp(kind='account'){
 document.body.classList.remove('cj197-client-entry');
 if(typeof previousOpen!=='function')throw new Error('O aplicativo do cliente ainda não carregou.');
 await previousOpen(kind==='guest'?'guest':'login');
 applyCustomerMode(kind==='guest'||Boolean(lg.customer?.guest));
}
function guestPanel(cooperative){
 return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${esc(cooperative.name)}</small><h2>Pedir sem cadastro</h2><p>Informe somente os dados necessários para a entrega.</p></div><button type="button" data-entry-close>×</button></header><form id="cj197-guest"><input type="hidden" name="cooperative_id" value="${esc(cooperative.id)}"><label>Nome<input name="name" required autocomplete="name" placeholder="Seu nome"></label><label>Celular<input name="phone" type="tel" required autocomplete="tel" placeholder="(84) 99999-9999"></label><label>E-mail opcional<input name="email" type="email" autocomplete="email" placeholder="seu@email.com"></label><button type="submit">Continuar para o pedido</button></form></article></section>`;
}
function accountChoicePanel(cooperative){
 return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${esc(cooperative.name)}</small><h2>Acessar sua conta</h2><p>Entre ou crie um cadastro para usar crédito, extrato e histórico.</p></div><button type="button" data-entry-close>×</button></header><div class="cj197-account-choice"><button data-entry-mode="login"><b>Já tenho conta</b><span>Entrar com celular ou e-mail.</span></button><button data-entry-mode="register"><b>Realizar cadastro</b><span>Criar conta vinculada a esta cooperativa.</span></button></div></article></section>`;
}
function loginPanel(cooperative){
 return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${esc(cooperative.name)}</small><h2>Entrar na sua conta</h2></div><button type="button" data-entry-mode="account">←</button></header><form id="cj197-login"><input type="hidden" name="cooperative_id" value="${esc(cooperative.id)}"><label>Celular ou e-mail<input name="login" required autocomplete="username" placeholder="Digite seu celular ou e-mail"></label><label>Senha<input name="password" type="password" required autocomplete="current-password" placeholder="Sua senha"></label><button type="submit">Entrar</button></form></article></section>`;
}
function registerPanel(cooperative){
 return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${esc(cooperative.name)}</small><h2>Realizar cadastro</h2></div><button type="button" data-entry-mode="account">←</button></header><form id="cj197-register"><input type="hidden" name="cooperative_id" value="${esc(cooperative.id)}"><label>Nome completo<input name="name" required autocomplete="name"></label><label>Celular<input name="phone" type="tel" required autocomplete="tel" placeholder="(84) 99999-9999"></label><label>E-mail<input name="email" type="email" autocomplete="email" placeholder="seu@email.com"></label><label>Crie uma senha<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Mínimo de 8 caracteres"></label><button type="submit">Cadastrar e entrar</button></form></article></section>`;
}
function trackingPanel(cooperative){
 return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${esc(cooperative.name)}</small><h2>Acompanhar entrega</h2></div><button type="button" data-entry-close>×</button></header><form id="cj197-track"><label>Código ou link de rastreio<input name="tracking" required autocomplete="off" placeholder="Cole o código ou link recebido"></label><button type="submit">Abrir rastreamento</button></form></article></section>`;
}
function panel(mode,cooperative){
 if(mode==='guest')return guestPanel(cooperative);
 if(mode==='account')return accountChoicePanel(cooperative);
 if(mode==='login')return loginPanel(cooperative);
 if(mode==='register')return registerPanel(cooperative);
 if(mode==='tracking')return trackingPanel(cooperative);
 return '';
}
function landing(cooperative,mode='home'){
 const logo=cooperative.logo_url||'/icons/logo-official.png';
 return `<main class="cj197-entry">
  <header class="cj197-top"><div class="cj197-coop"><img src="${esc(logo)}" alt=""><span><small>LINK OFICIAL</small><strong>${esc(cooperative.name)}</strong></span></div></header>
  <section class="cj197-hero"><small>CHEGAJÁ ENTREGAS</small><h1>Como deseja pedir?</h1><p>O pedido ficará vinculado somente a ${esc(cooperative.name)}.</p></section>
  <section class="cj197-main-actions">
   <button class="guest" data-entry-mode="guest"><i>➜</i><span><strong>Pedir avulso</strong><small>Sem login e sem criar senha</small></span></button>
   <button class="account" data-entry-mode="account"><i>●</i><span><strong>Entrar ou criar conta</strong><small>Crédito, extrato e histórico</small></span></button>
  </section>
  <section class="cj197-flow"><article><b>1</b><span><strong>Informe coleta e entrega</strong><small>Busca de endereço enquanto digita.</small></span></article><article><b>2</b><span><strong>Veja o valor antes de confirmar</strong><small>Rota mais serviços selecionados.</small></span></article><article><b>3</b><span><strong>Acompanhe no mapa</strong><small>Cooperado, chat e código de finalização.</small></span></article></section>
  <button class="cj197-track-link" data-entry-mode="tracking">Já tenho um código de rastreio</button>
  ${mode!=='home'?panel(mode,cooperative):''}
 </main>`;
}
function render(cooperative,mode='home'){
 document.body.classList.add('cj197-client-entry');
 document.body.classList.remove('cj201-guest-customer');
 showCustomer();
 $('#customer-content').innerHTML=landing(cooperative,mode);
 bind(cooperative);
 window.scrollTo(0,0);
}
function bind(cooperative){
 $$('[data-entry-mode]').forEach(button=>button.onclick=()=>render(cooperative,button.dataset.entryMode));
 $$('[data-entry-close]').forEach(button=>button.onclick=()=>render(cooperative,'home'));
 const guest=$('#cj197-guest');
 if(guest)guest.onsubmit=async event=>{event.preventDefault();setBusy(guest,true);try{const data=await clientApi('/guest',{method:'POST',body:Object.fromEntries(new FormData(guest))});storeSession(data,cooperative);await openExistingApp('guest')}catch(error){message(error.message)}finally{setBusy(guest,false)}};
 const login=$('#cj197-login');
 if(login)login.onsubmit=async event=>{event.preventDefault();setBusy(login,true);try{const data=await clientApi('/login',{method:'POST',body:Object.fromEntries(new FormData(login))});storeSession(data,cooperative);await openExistingApp('account')}catch(error){message(error.message)}finally{setBusy(login,false)}};
 const register=$('#cj197-register');
 if(register)register.onsubmit=async event=>{event.preventDefault();setBusy(register,true);try{const data=await clientApi('/register',{method:'POST',body:Object.fromEntries(new FormData(register))});storeSession(data,cooperative);await openExistingApp('account')}catch(error){message(error.message)}finally{setBusy(register,false)}};
 const track=$('#cj197-track');
 if(track)track.onsubmit=event=>{event.preventDefault();let value=String(new FormData(track).get('tracking')||'').trim();try{const url=new URL(value,location.origin);value=url.pathname.split('/').filter(Boolean).pop()||value}catch{}value=value.replace(/^.*\/r\//,'').replace(/^\/+|\/+$/g,'');if(!value)return message('Informe o código ou link de rastreio.');location.href=`/r/${encodeURIComponent(value)}`};
}
async function open(mode='home'){
 try{
  const cooperative=await loadCooperative();
  if(lg.customerToken){
   try{
    const me=await clientApi('/me');
    if(String(me.customer?.cooperative_id)===String(cooperative.id)){
     lg.customer=me.customer;
     return openExistingApp(me.customer?.guest?'guest':'account');
    }
   }catch{}
   clearCustomerSession();
  }
  render(cooperative,['guest','account','login','register','tracking'].includes(mode)?mode:'home');
 }catch(error){
  document.body.classList.add('cj197-client-entry');showCustomer();
  $('#customer-content').innerHTML=`<main class="cj197-entry-error"><img src="/icons/logo-official.png" alt="ChegaJá"><h1>Link da cooperativa necessário</h1><p>${esc(error.message)}</p><button onclick="location.href='/'">Voltar</button></main>`;
 }
}
window.chegajaOpenCustomer=open;
window.ChegaJaClientEntry={open};
new MutationObserver(()=>{if(sessionStorage.getItem('chegaja_guest_mode')==='1')applyCustomerMode(true)}).observe(document.documentElement,{childList:true,subtree:true});
function boot(){
 const params=new URLSearchParams(location.search);
 if(location.pathname==='/cliente'||params.has('cliente'))open('home');
 const register=$('#customer-app-link'),guest=$('#customer-guest-link');
 if(register)register.onclick=()=>open('account');
 if(guest)guest.onclick=()=>open('guest');
}
window.addEventListener('load',boot,{once:true});
if(document.readyState==='complete')boot();
})();