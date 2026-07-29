/* ChegaJá 14.19.6 — impede que painéis antigos remontem por cima do cooperado */
(()=>{
'use strict';
function protect(){
 const app=document.getElementById('cj196-driver-app');
 if(!app)return;
 if(!document.getElementById('cj190-driver-app')){
  const sentinel=document.createElement('span');
  sentinel.id='cj190-driver-app';
  sentinel.hidden=true;
  sentinel.setAttribute('aria-hidden','true');
  app.appendChild(sentinel);
 }
 document.querySelectorAll('#cj190-page-menu,#cj194-back,.v31-driver-app').forEach(node=>node.remove());
}
new MutationObserver(()=>requestAnimationFrame(protect)).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('load',protect,{once:true});
if(document.readyState==='complete')protect();
})();