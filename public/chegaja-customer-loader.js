/* Carrega o módulo do cliente somente na área do cliente. */
(()=>{
'use strict';
const params=new URLSearchParams(location.search);
const isCustomer=location.pathname==='/cliente'||params.has('cliente');
let promise=null;
function loadCustomer(){
  if(window.chegajaOpenCustomer)return Promise.resolve();
  if(promise)return promise;
  promise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/chegaja-realtime-v2.js?v=14.17.0-customer-only';
    script.defer=true;
    script.onload=resolve;
    script.onerror=()=>reject(new Error('Não foi possível abrir o aplicativo do cliente.'));
    document.head.appendChild(script);
  });
  return promise;
}
function customerUrl(mode){
  const url=new URL('/cliente',location.origin);
  url.searchParams.set('cliente','1');
  url.searchParams.set('mode',mode);
  const coop=params.get('coop')||params.get('cooperative_id')||localStorage.getItem('cj_customer_coop');
  if(coop)url.searchParams.set('coop',coop);
  return url.toString();
}
document.addEventListener('click',event=>{
  const register=event.target.closest('#customer-app-link');
  const guest=event.target.closest('#customer-guest-link');
  if(!register&&!guest)return;
  event.preventDefault();
  location.href=customerUrl(guest?'guest':'register');
},true);
if(isCustomer){
  loadCustomer().then(()=>window.chegajaOpenCustomer?.(params.get('mode')||'hub')).catch(error=>{
    const host=document.getElementById('customer-content');
    if(host)host.innerHTML=`<div class="notice error">${String(error.message||error)}</div>`;
  });
}
})();
