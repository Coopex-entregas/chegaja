from pathlib import Path
import re

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def must_replace(text, old, new, name):
    if old not in text:
        raise RuntimeError(f'Não encontrei bloco esperado: {name}')
    return text.replace(old,new,1)

jsp=Path('public/chegaja-v217-driver-navigation.js')
js=read(jsp)
if 'ChegaJá 14.33.18' not in js:
    js=must_replace(js,
        '/* ChegaJá 14.33.17 — painel único, oferta em tela cheia, SOS e rastreamento contínuo */',
        '/* ChegaJá 14.33.18 — painel único, oferta full-screen real, toque persistente e GPS contínuo */',
        'versão JS')
    js=js.replace('__CJ_DRIVER_LEAFLET_143317__','__CJ_DRIVER_LEAFLET_143318__',1)
    js=must_replace(js,
        '<main id="cj199-app" aria-label="Painel do cooperado"><div id="cj199-map" aria-label="Mapa OpenStreetMap do cooperado"></div>',
        '<main id="cj199-app" aria-label="Painel do cooperado"><div id="cj199-map" aria-label="Mapa OpenStreetMap do cooperado"></div><section id="cj217-offer-screen" aria-live="assertive" aria-label="Nova entrega" hidden></section>',
        'host da oferta')
    anchor="function openSheet(){const s=$('#cj199-sheet');if(!s)return;s.hidden=false;s.classList.add('open');$('#cj199-up').textContent='⌄';setTimeout(preserveResize,220)}"
    offer_fn=r'''function renderOfferScreen(){const host=$('#cj217-offer-screen');if(!host)return;const x=A.detail,offer=offerRequired(x);if(!offer){host.hidden=true;host.innerHTML='';return}const routeMeters=Math.max(0,Number(x.distance_meters||0)),pickupMeters=Math.max(0,Number(x.distance_to_pickup_meters||x.displacement_distance_meters||0)),totalMeters=Math.max(routeMeters+pickupMeters,Number(x.total_distance_meters||0)),minutes=Math.max(1,Math.round(Number(x.duration_seconds||0)/60)),services=Array.isArray(x.services)?x.services:[],customer=String(x.recipient_name||x.customer_name||'').trim(),establishment=String(x.establishment_name||x.base_name||x.location_name||'').trim();host.hidden=false;host.innerHTML=`<div class="cj217-offer-wrap"><header class="cj217-offer-top"><div><small>NOVA ENTREGA</small><strong>${esc(x.display_code||'Entrega')}</strong></div><span>AGUARDANDO SUA DECISÃO</span></header><div class="cj217-offer-scroll"><section class="cj217-offer-highlight"><small>VOCÊ RECEBE</small><strong>${money(x.driver_net_cents??x.driver_earnings_cents??x.charge_cents??0)}</strong>${establishment?`<span>${esc(establishment)}</span>`:''}</section><section class="cj217-offer-route"><article><i class="pickup">C</i><div><small>COLETA</small><strong>${esc(x.pickup_address||'Endereço não informado')}</strong>${x.pickup_complement?`<span>${esc(x.pickup_complement)}</span>`:''}</div></article><div class="cj217-offer-line"></div><article><i class="delivery">E</i><div><small>ENTREGA</small><strong>${esc(x.delivery_address||'Endereço não informado')}</strong>${x.delivery_complement?`<span>${esc(x.delivery_complement)}</span>`:''}${customer?`<span>Recebedor: ${esc(customer)}</span>`:''}</div></article></section><section class="cj217-offer-stats"><div><small>ATÉ A COLETA</small><strong>${pickupMeters>=1000?`${(pickupMeters/1000).toFixed(1).replace('.',',')} km`:`${Math.round(pickupMeters)} m`}</strong></div><div><small>ROTA</small><strong>${routeMeters>=1000?`${(routeMeters/1000).toFixed(1).replace('.',',')} km`:`${Math.round(routeMeters)} m`}</strong></div><div><small>TOTAL</small><strong>${totalMeters>=1000?`${(totalMeters/1000).toFixed(1).replace('.',',')} km`:`${Math.round(totalMeters)} m`}</strong></div><div><small>TEMPO</small><strong>${minutes} min</strong></div><div><small>PAGAMENTO</small><strong>${esc(String(x.payment_method||'—').toUpperCase())}</strong></div></section>${services.length?`<section class="cj217-offer-info"><small>SERVIÇOS</small><div>${services.map(s=>`<span>${esc(s.service_name||s.name||'Serviço')}${Number(s.add_cents||0)>0?` • ${money(s.add_cents)}`:''}</span>`).join('')}</div></section>`:''}${x.notes?`<section class="cj217-offer-notes"><small>OBSERVAÇÕES</small><p>${esc(x.notes)}</p></section>`:''}</div><footer class="cj217-offer-actions"><button id="cj217-offer-decline" type="button">RECUSAR</button><button id="cj217-offer-accept" type="button">ACEITAR ENTREGA</button></footer></div>`;$('#cj217-offer-accept',host)?.addEventListener('click',()=>performAction('accept'));$('#cj217-offer-decline',host)?.addEventListener('click',decline)}
'''
    js=must_replace(js,anchor,offer_fn+anchor,'render oferta full screen')
    js=must_replace(js,
        "function renderSheet(force=false){const h=$('#cj199-schedules');if(!h)return;if(!A.detail){renderSchedules();return}",
        "function renderSheet(force=false){const h=$('#cj199-schedules');if(!h)return;if(!A.detail){renderSchedules();return}if(offerRequired(A.detail)){A.sheetKey='';closeSheet();return}",
        'oferta fora do sheet')
    js=must_replace(js,
        "applyMetric();renderSheet();window.ChegaJaDriverActiveDelivery=A.detail||null}",
        "applyMetric();renderOfferScreen();renderSheet();window.ChegaJaDriverActiveDelivery=A.detail||null}",
        'render oferta nos controles')
    start=js.find('function unlockAudio()')
    end=js.find('function freshPosition()',start)
    if start<0 or end<0: raise RuntimeError('Bloco de áudio não encontrado')
    audio=r'''function unlockAudio(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;A.audio=A.audio||new C();const c=A.audio;c.resume?.().catch?.(()=>{});if(!c.__cjPrimed){try{const o=c.createOscillator(),g=c.createGain();g.gain.value=.00001;o.frequency.value=440;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.025);c.__cjPrimed=true}catch{}}return c}catch{return null}}
function phoneTone(c,at=0,duration=.9){try{const start=c.currentTime+at,master=c.createGain();master.gain.setValueAtTime(.0001,start);master.gain.exponentialRampToValueAtTime(.68,start+.02);master.gain.setValueAtTime(.68,start+duration-.08);master.gain.exponentialRampToValueAtTime(.0001,start+duration);master.connect(c.destination);for(const freq of[440,480]){const o=c.createOscillator();o.type='sine';o.frequency.setValueAtTime(freq,start);o.connect(master);o.start(start);o.stop(start+duration+.04)}}catch{}}
async function ring(){navigator.vibrate?.([900,180,900,500]);const c=unlockAudio();if(!c)return;try{if(c.state!=='running')await c.resume()}catch{}if(c.state!=='running')return;phoneTone(c,0,.9);phoneTone(c,1.12,.9)}
function stopOfferAlert(){clearInterval(A.offerAlertTimer);A.offerAlertTimer=null;A.offerAlertCount=0;navigator.vibrate?.(0);const host=$('#cj217-offer-screen');if(host&&!offerRequired(A.detail)){host.hidden=true;host.innerHTML=''}}
function notifyOffer(x){const id=String(x?.id||'');if(!id)return;renderOfferScreen();if(id===A.lastOfferId&&A.offerAlertTimer)return;stopOfferAlert();A.lastOfferId=id;const fire=()=>{if(!offerRequired(A.detail)||String(A.detail?.id)!==id){stopOfferAlert();return}renderOfferScreen();A.offerAlertCount+=1;ring()};fire();A.offerAlertTimer=setInterval(fire,3000)}
'''
    js=js[:start]+audio+js[end:]
    write(jsp,js)

cssp=Path('public/chegaja-v217-driver-navigation.css')
css=read(cssp)
if 'ChegaJá 14.33.18 — oferta full-screen real' not in css:
    css += r'''

/* ChegaJá 14.33.18 — oferta full-screen real */
#cj217-offer-screen[hidden]{display:none!important}
#cj217-offer-screen{position:fixed!important;inset:0!important;z-index:2147483000!important;width:100vw!important;height:100dvh!important;background:#f5f6f8!important;color:#111827!important;overflow:hidden!important;pointer-events:auto!important;font-family:inherit!important}
.cj217-offer-wrap{height:100%!important;display:flex!important;flex-direction:column!important;background:#f5f6f8!important}
.cj217-offer-top{flex:0 0 auto!important;padding:max(18px,env(safe-area-inset-top)) 20px 18px!important;background:#111!important;color:#fff!important;display:flex!important;align-items:flex-end!important;justify-content:space-between!important;gap:12px!important;box-sizing:border-box!important}
.cj217-offer-top div{display:grid!important;gap:3px!important}.cj217-offer-top small{font-size:12px!important;font-weight:900!important;letter-spacing:.12em!important;color:#b7f7c7!important}.cj217-offer-top strong{font-size:26px!important;line-height:1.05!important;color:#fff!important}.cj217-offer-top>span{max-width:44%!important;text-align:right!important;font-size:10px!important;font-weight:900!important;letter-spacing:.05em!important;color:#d1d5db!important}
.cj217-offer-scroll{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;padding:14px 14px 22px!important;display:grid!important;align-content:start!important;gap:12px!important;box-sizing:border-box!important;-webkit-overflow-scrolling:touch!important}
.cj217-offer-highlight{background:#fff!important;border-radius:18px!important;padding:18px!important;box-shadow:0 3px 16px #11182712!important;display:grid!important;gap:3px!important}.cj217-offer-highlight small{font-size:11px!important;font-weight:900!important;color:#6b7280!important;letter-spacing:.08em!important}.cj217-offer-highlight strong{font-size:34px!important;line-height:1!important;color:#111!important}.cj217-offer-highlight span{font-size:13px!important;font-weight:800!important;color:#4b5563!important;margin-top:5px!important}
.cj217-offer-route{background:#fff!important;border-radius:18px!important;padding:18px!important;box-shadow:0 3px 16px #11182712!important}.cj217-offer-route article{display:grid!important;grid-template-columns:38px 1fr!important;gap:12px!important;align-items:start!important}.cj217-offer-route article i{width:34px!important;height:34px!important;border-radius:50%!important;display:grid!important;place-items:center!important;font-style:normal!important;color:#fff!important;font-size:12px!important;font-weight:950!important}.cj217-offer-route article i.pickup{background:#1459ff!important}.cj217-offer-route article i.delivery{background:#111!important}.cj217-offer-route article div{display:grid!important;gap:3px!important}.cj217-offer-route article small{font-size:10px!important;font-weight:900!important;color:#6b7280!important;letter-spacing:.09em!important}.cj217-offer-route article strong{font-size:15px!important;line-height:1.3!important;color:#111827!important}.cj217-offer-route article span{font-size:12px!important;color:#6b7280!important}.cj217-offer-line{height:20px!important;border-left:3px dotted #cbd5e1!important;margin:2px 0 2px 16px!important}
.cj217-offer-stats{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important}.cj217-offer-stats>div{background:#fff!important;border-radius:15px!important;padding:13px!important;box-shadow:0 2px 10px #1118270d!important;display:grid!important;gap:4px!important}.cj217-offer-stats small{font-size:9px!important;font-weight:900!important;color:#6b7280!important;letter-spacing:.06em!important}.cj217-offer-stats strong{font-size:16px!important;color:#111827!important;overflow-wrap:anywhere!important}
.cj217-offer-info,.cj217-offer-notes{background:#fff!important;border-radius:16px!important;padding:15px!important;box-shadow:0 2px 10px #1118270d!important}.cj217-offer-info>small,.cj217-offer-notes>small{display:block!important;margin-bottom:9px!important;font-size:10px!important;font-weight:900!important;letter-spacing:.08em!important;color:#6b7280!important}.cj217-offer-info>div{display:flex!important;flex-wrap:wrap!important;gap:7px!important}.cj217-offer-info span{background:#eef2ff!important;border-radius:999px!important;padding:7px 10px!important;font-size:11px!important;font-weight:800!important;color:#273a83!important}.cj217-offer-notes p{margin:0!important;font-size:13px!important;line-height:1.45!important;color:#374151!important}
.cj217-offer-actions{flex:0 0 auto!important;display:grid!important;grid-template-columns:.82fr 1.18fr!important;gap:10px!important;padding:12px 14px calc(12px + env(safe-area-inset-bottom))!important;background:#fff!important;border-top:1px solid #e5e7eb!important;box-shadow:0 -7px 22px #11182712!important;box-sizing:border-box!important}.cj217-offer-actions button{height:62px!important;border:0!important;border-radius:15px!important;color:#fff!important;font-size:14px!important;font-weight:950!important;letter-spacing:.02em!important;box-shadow:none!important;pointer-events:auto!important}.cj217-offer-actions #cj217-offer-decline{background:#d92525!important}.cj217-offer-actions #cj217-offer-accept{background:#16a34a!important}.cj217-offer-actions button:active{transform:scale(.98)!important}
body.cj217-pending-offer #cj199-sheet{display:none!important}
body.cj217-pending-offer #toast-container,body.cj217-pending-offer .toast,body.cj217-pending-offer #cj217-notice{display:none!important;visibility:hidden!important}
body.cj217-pending-offer #cj199-metric,body.cj217-pending-offer #cj199-bottom,body.cj217-pending-offer #cj199-queue,body.cj217-pending-offer #cj199-center,body.cj217-pending-offer #cj199-checkin,body.cj217-pending-offer #cj217-sos{pointer-events:none!important}
@media(max-width:390px){.cj217-offer-top strong{font-size:23px!important}.cj217-offer-highlight strong{font-size:30px!important}.cj217-offer-actions button{height:58px!important;font-size:13px!important}.cj217-offer-scroll{padding:10px!important;gap:9px!important}.cj217-offer-route,.cj217-offer-highlight{padding:15px!important}}
'''
    write(cssp,css)

idxp=Path('public/index.html')
idx=read(idxp)
idx=idx.replace('app-version" content="14.33.17"','app-version" content="14.33.18"')
idx=idx.replace('chegaja-v217-driver-navigation.css?v=14.33.17&recovery=143317','chegaja-v217-driver-navigation.css?v=14.33.18&recovery=143318')
idx=idx.replace('chegaja-v217-driver-navigation.js?v=14.33.17&recovery=143317','chegaja-v217-driver-navigation.js?v=14.33.18&recovery=143318')
idx=idx.replace('/app.js?v=14.33.17&recovery=143317','/app.js?v=14.33.17&recovery=143318')
idx=idx.replace('/chegaja-v201-operational.js?v=14.33.17&recovery=143317','/chegaja-v201-operational.js?v=14.33.17&recovery=143318')
write(idxp,idx)

tp=Path('scripts/test-v14153-logo-google-maps.mjs')
t=read(tp)
t=t.replace('14\\.33\\.17','14\\.33\\.18')
t=t.replace('v=14\\.33\\.17&recovery=143317','v=14\\.33\\.18&recovery=143318')
t=t.replace("console.log('ChegaJá 14.33.17", "console.log('ChegaJá 14.33.18")
extra="""
assert.match(driver,/cj217-offer-screen/);
assert.match(driver,/function renderOfferScreen/);
assert.match(driver,/cj217-offer-accept/);
assert.match(driver,/cj217-offer-decline/);
assert.match(driver,/setInterval\\(fire,3000\\)/);
assert.match(driver,/c\\.__cjPrimed/);
assert.match(driverCss,/#cj217-offer-screen\\{position:fixed!important;inset:0!important;z-index:2147483000!important/);
assert.match(driverCss,/#cj217-offer-decline\\{background:#d92525!important\\}/);
assert.match(driverCss,/#cj217-offer-accept\\{background:#16a34a!important\\}/);
assert.match(driverCss,/body\\.cj217-pending-offer #toast-container/);
"""
if 'assert.match(driver,/cj217-offer-screen/);' not in t:
    t=t.replace("console.log('ChegaJá 14.33.18", extra+"\nconsole.log('ChegaJá 14.33.18")
write(tp,t)

print('ChegaJá 14.33.18 preparado: oferta full-screen real, sem balão e toque persistente.')
