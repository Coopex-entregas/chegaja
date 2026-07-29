/* ChegaJá 14.19.8 — sincronização segura da autenticação */
(()=>{
'use strict';
if(window.__cj198AuthInstalled)return;
window.__cj198AuthInstalled=true;
const nativeFetch=window.fetch.bind(window);
const sessionToken=()=>String(window.state?.token||localStorage.getItem('lg_token')||sessionStorage.getItem('lg_token')||'').trim();
function syncToken(){
 const current=sessionToken();
 if(!current)return '';
 try{if(localStorage.getItem('lg_token')!==current)localStorage.setItem('lg_token',current)}catch{}
 try{if(window.state&&!window.state.token)window.state.token=current}catch{}
 return current;
}
function internalApi(input){
 try{
  const url=new URL(input instanceof Request?input.url:String(input),location.origin);
  return url.origin===location.origin&&(url.pathname.startsWith('/api/app/')||url.pathname==='/api/auth/me');
 }catch{return false}
}
window.fetch=async function(input,init={}){
 const token=syncToken();
 if(!token||!internalApi(input))return nativeFetch(input,init);
 const original=input instanceof Request?input:null;
 const headers=new Headers(init.headers||original?.headers||{});
 if(!headers.has('Authorization'))headers.set('Authorization',`Bearer ${token}`);
 if(original){
  const request=new Request(original,{...init,headers});
  return nativeFetch(request);
 }
 return nativeFetch(input,{...init,headers});
};
function removeFalseAuthNotice(){
 if(!sessionToken())return;
 document.querySelectorAll('.toast,#cj196-notice,#cj24-notice,.notification-toast,.notice-toast').forEach(node=>{
  if(/não autenticado|nao autenticado/i.test(node.textContent||''))node.remove();
 });
}
function apply(){syncToken();removeFalseAuthNotice()}
window.addEventListener('load',apply,{once:true});
window.addEventListener('pageshow',apply);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
new MutationObserver(removeFalseAuthNotice).observe(document.documentElement,{childList:true,subtree:true});
apply();
})();