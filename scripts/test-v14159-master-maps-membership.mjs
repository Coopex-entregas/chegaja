import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read=file=>readFileSync(file,'utf8');
const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.version,'14.15.9');

const migration=read('migrations/0044_master_maps_driver_registry.sql');
for(const column of ['membership_number','membership_sequence','membership_year','joined_at','left_at'])assert.match(migration,new RegExp(`ADD COLUMN ${column}`));
assert.match(migration,/idx_drivers_membership_sequence_unique/);
assert.match(migration,/maps_provider/);

const config=read('src/lib/platform-config.ts');
assert.match(config,/AES-GCM/);
assert.match(config,/google_maps_api_key/);
assert.match(config,/google_maps_browser_key/);
assert.match(config,/provider: MapsProvider/);

const platform=read('src/routes/platform-v23.ts');
assert.match(platform,/platform\/maps-settings/);
assert.match(platform,/Places API \(New\)/);
assert.match(platform,/directions\/v2:computeRoutes/);
assert.match(platform,/as duas chaves/);

const maps=read('src/lib/maps.ts');
assert.match(maps,/getMapsRuntimeConfig/);
assert.match(maps,/places\.googleapis\.com\/v1\/places:searchText/);
assert.match(maps,/routes\.googleapis\.com\/directions\/v2:computeRoutes/);
assert.match(maps,/if \(mapsConfig\.provider === 'google'\) return null/);

const admin=read('src/routes/admin.ts');
assert.match(admin,/users\/attendant-bases/);
assert.match(admin,/if\(bases\.length===1\)return bases\[0\]\.id/);
assert.match(admin,/A sequência é permanente dentro da cooperativa/);
assert.match(admin,/SELECT MAX\(COALESCE\(membership_sequence/);
assert.match(admin,/status='inactive',online=0,left_at=\?,deleted_at=NULL/);
assert.match(admin,/restored:true/);
assert.match(admin,/normalizedPersonName\(existing\.name\)!==normalizedPersonName\(name\)/);
const auth=read('src/lib/auth.ts');
assert.match(auth,/user_status !== 'active'/);
assert.match(auth,/driver_status !== 'active'/);
assert.match(auth,/Este acesso foi inativado/);

const frontend=read('public/chegaja-v149.js');
assert.match(frontend,/Administrador Master/);
assert.match(frontend,/OpenStreetMap — alternativa sem chave/);
assert.match(frontend,/window\.ChegaJaMaps/);
assert.match(frontend,/Base vinculada automaticamente/);
assert.match(frontend,/Matrícula permanente/);
assert.match(frontend,/Reativar \/ editar/);
assert.match(frontend,/roles\.dispatcher='Atendente da Base'/);

const driver=read('public/chegaja-v144.js');
assert.match(driver,/NAVEGAÇÃO • GOOGLE MAPS/);
assert.match(driver,/ChegaJaMaps\.createMap/);

const finalJs=read('public/chegaja-final.js');
assert.match(finalJs,/async function driverMap/);
assert.match(finalJs,/async function drawBaseMap/);
assert.match(finalJs,/Google Maps não carregou/);

const html=read('public/index.html'),sw=read('public/sw.js');
assert.match(html,/chegaja-v149\.js\?v=14\.15\.9/);
assert.match(sw,/chegaja-14-15-9/);
assert.ok(existsSync('src/routes/platform-v23.ts'));
console.log('ChegaJá 14.15.9: mapas configuráveis no Master, atendente automático e matrícula permanente verificados.');
