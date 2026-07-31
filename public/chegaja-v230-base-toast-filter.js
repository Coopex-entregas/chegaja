/* ChegaJá 14.30.6 — remove balões repetidos de presença na Base */
(()=>{
'use strict';
if(window.__CJ230_BASE_TOAST_FILTER__)return;
window.__CJ230_BASE_TOAST_FILTER__=true;

const blocked=text=>/^\s*Cooperado\s+(online|offline)\b/i.test(String(text||''));

function clearPresenceToasts(root=document){
  const nodes=[];
  if(root?.matches?.('.toast'))nodes.push(root);
  if(root?.querySelectorAll)nodes.push(...root.querySelectorAll('.toast'));
  for(const node of nodes){
    if(blocked(node.textContent))node.remove();
  }
}

function patchToast(){
  const original=window.toast;
  if(typeof original!=='function'||original.__cj230Filtered)return;
  const filtered=function(message,...args){
    if(blocked(message))return;
    return original.call(this,message,...args);
  };
  filtered.__cj230Filtered=true;
  filtered.__cj230Original=original;
  window.toast=filtered;
}

function boot(){
  patchToast();
  clearPresenceToasts();
  const host=document.querySelector('#toast-container')||document.body;
  new MutationObserver(records=>{
    patchToast();
    for(const record of records){
      for(const node of record.addedNodes)clearPresenceToasts(node);
    }
  }).observe(host,{childList:true,subtree:true});
  setInterval(()=>{patchToast();clearPresenceToasts()},1000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();
