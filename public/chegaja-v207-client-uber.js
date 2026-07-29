/* ChegaJá 14.22.2 — fluxo do cliente: serviço, endereços, cotação e rastreio */
(()=>{
'use strict';
if(window.__CJ207_CLIENT_UBER__)return;window.__CJ207_CLIENT_UBER__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const C={observer:null,quoteObserver:null,enhancing:false};
function serviceData(app){return $$('#v32-services label',app).map((label,index)=>{const input=$('input',label),strong=$('strong',label),small=$('small',label);return{index,input,name:strong?.textContent?.trim()||`Serviço ${index+1}`,description:small?.textContent?.trim()||''}})}
function iconFor(name){const text=String(name).toLowerCase();if(/compra/.test(text))return'🛍';if(/cart[oó]rio/.test(text))return'▤';if(/correio/.test(text))return'✉';if(/aeroporto/.test(text))return'✈';if(/retirada|coleta/.test(text))return'➜';if(/document/.test(text))return'▧';return'⚡'}
function homeHtml(app){const services=serviceData(app);return `<section id="cj207-home"><header><img src="/icons/icon-official.png" alt=""><div><small>CHEGAJÁ ENTREGAS</small><strong>O que você precisa?</strong></div><button id="cj207-account" type="button">●</button></header><button id="cj207-where" type="button"><i>⌕</i><span>Informe coleta e entrega</span><b>Agora</b></button><section class="cj207-recent"><small>PEDIDO RÁPIDO</small><button id="cj207-new-order"><i>➜</i><span><strong>Nova entrega</strong><small>Coleta e entrega acompanhadas no mapa</small></span><b>›</b></button></section><section class="cj207-services"><header><h2>Escolha o serviço</h2><span>O valor do serviço será somado à rota.</span></header><div>${services.length?services.map((service,index)=>`<button type="button" data-cj207-service="${index}"><i>${iconFor(service.name)}</i><strong>${esc(service.name)}</strong><small>${esc(service.description)}</small></button>`).join(''):'<button type="button" data-cj207-service=""><i>➜</i><strong>Coleta e entrega</strong><small>Entrega comum</small></button>'}</div></section><section class="cj207-benefit"><div><small>ACOMPANHAMENTO AO VIVO</small><strong>Veja o cooperado no mapa</strong><span>Converse com o cooperado ou com a cooperativa e acompanhe o código de finalização.</span></div><b>⌖</b></section><nav><button class="active"><i>⌂</i><span>Início</span></button><button id="cj207-nav-order"><i>＋</i><span>Pedir</span></button><button id="cj207-nav-active"><i>⌖</i><span>Atividade</span></button><button id="cj207-nav-account"><i>●</i><span>Conta</span></button></nav></section>`}
function selectService(app,index){const services=serviceData(app);services.forEach((service,i)=>{if(service.input)service.input.checked=String(i)===String(index);service.input?.dispatchEvent(new Event('change',{bubbles:true}))});showOrder(app)}
function showOrder(app){app.classList.add('cj207-order-open');$('#cj207-home',app)?.classList.add('hidden');$('.cj203-order-flow',app)?.classList.add('visible');setTimeout(()=>{$('#v32-request-section',app)?.scrollIntoView({block:'start'});$('#v32-client-map',app)?.dispatchEvent(new Event('resize'))},60)}
function showHome(app){app.classList.remove('cj207-order-open');$('#cj207-home',app)?.classList.remove('hidden');$('.cj203-order-flow',app)?.classList.remove('visible');window.scrollTo(0,0)}
function bindHome(app){
 $('#cj207-where',app).onclick=$('#cj207-new-order',app).onclick=$('#cj207-nav-order',app).onclick=()=>showOrder(app);
 $$('[data-cj207-service]',app).forEach(button=>button.onclick=()=>selectService(app,button.dataset.cj207Service));
 $('#cj207-account',app).onclick=$('#cj207-nav-account',app).onclick=()=>$('#v32-profile-section',app)?.scrollIntoView({behavior:'smooth'});
 $('#cj207-nav-active',app).onclick=()=>{const active=$('.v32-active-card:not(.empty)',app);active?active.scrollIntoView({behavior:'smooth'}):showOrder(app)};
}
function addressQuestion(form,prefix){
 const token=form.elements[`${prefix}_confirmation_token`];if(!token)return;
 let block=$(`#cj207-${prefix}-type`,form);if(block)return;
 const anchor=token.closest('.address-search-block')||token.closest('.address-search-field')||token.parentElement;
 block=document.createElement('section');block.id=`cj207-${prefix}-type`;block.className='cj207-place-type';block.innerHTML='<strong>Este endereço é:</strong><div><button type="button" data-place="house">Casa</button><button type="button" data-place="apartment">Apartamento</button><button type="button" data-place="commercial">Comércio</button></div><label class="details hidden"><span>Complemento, apartamento, sala ou torre</span><input type="text" autocomplete="off" placeholder="Ex.: Apto 204, Torre B, Sala 8"></label>';
 anchor?.insertAdjacentElement('afterend',block);
 const details=$('.details',block),custom=$('input',details),apartment=form.elements[`${prefix}_apartment`],complement=form.elements[`${prefix}_complement`];
 $$('[data-place]',block).forEach(button=>button.onclick=()=>{$$('[data-place]',block).forEach(x=>x.classList.toggle('active',x===button));const type=button.dataset.place,needs=type!=='house';details.classList.toggle('hidden',!needs);if(!needs){custom.value='';if(apartment)apartment.value='';if(complement)complement.value=''}else custom.focus()});
 custom.oninput=()=>{if(apartment)apartment.value=custom.value;if(complement)complement.value=custom.value};
}
function decorateOrder(app){
 const flow=$('.cj203-order-flow',app),request=$('#v32-request-section',app),form=$('#v32-order-form',app);if(!flow||!request||!form)return;
 if(!$('#cj207-order-head',request)){request.insertAdjacentHTML('afterbegin','<header id="cj207-order-head"><button type="button">←</button><div><small>NOVO PEDIDO</small><strong>Planeje sua entrega</strong></div></header>');$('#cj207-order-head button',request).onclick=()=>showHome(app)}
 addressQuestion(form,'pickup');addressQuestion(form,'delivery');
 const pickupSearch=form.elements.pickup_search||form.elements.pickup_address_search,deliverySearch=form.elements.delivery_search||form.elements.delivery_address_search;
 if(pickupSearch)pickupSearch.placeholder='Endereço de coleta com número';if(deliverySearch)deliverySearch.placeholder='Para onde será a entrega?';
 const quote=$('.v32-quote-box,#v32-quote-box,#quote-v28',form);if(quote&&!quote.dataset.cj207){quote.dataset.cj207='1';observeQuote(app,quote)}
}
function quoteValue(text){const match=String(text||'').match(/R\$\s*[\d.]+,\d{2}/);return match?.[0]||'Calculando…'}
function observeQuote(app,quote){
 const render=()=>{const text=quote.textContent||'';if(!/R\$/.test(text))return;let card=$('#cj207-moto-choice',app);if(!card){card=document.createElement('section');card.id='cj207-moto-choice';quote.insertAdjacentElement('afterend',card)}card.innerHTML=`<small>OPÇÃO DISPONÍVEL</small><button type="button"><i>🏍</i><span><strong>Moto</strong><em>Cooperado ChegaJá • rastreamento ao vivo</em></span><b>${esc(quoteValue(text))}</b></button><div><span>✓ Valor da rota e serviços incluídos</span><span>✓ Acompanhe pelo mapa</span></div>`};
 render();new MutationObserver(render).observe(quote,{childList:true,subtree:true,characterData:true});
}
function trackingMode(app){const active=$('.v32-active-card:not(.empty)',app);if(!active)return false;app.classList.add('cj207-has-active');const home=$('#cj207-home',app);if(home)home.classList.add('hidden');$('.cj203-order-flow',app)?.classList.remove('visible');if(!$('#cj207-tracking-top',app)){active.insertAdjacentHTML('afterbegin','<header id="cj207-tracking-top"><small>ENTREGA EM ANDAMENTO</small><strong>Acompanhe o cooperado</strong></header>')}return true}
function enhance(){
 if(C.enhancing)return;C.enhancing=true;try{const app=$('.v32-client-app.cj203-uber');if(!app)return;app.classList.add('cj207-app');if(!$('#cj207-home',app)){app.insertAdjacentHTML('afterbegin',homeHtml(app));bindHome(app)}decorateOrder(app);trackingMode(app);if(!app.classList.contains('cj207-has-active')&&!app.dataset.cj207Ready){app.dataset.cj207Ready='1';showHome(app)}}finally{C.enhancing=false}
}
function boot(){enhance();C.observer=new MutationObserver(()=>requestAnimationFrame(enhance));C.observer.observe(document.documentElement,{childList:true,subtree:true})}
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')boot();
})();