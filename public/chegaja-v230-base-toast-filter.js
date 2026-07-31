/* ChegaJá 14.30.7 — remove balões repetidos da Base e balões verdes do cooperado */
(()=>{
'use strict';
if(window.__CJ230_TOAST_FILTER_14307__)return;
window.__CJ230_TOAST_FILTER_14307__=true;

const isDriver=()=>window.state?.user?.role==='driver';
const presenceText=text=>/^\s*Cooperado\s+(online|offline)\b/i.test(String(text||''));
const offerText=text=>/(nova\s+entrega|entrega\s+dispon[ií]vel|nova\s+chamada|entrega\s+recebida)/i.test(String(text||''));

function shouldRemove(node){
  if(!node?.classList?.contains('toast'))return false;
  const text=String(node.textContent||'');
  if(presenceText(text))return true;
  if(!isDriver())return false;
  if(offerText(text))return true;
  return node.classList.contains('success')&&!node.classList.contains('error');
}

function clearFilteredToasts(root=document){
  const nodes=[];
  if(root?.matches?.('.toast'))nodes.push(root);
  if(root?.querySelectorAll)nodes.push(...root.querySelectorAll('.toast'));
  for(const node of nodes)if(shouldRemove(node))node.remove();
}

function patchToast(){
  const original=window.toast;
  if(typeof original!=='function'||original.__cj230Filtered14307)return;
  const filtered=function(message,type='success',...args){
    if(presenceText(message))return;
    if(isDriver()&&(offerText(message)||String(type||'success').toLowerCase()==='success'))return;
    return original.call(this,message,type,...args);
  };
  filtered.__cj230Filtered14307=true;
  filtered.__cj230Original=original;
  window.toast=filtered;
}

function boot(){
  patchToast();
  clearFilteredToasts();
  const host=document.querySelector('#toast-container')||document.body;
  new MutationObserver(records=>{
    patchToast();
    for(const record of records){
      for(const node of record.addedNodes)clearFilteredToasts(node);
    }
  }).observe(host,{childList:true,subtree:true});
  setInterval(()=>{patchToast();clearFilteredToasts()},700);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();
