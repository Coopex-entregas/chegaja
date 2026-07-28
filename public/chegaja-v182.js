/* ChegaJá 14.18.2 — navegação final do cooperado */
(()=>{
'use strict';
const $=s=>document.querySelector(s);
function openProfileMenu(){
  const drawer=$('#cj143-driver-drawer')||$('#v32-driver-drawer');
  if(drawer){drawer.classList.add('open');return}
  const sidebar=$('#sidebar');
  if(sidebar){sidebar.classList.add('open');return}
  if(typeof navigate==='function')navigate('profile');
}
function rebuildNav(){
  if(typeof state==='undefined'||state?.user?.role!=='driver')return;
  let nav=$('#cj180-driver-nav');
  if(!nav)return;
  const signature='dashboard,deliveries,schedules,financial,profile-menu';
  if(nav.dataset.signature===signature)return;
  nav.dataset.signature=signature;
  nav.innerHTML=`
    <button data-go="dashboard"><i>⌂</i><span>Início</span></button>
    <button data-go="deliveries"><i>▣</i><span>Entregas</span></button>
    <button data-go="schedules"><i>▦</i><span>Escala</span></button>
    <button data-go="financial"><i>R$</i><span>Ganhos</span></button>
    <button data-profile-menu><i>☰</i><span>Perfil</span></button>`;
  nav.querySelectorAll('[data-go]').forEach(button=>button.onclick=()=>typeof navigate==='function'&&navigate(button.dataset.go));
  nav.querySelector('[data-profile-menu]').onclick=openProfileMenu;
}
function centerOnline(){
  if(typeof state==='undefined'||state?.user?.role!=='driver')return;
  const header=$('.v31-driver-header'),online=$('#v31-driver-online');
  if(!header||!online)return;
  header.classList.add('cj182-header');
  online.classList.add('cj182-online-center');
  const topMenu=$('#v31-driver-menu');
  if(topMenu)topMenu.classList.add('cj182-hidden-menu');
}
function mapGuard(){
  for(const host of document.querySelectorAll('#v31-driver-map,#v31-base-map,#cj14-est-map,#cj180-client-google-map')){
    if(host.dataset.cj182Guard==='1')continue;
    const rect=host.getBoundingClientRect();
    if(rect.width<40||rect.height<40)continue;
    host.dataset.cj182Guard='1';
    setTimeout(()=>{
      if(!host.isConnected||host.querySelector('.gm-style,.cj149-map-error'))return;
      host.innerHTML='<div class="cj182-map-message"><strong>Google Maps não carregou</strong><span>Verifique a chave do Google Maps, o faturamento e se este domínio está autorizado no Google Cloud.</span></div>';
    },5000);
  }
}
function apply(){rebuildNav();centerOnline();mapGuard()}
const observer=new MutationObserver(()=>requestAnimationFrame(apply));
observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('load',apply);
setInterval(()=>{if(!document.hidden)apply()},2500);
})();
