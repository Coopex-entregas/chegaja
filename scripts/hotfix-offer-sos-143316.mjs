import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const write = (p, s) => writeFileSync(p, s, 'utf8');
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

const driverPath = 'public/chegaja-v217-driver-navigation.js';
let driver = read(driverPath);
must(driver.includes('ChegaJá 14.33.15'), 'v217 esperado 14.33.15 não encontrado');
driver = driver
  .replace('/* ChegaJá 14.33.15 — iniciar imediato, GPS resiliente e um único controlador */', '/* ChegaJá 14.33.16 — oferta em tela cheia, toque contínuo e GPS estável */')
  .replaceAll('__CJ_DRIVER_LEAFLET_143315__', '__CJ_DRIVER_LEAFLET_143316__');

const soundStart = driver.indexOf('function beep(c,at=0)');
const soundEnd = driver.indexOf('function freshPosition()', soundStart);
must(soundStart >= 0 && soundEnd > soundStart, 'bloco de som do v217 não encontrado');
const newSound = String.raw`function phoneTone(c,at=0,duration=.76){try{const start=c.currentTime+at,master=c.createGain();master.gain.setValueAtTime(.0001,start);master.gain.exponentialRampToValueAtTime(.48,start+.025);master.gain.setValueAtTime(.48,start+Math.max(.05,duration-.08));master.gain.exponentialRampToValueAtTime(.0001,start+duration);master.connect(c.destination);for(const f of[440,480]){const o=c.createOscillator();o.type='sine';o.frequency.setValueAtTime(f,start);o.connect(master);o.start(start);o.stop(start+duration+.02)}}catch{}}
async function ring(){navigator.vibrate?.([720,150,720,900]);const c=unlockAudio();if(!c)return;try{if(c.state!=='running')await c.resume()}catch{}if(c.state!=='running')return;phoneTone(c,0,.72);phoneTone(c,.92,.72)}
function stopOfferAlert(removeOverlay=true){clearInterval(A.offerAlertTimer);A.offerAlertTimer=null;A.offerAlertCount=0;navigator.vibrate?.(0);if(removeOverlay)$('#cj217-offer-fullscreen')?.remove()}
function renderOfferScreen(x){if(!offerRequired(x)){$('#cj217-offer-fullscreen')?.remove();return}let box=$('#cj217-offer-fullscreen');if(!box){box=document.createElement('section');box.id='cj217-offer-fullscreen';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','Nova entrega');($('#cj199-app')||document.body).appendChild(box)}const value=money(x.driver_net_cents??x.driver_earnings_cents??x.charge_cents??0),distanceText=Number(x.distance_meters||0)>=1000?`${(Number(x.distance_meters)/1000).toFixed(1).replace('.',',')} km`:`${Math.round(Number(x.distance_meters||0))} m`,timeText=`${Math.max(1,Math.round(Number(x.duration_seconds||0)/60))} min`;box.innerHTML=`<div class="cj217-offer-top"><small>NOVA ENTREGA</small><strong>${esc(x.display_code||'Entrega')}</strong><span>Aguardando sua decisão</span></div><div class="cj217-offer-body"><div class="cj217-offer-route"><article><b>C</b><div><small>COLETA</small><strong>${esc(x.pickup_address||'Endereço não informado')}</strong>${x.pickup_complement?`<span>${esc(x.pickup_complement)}</span>`:''}</div></article><article><b>E</b><div><small>ENTREGA</small><strong>${esc(x.delivery_address||'Endereço não informado')}</strong>${x.delivery_complement?`<span>${esc(x.delivery_complement)}</span>`:''}</div></article></div><div class="cj217-offer-summary"><span><small>VOCÊ RECEBE</small><b>${value}</b></span><span><small>DISTÂNCIA</small><b>${distanceText}</b></span><span><small>TEMPO</small><b>${timeText}</b></span></div>${x.notes?`<p class="cj217-offer-notes"><b>Observações:</b> ${esc(x.notes)}</p>`:''}<p class="cj217-offer-ring">O alerta continuará tocando até você aceitar ou recusar.</p></div><div class="cj217-offer-actions"><button id="cj217-offer-decline" type="button">RECUSAR</button><button id="cj217-offer-accept" type="button">ACEITAR ENTREGA</button></div>`;$('#cj217-offer-accept',box).onclick=()=>performAction('accept');$('#cj217-offer-decline',box).onclick=decline}
function notifyOffer(x){const id=String(x?.id||'');if(!id)return;renderOfferScreen(x);if(id===A.lastOfferId&&A.offerAlertTimer)return;stopOfferAlert(false);A.lastOfferId=id;renderOfferScreen(x);const fire=()=>{if(!offerRequired(A.detail)||String(A.detail?.id)!==id){stopOfferAlert();return}A.offerAlertCount+=1;ring()};fire();A.offerAlertTimer=setInterval(fire,3600)}
`;
driver = driver.slice(0, soundStart) + newSound + driver.slice(soundEnd);
write(driverPath, driver);

const cssPath = 'public/chegaja-v217-driver-navigation.css';
let css = read(cssPath);
const marker = '/* ChegaJá 14.33.16 — oferta em tela cheia */';
if (!css.includes(marker)) css += String.raw`

${marker}
body.cj217-pending-offer #cj199-sheet{transform:translateY(101%)!important;pointer-events:none!important}
#cj217-offer-fullscreen{position:absolute;z-index:140;inset:0;background:#f4f7fb;color:#10234f;display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;pointer-events:auto!important;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
#cj217-offer-fullscreen .cj217-offer-top{padding:max(24px,env(safe-area-inset-top)) 20px 20px;background:linear-gradient(145deg,#0a2f96,#1459ff);color:#fff;display:grid;gap:5px;box-shadow:0 8px 26px #0d214f2b}
#cj217-offer-fullscreen .cj217-offer-top small{font-size:11px;font-weight:950;letter-spacing:.17em;color:#ffd5b3}
#cj217-offer-fullscreen .cj217-offer-top strong{font-size:clamp(30px,9vw,42px);line-height:1}
#cj217-offer-fullscreen .cj217-offer-top span{font-size:14px;font-weight:800;color:#e5edff}
#cj217-offer-fullscreen .cj217-offer-body{min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:18px 16px 24px;display:grid;align-content:start;gap:14px}
#cj217-offer-fullscreen .cj217-offer-route{display:grid;gap:10px}
#cj217-offer-fullscreen .cj217-offer-route article{display:grid;grid-template-columns:46px minmax(0,1fr);gap:12px;align-items:center;padding:14px;border-radius:18px;background:#fff;border:1px solid #dce5f2;box-shadow:0 5px 18px #10275f0e}
#cj217-offer-fullscreen .cj217-offer-route article>b{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#1459ff;color:#fff;font-size:15px}
#cj217-offer-fullscreen .cj217-offer-route article+article>b{background:#ff7a00}
#cj217-offer-fullscreen .cj217-offer-route article>div{display:grid;gap:3px;min-width:0}
#cj217-offer-fullscreen .cj217-offer-route small,#cj217-offer-fullscreen .cj217-offer-summary small{font-size:9px;font-weight:950;letter-spacing:.1em;color:#71809a}
#cj217-offer-fullscreen .cj217-offer-route strong{font-size:15px;line-height:1.35;color:#13264f;overflow-wrap:anywhere}
#cj217-offer-fullscreen .cj217-offer-route span{font-size:11px;color:#66748a}
#cj217-offer-fullscreen .cj217-offer-summary{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px}
#cj217-offer-fullscreen .cj217-offer-summary>span{display:grid;gap:3px;padding:13px 11px;border-radius:16px;background:#eaf1ff;min-width:0}
#cj217-offer-fullscreen .cj217-offer-summary b{font-size:15px;color:#0a2f96;white-space:nowrap}
#cj217-offer-fullscreen .cj217-offer-notes{margin:0;padding:13px;border-radius:15px;background:#fff3e8;color:#6d3e23;font-size:12px;line-height:1.45}
#cj217-offer-fullscreen .cj217-offer-ring{margin:0;text-align:center;color:#6a7890;font-size:11px;font-weight:800}
#cj217-offer-fullscreen .cj217-offer-actions{padding:12px 14px max(14px,env(safe-area-inset-bottom));display:grid;grid-template-columns:.8fr 1.4fr;gap:10px;background:#fff;border-top:1px solid #dce4ef;box-shadow:0 -8px 24px #10275f12}
#cj217-offer-fullscreen .cj217-offer-actions button{min-height:64px;border:0;border-radius:18px;font:950 14px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;pointer-events:auto!important}
#cj217-offer-decline{background:#fff0f1;color:#b4232d;border:1px solid #ffd4d7!important}
#cj217-offer-accept{background:#ff7a00;color:#fff;box-shadow:0 8px 22px #ff7a0038}
#cj217-offer-accept:active,#cj217-offer-decline:active{transform:scale(.985)}
@media(max-width:390px){#cj217-offer-fullscreen .cj217-offer-top{padding-left:15px;padding-right:15px}#cj217-offer-fullscreen .cj217-offer-body{padding:14px 11px 18px}#cj217-offer-fullscreen .cj217-offer-summary{grid-template-columns:1fr 1fr}#cj217-offer-fullscreen .cj217-offer-summary>span:first-child{grid-column:1/-1}#cj217-offer-fullscreen .cj217-offer-actions{padding-left:10px;padding-right:10px}#cj217-offer-fullscreen .cj217-offer-actions button{min-height:58px;font-size:13px}}
`;
write(cssPath, css);

const sosPath = 'public/chegaja-v205-driver-fixes.js';
const sos = String.raw`/* ChegaJá 14.33.16 — SOS atual, sem disputar oferta, som ou painel */
(()=>{
'use strict';
if(window.__CJ205_SOS_143316__)return;window.__CJ205_SOS_143316__=true;
const $=(s,r=document)=>r.querySelector(s);
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const isDriver=()=>window.state?.user?.role==='driver';
async function api(path,opt={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opt.timeout||8000);try{const r=await fetch(path,{method:opt.method||'GET',headers:{...(opt.body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store',signal:controller.signal});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw new Error(d.error||`Erro ${r.status}`);return d}catch(e){if(e?.name==='AbortError')throw new Error('A conexão demorou. Tente novamente.');throw e}finally{clearTimeout(timer)}}
function closeSos(){$('#cj205-sos-modal')?.remove()}
function markup(){return `<section id="cj205-sos-modal"><button class="backdrop" type="button" aria-label="Fechar"></button><article><header><div><small>AJUDA E EMERGÊNCIA</small><h2>Pedido de socorro</h2></div><button class="close" type="button">×</button></header><label class="cj205-reason"><span>Motivo ou observação (opcional)</span><textarea id="cj205-sos-reason" maxlength="800" placeholder="Ex.: problema mecânico, acidente, situação de risco..."></textarea></label><button id="cj205-send-sos" class="internal" type="button"><b>!</b><span><strong>ENVIAR SOS AGORA</strong><small>Envia sua localização para a cooperativa e para a operação vinculada.</small></span></button><div class="public"><strong>Ajuda pública</strong><div><a href="tel:190"><b>190</b><span>Polícia</span></a><a href="tel:192"><b>192</b><span>SAMU</span></a><a href="tel:193"><b>193</b><span>Bombeiros</span></a></div></div><p id="cj205-sos-error"></p></article></section>`}
function cachedLocation(){const p=window.ChegaJaLastDriverLocation,lat=Number(p?.lat),lng=Number(p?.lng);return Number.isFinite(lat)&&Number.isFinite(lng)?{latitude:lat,longitude:lng,accuracy:Number(p?.accuracy)||null}:null}
function deviceLocation(){const cached=cachedLocation();if(cached)return Promise.resolve(cached);return new Promise(resolve=>{if(!navigator.geolocation)return resolve(null);navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}),()=>resolve(null),{enableHighAccuracy:false,maximumAge:180000,timeout:5000})})}
async function sendSos(){const b=$('#cj205-send-sos'),error=$('#cj205-sos-error');if(!b||b.disabled)return;b.disabled=true;if(error)error.textContent='Enviando pedido de socorro…';const title=b.querySelector('strong');if(title)title.textContent='ENVIANDO SOS…';try{const loc=await deviceLocation(),occurrence=String($('#cj205-sos-reason')?.value||'').trim()||'Solicitação de ajuda enviada pelo aplicativo.';const d=await api('/api/app/v32/driver/sos',{method:'POST',body:{occurrence,...(loc||{})},timeout:10000});if(error){error.style.color='#137333';error.textContent=d.message||'Socorro enviado com sucesso.'}if(title)title.textContent='SOS ENVIADO';navigator.vibrate?.([450,120,450]);setTimeout(closeSos,1400)}catch(e){b.disabled=false;if(title)title.textContent='ENVIAR SOS AGORA';if(error){error.style.color='';error.textContent=e.message||'Não foi possível enviar o socorro.'}}}
function openSos(){closeSos();document.body.insertAdjacentHTML('beforeend',markup());$('#cj205-sos-modal .backdrop').onclick=$('#cj205-sos-modal .close').onclick=closeSos;$('#cj205-send-sos').onclick=sendSos}
function install(){if(!isDriver())return;const app=$('#cj199-app');if(!app)return;let b=$('#cj205-sos-button');if(!b){b=document.createElement('button');b.id='cj205-sos-button';b.type='button';b.innerHTML='<b>!</b><small>SOS</small>';app.appendChild(b)}b.setAttribute('aria-label','Pedir socorro');b.onclick=openSos}
function boot(){install();new MutationObserver(()=>install()).observe(document.body,{childList:true,subtree:true});window.addEventListener('pageshow',install);document.addEventListener('visibilitychange',()=>{if(!document.hidden)install()})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
`;
write(sosPath, sos);

const indexPath = 'public/index.html';
let index = read(indexPath);
index = index
  .replace(/<meta name="app-version" content="14\.33\.15"\s*\/>/, '<meta name="app-version" content="14.33.16" />')
  .replaceAll('recovery=143315', 'recovery=143316')
  .replace('chegaja-v217-driver-navigation.css?v=14.33.9&recovery=143316', 'chegaja-v217-driver-navigation.css?v=14.33.16&recovery=143316')
  .replace('chegaja-v217-driver-navigation.js?v=14.33.15&recovery=143316', 'chegaja-v217-driver-navigation.js?v=14.33.16&recovery=143316')
  .replace('chegaja-v205-driver-fixes.js?v=14.30.2&recovery=143316', 'chegaja-v205-driver-fixes.js?v=14.33.16&recovery=143316');
write(indexPath, index);

const testPath = 'scripts/test-v14153-logo-google-maps.mjs';
let test = read(testPath);
test = test
  .replaceAll('14\\.33\\.15', '14\\.33\\.16')
  .replaceAll('143315', '143316')
  .replaceAll("ChegaJá 14.33.15", "ChegaJá 14.33.16")
  .replace("assert.match(driver,/ChegaJá 14\\.33\\.16/);", "assert.match(driver,/ChegaJá 14\\.33\\.16/);\nassert.match(driver,/cj217-offer-fullscreen/);\nassert.match(driver,/phoneTone/);\nassert.doesNotMatch(driver,/offerAlertCount>=6/);\nassert.match(driver,/setInterval\\(fire,3600\\)/);")
  .replace("assert.match(navigation,/platformV32Routes\\.post\\('\\/v32\\/driver\\/sos'/);", "assert.match(navigation,/platformV32Routes\\.post\\('\\/v32\\/driver\\/sos'/);\nconst sos=read('public/chegaja-v205-driver-fixes.js');\nassert.match(sos,/\\/api\\/app\\/v32\\/driver\\/sos/);\nassert.doesNotMatch(sos,/pollSound|startRing|callSound/);");
write(testPath, test);

console.log('Hotfix 14.33.16 aplicado: oferta full-screen, toque contínuo e SOS v32.');
