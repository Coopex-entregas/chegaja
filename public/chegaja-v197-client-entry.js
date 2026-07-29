/* ChegaJá 14.19.7 — entrada do cliente vinculada à cooperativa */
(()=>{
'use strict';
const originalOpen=window.chegajaOpenCustomer;
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const html=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const coopFromUrl=()=>String(new URLSearchParams(location.search).get('coop')||localStorage.getItem('chegaja_customer_cooperative')||'').trim();
const safeColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value):'#0D45D8';

function clearCustomerSession(){
 localStorage.removeItem('ligerim_customer_token');
 try{lg.customerToken='';lg.customer=null}catch{}
}
function setBusy(form,on){
 const button=form?.querySelector('button[type="submit"]');
 if(button){button.disabled=on;button.dataset.oldText||=button.textContent;button.textContent=on?'Aguarde…':button.dataset.oldText}
 try{typeof loading==='function'&&loading(on)}catch{}
}
function message(text,type='error'){
 try{if(typeof toast==='function')return toast(text,type)}catch{}
 alert(text);
}
async function loadCooperative(){
 const cooperativeId=coopFromUrl();
 if(!cooperativeId)throw new Error('Abra o link oficial enviado pela cooperativa.');
 localStorage.setItem('chegaja_customer_cooperative',cooperativeId);
 const catalog=await clientApi(`/catalog?cooperative_id=${encodeURIComponent(cooperativeId)}`);
 lg.catalog=catalog;
 const cooperative=(catalog.cooperatives||[]).find(item=>String(item.id)===cooperativeId);
 if(!cooperative)throw new Error('A cooperativa deste link não está disponível.');
 return cooperative;
}
function storeSession(data,cooperative){
 const received=String(data?.customer?.cooperative_id||'');
 if(!data?.token||received!==String(cooperative.id))throw new Error('O acesso retornado não pertence à cooperativa deste link.');
 lg.customerToken=data.token;lg.customer=data.customer;
 localStorage.setItem('ligerim_customer_token',data.token);
 localStorage.setItem('chegaja_customer_cooperative',String(cooperative.id));
}
async function openExistingApp(){
 document.body.classList.remove('cj197-client-entry');
 if(typeof originalOpen==='function')return originalOpen('register');
 throw new Error('O aplicativo do cliente ainda não carregou.');
}

function accessPanel(mode,cooperative){
 const hidden=`<input type="hidden" name="cooperative_id" value="${html(cooperative.id)}">`;
 if(mode==='login')return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${html(cooperative.name)}</small><h2>Entrar na sua conta</h2></div><button type="button" data-entry-close>×</button></header><form id="cj197-login">${hidden}<label>Celular ou e-mail<input name="login" required autocomplete="username" placeholder="Digite seu celular ou e-mail"></label><label>Senha<input name="password" type="password" required autocomplete="current-password" placeholder="Sua senha"></label><button type="submit">Entrar</button><button type="button" class="secondary" data-entry-mode="register">Criar uma conta</button></form></article></section>`;
 if(mode==='guest')return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${html(cooperative.name)}</small><h2>Pedido sem cadastro</h2></div><button type="button" data-entry-close>×</button></header><form id="cj197-guest">${hidden}<label>Nome<input name="name" required autocomplete="name" placeholder="Seu nome"></label><label>Celular<input name="phone" type="tel" required autocomplete="tel" placeholder="(84) 99999-9999"></label><label>E-mail opcional<input name="email" type="email" autocomplete="email" placeholder="seu@email.com"></label><button type="submit">Continuar para o pedido</button><button type="button" class="secondary" data-entry-mode="login">Já tenho uma conta</button></form></article></section>`;
 if(mode==='tracking')return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${html(cooperative.name)}</small><h2>Acompanhar entrega</h2></div><button type="button" data-entry-close>×</button></header><form id="cj197-track"><label>Código ou link de rastreio<input name="tracking" required autocomplete="off" placeholder="Cole o código ou link recebido"></label><button type="submit">Abrir rastreamento</button><button type="button" class="secondary" data-entry-close>Cancelar</button></form></article></section>`;
 if(mode==='choose')return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${html(cooperative.name)}</small><h2>Como deseja continuar?</h2></div><button type="button" data-entry-close>×</button></header><div class="cj197-choose"><button data-entry-mode="register"><b>Criar conta</b><span>Tenha crédito, extrato e histórico.</span></button><button data-entry-mode="login"><b>Já sou cliente</b><span>Entre para pedir e acompanhar.</span></button><button data-entry-mode="guest"><b>Pedido avulso</b><span>Peça agora sem criar senha.</span></button></div></article></section>`;
 return `<section class="cj197-sheet open"><button class="cj197-sheet-backdrop" data-entry-close></button><article><header><div><small>${html(cooperative.name)}</small><h2>Criar sua conta</h2></div><button type="button" data-entry-close>×</button></header><form id="cj197-register">${hidden}<label>Nome<input name="name" required autocomplete="name" placeholder="Seu nome completo"></label><label>Celular<input name="phone" type="tel" required autocomplete="tel" placeholder="(84) 99999-9999"></label><label>E-mail<input name="email" type="email" autocomplete="email" placeholder="seu@email.com"></label><label>Crie uma senha<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Mínimo de 8 caracteres"></label><button type="submit">Cadastrar e entrar</button><button type="button" class="secondary" data-entry-mode="guest">Pedir sem cadastro</button></form></article></section>`;
}

function landing(cooperative,mode='home'){
 const logo=cooperative.logo_url||'/icons/logo-official.png';
 const color=safeColor(cooperative.primary_color);
 return `<main class="cj197-entry" style="--coop:${html(color)}">
  <header class="cj197-top"><div class="cj197-tabs"><button class="active"><span>➜</span>ChegaJá</button><button data-entry-mode="choose"><span>▣</span>Entregas</button></div><div class="cj197-coop"><img src="${html(logo)}" alt=""><span><small>ATENDIMENTO EXCLUSIVO</small><strong>${html(cooperative.name)}</strong></span></div></header>
  <section class="cj197-search"><button data-entry-mode="choose"><i>⌕</i><span>Para onde vai sua entrega?</span><b>Agora</b></button></section>
  <section class="cj197-shortcuts">
   <button data-entry-mode="register"><i>＋</i><strong>Criar conta</strong><small>Crédito e histórico</small></button>
   <button data-entry-mode="login"><i>●</i><strong>Já sou cliente</strong><small>Entrar novamente</small></button>
   <button data-entry-mode="guest"><i>➜</i><strong>Pedido avulso</strong><small>Sem criar senha</small></button>
   <button data-entry-mode="tracking"><i>⌖</i><strong>Rastrear</strong><small>Acompanhar agora</small></button>
  </section>
  <section class="cj197-banner"><div><small>ENTREGA EM TEMPO REAL</small><h1>Acompanhe todo o caminho</h1><p>Veja o cooperado no mapa, o código de finalização e converse durante a entrega.</p><button data-entry-mode="choose">Pedir uma entrega</button></div><div class="cj197-route-art"><span></span><i></i><b></b></div></section>
  <section class="cj197-benefits"><h2>Tudo em um só lugar</h2><div><article><i>◈</i><strong>Crédito pré-pago</strong><span>Compre créditos e acompanhe o saldo.</span></article><article><i>▤</i><strong>Extrato completo</strong><span>Consulte créditos e consumo por pedido.</span></article><article><i>◉</i><strong>Rastreamento</strong><span>Mapa, status e conversa em tempo real.</span></article></div></section>
  <nav class="cj197-bottom"><button class="active"><i>⌂</i><span>Início</span></button><button data-entry-mode="choose"><i>＋</i><span>Pedir</span></button><button data-entry-mode="tracking"><i>⌖</i><span>Rastrear</span></button><button data-entry-mode="login"><i>●</i><span>Conta</span></button></nav>
  ${mode!=='home'?accessPanel(mode,cooperative):''}
 </main>`;
}

function bind(cooperative,mode){
 $$('[data-entry-mode]').forEach(button=>button.onclick=()=>render(cooperative,button.dataset.entryMode));
 $$('[data-entry-close]').forEach(button=>button.onclick=()=>render(cooperative,'home'));
 const register=$('#cj197-register');if(register)register.onsubmit=async event=>{event.preventDefault();setBusy(register,true);try{const data=await clientApi('/register',{method:'POST',body:Object.fromEntries(new FormData(register))});storeSession(data,cooperative);await openExistingApp()}catch(error){message(error.message)}finally{setBusy(register,false)}};
 const login=$('#cj197-login');if(login)login.onsubmit=async event=>{event.preventDefault();setBusy(login,true);try{const data=await clientApi('/login',{method:'POST',body:Object.fromEntries(new FormData(login))});storeSession(data,cooperative);await openExistingApp()}catch(error){message(error.message)}finally{setBusy(login,false)}};
 const guest=$('#cj197-guest');if(guest)guest.onsubmit=async event=>{event.preventDefault();setBusy(guest,true);try{const data=await clientApi('/guest',{method:'POST',body:Object.fromEntries(new FormData(guest))});storeSession(data,cooperative);await openExistingApp()}catch(error){message(error.message)}finally{setBusy(guest,false)}};
 const track=$('#cj197-track');if(track)track.onsubmit=event=>{event.preventDefault();let value=String(new FormData(track).get('tracking')||'').trim();try{const url=new URL(value,location.origin);value=url.pathname.split('/').filter(Boolean).pop()||value}catch{}value=value.replace(/^.*\/r\//,'').replace(/^\/+|\/+$/g,'');if(!value)return message('Informe o código ou link de rastreio.');location.href=`/r/${encodeURIComponent(value)}`};
}
function render(cooperative,mode='home'){
 document.body.classList.add('cj197-client-entry');
 showCustomer();
 $('#customer-content').innerHTML=landing(cooperative,mode);
 bind(cooperative,mode);
 window.scrollTo(0,0);
}

async function open(mode='home'){
 try{
  const cooperative=await loadCooperative();
  if(lg.customerToken){
   try{const me=await clientApi('/me');if(String(me.customer?.cooperative_id)===String(cooperative.id)){lg.customer=me.customer;return openExistingApp()}}catch{}
   clearCustomerSession();
  }
  render(cooperative,['register','login','guest','tracking'].includes(mode)?mode:'home');
 }catch(error){
  document.body.classList.add('cj197-client-entry');showCustomer();
  $('#customer-content').innerHTML=`<main class="cj197-entry-error"><img src="/icons/logo-official.png" alt="ChegaJá"><h1>Link da cooperativa necessário</h1><p>${html(error.message)}</p><button onclick="location.href='/'">Voltar</button></main>`;
 }
}
window.chegajaOpenCustomer=open;
window.ChegaJaClientEntry={open};
function boot(){
 const params=new URLSearchParams(location.search);
 if(location.pathname==='/cliente'||params.has('cliente'))open('home');
 const register=$('#customer-app-link'),guest=$('#customer-guest-link');
 if(register)register.onclick=()=>open('register');if(guest)guest.onclick=()=>open('guest');
}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();