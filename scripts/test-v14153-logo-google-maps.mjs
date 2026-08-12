import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=file=>readFileSync(file,'utf8');
const index=read('public/index.html');
const driver=read('public/chegaja-v217-driver-navigation.js');
const driverCss=read('public/chegaja-v217-driver-navigation.css');
const app=read('public/app.js');
const operational=read('public/chegaja-v201-operational.js');
const driverLive=read('src/routes/driver-live.ts');
const mapSafe=read('src/routes/map-safe.ts');
const navigation=read('src/routes/platform-v32.ts');
const v28=read('src/routes/platform-v28.ts');
const v16=read('src/routes/platform-v16.ts');
const finalJs=read('public/chegaja-final.js');

assert.match(index,/app-version" content="14\.33\.38"/);
assert.match(index,/chegaja-v217-driver-navigation\.js\?v=14\.33\.38&recovery=143338/);
assert.match(index,/chegaja-v217-driver-navigation\.css\?v=14\.33\.33&recovery=143333/);
for(const old of ['chegaja-v199-driver.css','chegaja-v205-driver-fixes.css','chegaja-v222-driver-stability.css','chegaja-v223-driver-final.css','chegaja-v225-driver-polish.css','chegaja-v205-driver-fixes.js']) assert.equal(index.includes(old),false,`asset antigo carregado: ${old}`);
assert.doesNotMatch(index,/chegaja-v230-base-toast-filter|chegaja-v232-navigation-final/);

assert.match(driver,/ChegaJá 14\.33\.38/);
assert.match(driver,/start\.hidden=work/);
assert.match(driver,/phoneTone/);
assert.match(driver,/setInterval\(fire,2700\)/);
assert.match(driver,/function ensureInstantAlarmBus\(test=false\)/);
assert.match(driver,/function setInstantAlarm\(active\)/);
assert.match(driver,/A\.pollTimer=setInterval\(\(\)=>poll\(false\),2500\)/);
assert.match(driver,/function alarmWavUrl\(\)/);
assert.match(driver,/new Audio\(\)/);
assert.match(driver,/function primeAlarmMedia\(test=false\)/);
assert.match(driver,/installAudioArm\(\)/);
assert.match(driver,/primeAlarmMedia\(!A\.online\)/);
assert.match(driver,/media\.muted=false/);
assert.doesNotMatch(driver,/offerAlertCount>=6/);
assert.match(driver,/forceDriverHome/);
assert.match(driver,/if\(!isHome\(\)&&\(offerRequired\(item\)\|\|changed\)\)await forceDriverHome\(\)/);
assert.match(driver,/hydrateServerGps/);
assert.match(driver,/async function locationHeartbeat/);
assert.match(driver,/maximumAge:2500,timeout:6500/);
assert.match(driver,/A\.locationTimer=setInterval\(\(\)=>locationHeartbeat\(\),7000\)/);
assert.match(driver,/await forceDriverHome\(\)/);
assert.doesNotMatch(driver,/pts=\[\{\.\.\.origin\},\{\.\.\.target\}\]/);
assert.match(driver,/oldDeliveries/);
assert.match(driver,/page==='deliveries'.*ChegaJaDriverActiveDelivery/);
assert.match(driver,/\/api\/app\/v32\/driver\/sos/);
assert.match(driver,/id="cj217-sos"/);
assert.match(driver,/router\.project-osrm\.org/);
assert.match(driver,/const NAV_ZOOM=18\.5/);
assert.match(driver,/preferCanvas:false/);
assert.match(driver,/L\.marker\(ll/);
assert.match(driver,/className:'cj217-route-line'/);
assert.match(driver,/navigation\?lat=/);
assert.match(driver,/function frameNavigation\(force=false\)/);
assert.match(driver,/A\.map\.setView\(\[A\.gps\.lat,A\.gps\.lng\],zoom/);
assert.match(driver,/applyMapBearing\(force\)/);
assert.match(driver,/d<100\?18\.8:d<400\?18\.5:18\.1/);
assert.doesNotMatch(driver,/fitBounds\(bounds/);
assert.match(driver,/function ptBrVoice\(\)/);
assert.match(driver,/lang='pt-BR'/);
assert.match(driver,/function maybeSpeakNavigation\(nav\)/);
assert.match(index,/leaflet-rotate@0\.2\.8\/dist\/leaflet-rotate\.js/);
assert.match(driver,/function applyMapBearing\(force=false\)/);
assert.match(driver,/DeviceOrientationEvent\.requestPermission/);
assert.match(driver,/webkitCompassHeading/);
assert.match(driver,/function drawRouteArrows\(\)/);
assert.match(driver,/function drawManeuvers\(steps\)/);
assert.match(driver,/function toggleBearingMode\(\)\{A\.headingUp=true/);
assert.doesNotMatch(driver,/A\.headingUp=!A\.headingUp/);
assert.match(driver,/if\(type==='depart'\)continue/);
assert.match(driver,/próxima manobra/);
assert.match(driverCss,/cj217-route-direction-icon\{display:none!important/);
assert.match(driverCss,/cj217-navigation-card strong/);

assert.match(driver,/id="cj217-bearing"/);
assert.match(driverCss,/#cj217-bearing/);
assert.match(driverCss,/leaflet-tile-pane\{filter:saturate/);

assert.doesNotMatch(driverCss,/cj217-self-icon:before\{content:''/);
assert.match(driverCss,/cj217-self-icon:before\{display:none!important/);
assert.match(navigation,/function geocodeAddress\(address:string\)/);
assert.match(navigation,/nominatim\.openstreetmap\.org/);
assert.match(navigation,/UPDATE deliveries SET pickup_lat=/);
assert.match(navigation,/UPDATE deliveries SET delivery_lat=/);
assert.match(driver,/navFrameOrigin/);
assert.match(driverCss,/cj217-self-icon:before/);
assert.match(driverCss,/content:'COLETA'/);
assert.match(driverCss,/content:'ENTREGA'/);
assert.match(driver,/type:'square'/);
assert.match(driver,/type:'sawtooth'/);
assert.match(driver,/setInterval\(fire,2700\)/);
assert.match(navigation,/c\.req\.query\('lat'\)/);
assert.match(navigation,/c\.req\.query\('lng'\)/);
assert.match(driver,/status==='offered'\|\|status==='assigned'/);
assert.match(driver,/nav\.next\?\.lat/);
assert.match(driver,/acceptedStatus=\['accepted','to_pickup'/);
assert.doesNotMatch(finalJs,/Nova entrega — toque em Aceitar/);
assert.match(finalJs,/delivery_assigned'\)\{stopRing\(\);continue;/);
assert.match(v28,/item\.status==='assigned'.*return true/);
assert.match(index,/chegaja-final\.js\?v=14\.33\.21&recovery=143321/);

assert.match(driverCss,/ÚNICA folha do painel do cooperado/);
assert.match(driverCss,/body\.cj217-active-delivery #cj199-start\{display:none!important/);
assert.match(driverCss,/body\.cj217-pending-offer #cj199-sheet\{position:fixed!important/);
assert.match(driverCss,/grid-template-columns:1\.25fr \.9fr/);
assert.match(driverCss,/#cj217-sos/);

assert.match(app,/state\.timer=setInterval\(\(\)=>\{if\(state\.page==='tracking'/);
assert.match(app,/},6000\)\};/);
assert.match(app,/state\.timer=setInterval\(refresh,6000\)/);
assert.match(operational,/R\.timer=setTimeout\(tick,6000\)/);
assert.match(driverLive,/Finalize ou resolva suas entregas ativas antes de ficar offline/);
assert.match(mapSafe,/d\.current_lat IS NOT NULL AND d\.current_lng IS NOT NULL/);
assert.match(navigation,/platformV32Routes\.post\('\/v32\/driver\/sos'/);

assert.match(driver,/cj217-offer-screen/);
assert.match(driver,/function renderOfferScreen/);
assert.match(driver,/cj217-offer-accept/);
assert.match(driver,/cj217-offer-decline/);
assert.match(driver,/setInterval\(fire,2700\)/);
assert.match(driver,/c\.__cjPrimed/);
assert.match(driverCss,/#cj217-offer-screen\{position:fixed!important;inset:0!important;z-index:2147483000!important/);
assert.match(driverCss,/#cj217-offer-decline\{background:#d92525!important\}/);
assert.match(driverCss,/#cj217-offer-accept\{background:#16a34a!important\}/);
assert.match(driverCss,/body\.cj217-pending-offer #toast-container/);

console.log('ChegaJá 14.33.26: oferta full-screen única, aceite e rota coleta/entrega validados.');

assert.match(app,/state\.freshLogin=true/);
assert.match(app,/freshDriver=.*state\.freshLogin/);
assert.match(app,/targetPage=freshDriver\?'dashboard'/);
assert.match(index,/\/app\.js\?v=14\.33\.31&recovery=143331/);
assert.match(driver,/L\.marker\(ll/);
assert.match(driver,/L\.polyline\(ll,\{color:'#075dff'/);


assert.match(driver,/function mapRotationForHeading\(heading\)/);
assert.match(driver,/normAngle\(360-h\)/);
assert.match(driver,/wanted=target==null\?0:mapRotationForHeading\(target\)/);
assert.match(driver,/angle=h==null\?0:normAngle\(h\+mapBearing\)/);

assert.match(driver,/function routeHeadingNearGps\(\)/);
assert.match(driver,/gap<=18\)return road/);
assert.match(driverCss,/font-size:clamp\(18px,5\.15vw,25px\)/);
assert.match(driverCss,/-webkit-line-clamp:3/);

assert.match(app,/APP_TIME_ZONE='America\/Sao_Paulo'/);
assert.match(app,/APP_SQL_UTC\.test\(text\)/);
assert.match(app,/sessionStorage\.setItem\('cj_driver_fresh_login','1'\)/);
assert.match(app,/sessionStorage\.getItem\('cj_driver_fresh_login'\)/);
assert.match(driver,/async function manualArrivePickup\(\)/);
assert.match(driver,/manual:true,stage:'pickup'/);
assert.match(driver,/Confirme COLETA REALIZADA somente depois de retirar o pedido/);
assert.doesNotMatch(v28,/item\.status==='at_pickup'&&distance>=200/);
assert.match(v28,/Nunca avançar at_pickup -> in_route por GPS/);

assert.doesNotMatch(driver,/drawRoute\(\[\{\.\.\.origin\},\{\.\.\.target\}\]\)/);
assert.match(driver,/routeRetryTimer/);
assert.match(driver,/setTimeout\(\(\)=>\{A\.routeRetryTimer=null;updateRoute\(true\)\},2500\)/);


assert.match(driver,/function fuelEstimate\(x,totalMetersOverride=null\)/);
assert.match(driver,/fuel_km_per_liter/);
assert.match(driver,/fuel_price_cents/);
assert.match(driver,/fuel_cost_cents/);
assert.match(driver,/COMBUSTÍVEL EST\./);
assert.match(driver,/fuelReference\(fuel\)/);
assert.match(driverCss,/cj217-fuel-stat/);
assert.match(driverCss,/cj217-fuel-value/);
assert.match(v28,/fuelCostCents/);
assert.match(v28,/totalDistance\/1000\/kmPerLiter/);

assert.match(v28,/COALESCE\(bx\.fuel_price_cents,0\)>0/);

assert.match(v28,/COALESCE\(bx\.fuel_price_cents,0\)>0/);

assert.match(v28,/COALESCE\(bx\.fuel_price_cents,0\)>0/);

// 14.33.36 — combustível usa diretamente a precificação das Bases.
assert.doesNotMatch(v28,/FROM cooperatives cx/);
assert.doesNotMatch(v16,/UPDATE cooperatives SET fuel_km_per_liter/);
assert.match(v28,/FROM bases bx/);
assert.match(v28,/COALESCE\(bx\.fuel_price_cents,0\)>0/);

// 14.33.38 — múltiplas paradas: entrega vence empate curto; diferença grande usa menor rota.
assert.match(navigation,/DELIVERY_TIE_METERS=300/);
assert.match(navigation,/delivery_priority_tie/);
assert.match(navigation,/pickup_in_progress/);
assert.match(navigation,/picked_up_at/);
assert.match(driver,/activeItems:\[\]/);
assert.match(driver,/function basicFromLive\(live\)/);
assert.match(driver,/function syncDetailToNavigation\(next\)/);
assert.match(driver,/ENTREGA':'COLETA'/);
