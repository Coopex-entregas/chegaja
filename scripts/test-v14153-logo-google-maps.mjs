import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read=file=>readFileSync(file,'utf8');
const index=read('public/index.html');
const maps=read('public/chegaja-maps-leaflet.js');
const driver=read('public/chegaja-v217-driver-navigation.js');
const driverCss=read('public/chegaja-v217-driver-navigation.css');
const operational=read('public/chegaja-v201-operational.js');
const mapSafe=read('src/routes/map-safe.ts');
const platformConfig=read('src/lib/platform-config.ts');
const navigation=read('src/routes/platform-v32.ts');
const permissions=read('src/lib/permissions.ts');
const sw=read('public/sw.js');

assert.match(index,/app-version" content="14\.32\.0"/);
assert.match(index,/vendor\/leaflet\/leaflet\.js/);
assert.match(index,/chegaja-maps-leaflet\.js\?v=14\.32\.0/);
assert.doesNotMatch(index,/chegaja-v199-driver\.js/);
assert.doesNotMatch(index,/chegaja-v223-driver-final\.js/);
assert.doesNotMatch(index,/chegaja-v225-driver-polish\.js/);

assert.match(maps,/OpenStreetMap/);
assert.match(maps,/setLatLng/);
assert.match(maps,/ResizeObserver/);
assert.match(maps,/ChegaJaLeafletEngine/);
assert.doesNotMatch(maps,/maps\.googleapis\.com/);

assert.match(driver,/L\.map/);
assert.match(driver,/router\.project-osrm\.org/);
assert.match(driver,/invalidateSize/);
assert.match(driver,/ResizeObserver/);
assert.match(driver,/setLatLng/);
assert.match(driver,/COLETA REALIZADA/);
assert.match(driver,/INICIAR ENTREGA/);
assert.match(driver,/FINALIZAR ENTREGA/);
assert.doesNotMatch(driver,/google\.maps/);
assert.doesNotMatch(driver,/maps\.googleapis\.com/);
assert.doesNotMatch(driver,/DirectionsService/);

assert.doesNotMatch(driverCss,/(^|,)\s*\.leaflet-container\s*\{\s*display\s*:\s*none/im);
assert.match(driverCss,/body\.cj199-driver #cj199-map\.leaflet-container\{display:block!important\}/);

assert.match(operational,/\/api\/app\/map\/drivers/);
assert.match(operational,/location_allowed/);
assert.match(operational,/ChegaJaLeafletEngine/);

assert.match(mapSafe,/provider:'openstreetmap'/);
assert.match(mapSafe,/driver_map_enabled/);
assert.match(mapSafe,/location_allowed:false/);
assert.match(mapSafe,/date\(s\.start_at\)=date\('now','-3 hours'\)/);

assert.match(platformConfig,/const provider: MapsProvider = 'openstreetmap'/);
assert.match(navigation,/router\.project-osrm\.org/);
assert.doesNotMatch(navigation,/routes\.googleapis\.com/);
assert.doesNotMatch(navigation,/googleRoute/);

assert.match(permissions,/driver_map_enabled/);
assert.match(permissions,/tenant\\\/online-drivers/);
assert.match(sw,/RECOVERY_VERSION='14\.32\.0'/);

const activeScripts=[...index.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map(match=>String(match[1]).split('?')[0])
  .filter(src=>src.startsWith('/'))
  .map(src=>`public${src}`);
for(const file of activeScripts){
  if(!existsSync(file))continue;
  const source=read(file);
  assert.doesNotMatch(source,/\blocalhost\b|127\.0\.0\.1|npm\s+run\s+dev|PowerShell\s+aberto|mantenha\s+o\s+PowerShell/i,`Referência de desenvolvimento ativa em ${file}`);
}

console.log('ChegaJá 14.32.0: Leaflet/OpenStreetMap/OSRM, permissão de localização e painel do cooperado verificados.');