import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=file=>readFileSync(file,'utf8');
const index=read('public/index.html');
const maps=read('public/chegaja-maps-leaflet.js');
const mapCss=read('public/chegaja-map-fallback.css');
const driver=read('public/chegaja-v217-driver-navigation.js');
const driverCss=read('public/chegaja-v217-driver-navigation.css');
const operational=read('public/chegaja-v201-operational.js');
const mapSafe=read('src/routes/map-safe.ts');
const driverLive=read('src/routes/driver-live.ts');
const platformV27=read('src/routes/platform-v27.ts');
const platformV28=read('src/routes/platform-v28.ts');
const publicTracking=read('src/routes/public-tracking-live.ts');
const platformConfig=read('src/lib/platform-config.ts');
const navigation=read('src/routes/platform-v32.ts');
const permissions=read('src/lib/permissions.ts');
const sw=read('public/sw.js');

assert.match(index,/app-version" content="14\.33\.0"/);
assert.match(index,/vendor\/leaflet\/leaflet\.js/);
assert.match(index,/chegaja-maps-leaflet\.js\?v=14\.33\.0/);
assert.match(index,/chegaja-v217-driver-navigation\.js\?v=14\.33\.0/);
assert.match(index,/hardenNetworkErrors/);
assert.match(index,/height:100svh/);
assert.doesNotMatch(index,/npm\s+run\s+dev|PowerShell\s+aberto|127\.0\.0\.1|\blocalhost\b/i);
assert.doesNotMatch(index,/chegaja-v199-driver\.js/);
assert.doesNotMatch(index,/chegaja-v223-driver-final\.js/);
assert.doesNotMatch(index,/chegaja-v225-driver-polish\.js/);

assert.match(maps,/OpenStreetMap/);
assert.match(maps,/setLatLng/);
assert.match(maps,/ResizeObserver/);
assert.match(maps,/ChegaJaLeafletEngine/);
assert.match(maps,/mouseenter/);
assert.match(maps,/mouseleave/);
assert.doesNotMatch(maps,/marker\.on\('mouseover'/);
assert.doesNotMatch(maps,/marker\.on\('mouseout'/);
assert.doesNotMatch(maps,/maps\.googleapis\.com/);
assert.match(mapCss,/pointer-events:none!important/);
assert.match(mapCss,/width:30px;height:30px/);
assert.match(mapCss,/border:0!important/);

assert.match(driver,/L\.map/);
assert.match(driver,/router\.project-osrm\.org/);
assert.match(driver,/ResizeObserver/);
assert.match(driver,/setLatLng/);
assert.match(driver,/\/v28\/driver\/auto-location/);
assert.match(driver,/manual:true,stage:'delivery'/);
assert.match(driver,/Nome de quem recebeu/);
assert.match(driver,/confirmation_required/);
assert.match(driver,/window\.stopLocation/);
assert.doesNotMatch(driver,/healthTimer/);
assert.doesNotMatch(driver,/INICIAR ENTREGA/);
assert.doesNotMatch(driver,/google\.maps|maps\.googleapis\.com|DirectionsService/);
assert.doesNotMatch(driver,/npm\s+run\s+dev|PowerShell\s+aberto|127\.0\.0\.1|\blocalhost\b/i);

assert.doesNotMatch(driverCss,/(^|,)\s*\.leaflet-container\s*\{\s*display\s*:\s*none/im);
assert.match(driverCss,/body\.cj199-driver #cj199-map\.leaflet-container\{display:block!important/);
assert.match(driverCss,/100svh/);

assert.match(operational,/\/api\/app\/map\/drivers/);
assert.match(operational,/location_allowed/);
assert.match(operational,/ChegaJaLeafletEngine/);
assert.doesNotMatch(operational,/delivery-stops/);

assert.match(mapSafe,/provider:'openstreetmap'/);
assert.match(mapSafe,/driver_map_enabled/);
assert.match(mapSafe,/location_allowed:false/);
assert.match(mapSafe,/\/driver\/logout/);
assert.match(mapSafe,/CASE WHEN d\.online=1 THEN 1 ELSE 0 END online/);
assert.match(mapSafe,/heartbeat_fresh/);
assert.doesNotMatch(mapSafe,/d\.online=1 AND datetime\(d\.last_seen_at\).*THEN 1 ELSE 0 END online/);

assert.match(driverLive,/estado ONLINE|ONLINE é persistente|ONLINE é/iu);
assert.match(driverLive,/heartbeat_fresh/);
assert.match(driverLive,/CASE WHEN online=1 THEN 1 ELSE 0 END online/);
assert.match(platformV27,/CASE WHEN d\.online=1 THEN 1 ELSE 0 END online/);
assert.match(platformV27,/active_delivery_code/);
assert.match(platformV28,/distance>=200/);
assert.match(platformV28,/Chegada ao destino/);
assert.match(platformV28,/gpsTolerance/);
assert.match(publicTracking,/pickup_arrived_at/);
assert.match(publicTracking,/delivery_arrived_at/);
assert.match(publicTracking,/stops_before/);
assert.match(publicTracking,/#0D45D8/);
assert.doesNotMatch(publicTracking,/#721536/i);

assert.match(platformConfig,/const provider: MapsProvider = 'openstreetmap'/);
assert.match(navigation,/router\.project-osrm\.org/);
assert.doesNotMatch(navigation,/routes\.googleapis\.com|googleRoute/);
assert.match(permissions,/driver_map_enabled/);
assert.match(permissions,/tenant\\\/online-drivers/);
assert.match(sw,/RECOVERY_VERSION='14\.33\.0'/);

console.log('ChegaJá 14.33.0: online persistente, hover estável, Leaflet/OpenStreetMap/OSRM, geofence e privacidade verificados.');
