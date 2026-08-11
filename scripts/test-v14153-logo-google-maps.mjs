import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=file=>readFileSync(file,'utf8');
const index=read('public/index.html');
const driver=read('public/chegaja-v217-driver-navigation.js');
const driverCss=read('public/chegaja-v217-driver-navigation.css');
const clientCss=read('public/chegaja-v207-client-uber.css');
const address=read('src/routes/address-resilient.ts');
const driverLive=read('src/routes/driver-live.ts');
const navigation=read('src/routes/platform-v32.ts');

assert.match(index,/app-version" content="14\.33\.8"/);
assert.match(index,/chegaja-v217-driver-navigation\.js\?v=14\.33\.8&recovery=14338/);
assert.match(index,/chegaja-v217-driver-navigation\.css\?v=14\.33\.8&recovery=14338/);
assert.doesNotMatch(index,/chegaja-v232-navigation-final/);
assert.match(index,/cj217-active-delivery #cj199-start\[hidden\]/);
assert.match(index,/content:'ONLINE'/);

assert.match(driver,/ChegaJá 14\.33\.3/);
assert.match(driver,/watchPosition/);
assert.match(driver,/getCurrentPosition/);
assert.match(driver,/enableHighAccuracy:true/);
assert.match(driver,/maximumAge:2000/);
assert.match(driver,/\/api\/app\/map\/location/);
assert.match(driver,/\/api\/app\/driver\/online/);
assert.match(driver,/startGps\(\)/);
assert.match(driver,/ACEITAR ENTREGA/);
assert.match(driver,/CHEGUEI NA COLETA/);
assert.match(driver,/COLETA REALIZADA/);
assert.match(driver,/GOOGLE MAPS/);
assert.match(driver,/router\.project-osrm\.org/);
assert.doesNotMatch(driver,/AGUARDE.*GPS|GPS…/i);
assert.doesNotMatch(driver,/chegaja-v232/i);

assert.match(driverCss,/body\.cj199-driver #cj199-map\.leaflet-container\{display:block!important/);
assert.match(clientCss,/#tracking-screen:not\(\.hidden\)/);
assert.match(clientCss,/overflow-x:hidden!important/);
assert.match(address,/typed_number_preserved/);
assert.match(address,/preserveTypedNumber/);
assert.match(driverLive,/Finalize ou resolva suas entregas ativas antes de ficar offline/);
assert.match(navigation,/platformV32Routes\.post\('\/v32\/driver\/sos'/);

console.log('ChegaJá 14.33.8: painel único, botão circular aprovado e GPS estável restaurados.');
