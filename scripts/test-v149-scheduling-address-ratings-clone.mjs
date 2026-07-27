import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const front = read('public/chegaja-final.js');
const maps = read('src/lib/maps.ts');
const publicRoutes = read('src/routes/public.ts');
const baseRoutes = read('src/routes/platform-v16.ts');
const assignment = read('src/routes/platform-v10.ts');
const ratings = read('src/routes/dispatch-v7.ts');
const scheduled = read('src/lib/scheduled-deliveries.ts');
const migration = read('migrations/0040_scheduled_delivery_dispatch.sql');

assert.match(front, /name="service_time_mode"/);
assert.match(front, /name="dispatch_mode"/);
assert.match(front, /Agendar data e horário/);
assert.match(front, /Não atribuir agora/);
assert.match(front, /data-address-autocomplete/);
assert.match(front, /ArrowDown/);
assert.match(front, /ArrowUp/);
assert.match(front, /Complemento \/ nome da loja/);
assert.match(front, /ratings-filter-bar/);
assert.match(front, /eligible-drivers\?include_all=1/);
assert.match(front, /assignFromBase\(r\.item\.id\)/);

assert.match(maps, /searchFreeAddressCandidates/);
assert.match(publicRoutes, /\/address\/autocomplete/);
assert.match(baseRoutes, /scheduled_for/);
assert.match(baseRoutes, /dispatch_mode/);
assert.match(assignment, /planned_driver_id/);
assert.match(assignment, /includes_all_active/);
assert.match(ratings, /date\(r\.created_at,'-3 hours'\)/);
assert.match(migration, /scheduled_for TEXT/);
assert.match(migration, /dispatch_mode TEXT/);
assert.match(front, /Já sou cliente/);
assert.match(front, /v32-customer-login/);
assert.match(baseRoutes, /processScheduledDeliveries\(c\.env,50\)/);
assert.match(scheduled, /ds\.scheduled_for IS NULL AND ds\.dispatch_mode='automatic'/);
assert.match(scheduled, /dispatch_processed_at IS NULL/);

console.log('ChegaJá 14.15.9: agendamento, busca, avaliações e atribuição após clonagem verificados.');
