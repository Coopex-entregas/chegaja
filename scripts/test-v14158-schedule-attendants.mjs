import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const matrix = read('src/routes/platform-v21.ts');
const attendants = read('src/routes/platform-v16.ts');
const admin = read('src/routes/admin.ts');
const tenant = read('src/routes/ligerim.ts');
const app = read('public/app.js');
const ui = read('public/chegaja-final.js');
const index = read('public/index.html');
const sw = read('public/sw.js');

assert.equal(pkg.version, '14.15.9');
assert.match(index, /chegaja-final\.js\?v=14\.15\.9/);
assert.match(sw, /chegaja-14-15-9/);

// Uma grade que foi apenas aberta e ficou com FOLGAs automáticas é considerada vazia.
assert.match(matrix, /const targetIsPristine = !targetPublication/);
assert.match(matrix, /existingRows\.every/);
assert.match(matrix, /const shouldCopyPrevious = week >= currentMonday/);
assert.match(matrix, /copySource\.length > 0/);
assert.match(matrix, /UPDATE schedule_week_rows[\s\S]*SET active=0/);
assert.match(matrix, /Compatibilidade com escalas antigas já enviadas/);
assert.match(matrix, /previousPublishedResult/);
assert.match(matrix, /Cooperados novos[\s\S]*14[\s\S]*FOLGA/);
assert.match(matrix, /source\.contract_id/);
assert.match(matrix, /source\.base_id/);
assert.match(matrix, /source\.establishment_id/);
assert.match(matrix, /source\.shift_template_id/);
assert.match(matrix, /source\.start_time/);
assert.match(matrix, /source\.end_time/);

// Atendente pode ser criado já ligado à Base ou um operador existente pode ser vinculado.
assert.match(attendants, /available_users/);
assert.match(attendants, /body\.user_id/);
assert.match(attendants, /ON CONFLICT\(base_id,user_id\) DO UPDATE SET active=1/);
assert.match(admin, /A cooperativa possui mais de uma Base/);
assert.match(admin, /if\(bases\.length===1\)return bases\[0\]\.id/);
assert.match(admin, /INSERT INTO base_attendants/);
assert.match(admin, /base_name/);
assert.match(app, /Cadastrar atendente da Base/);
assert.match(app, /Base do atendente/);
assert.match(app, /Atendente da Base/);
assert.match(app, /state\.user\.role==='dispatcher'\?'bases':'dashboard'/);
assert.match(ui, /Vincular operador já cadastrado/);
assert.match(ui, /cadastrado e vinculado à Base/);
assert.match(tenant, /EXISTS\(SELECT 1 FROM base_attendants a WHERE a\.base_id=b\.id AND a\.user_id=\?/);
assert.match(tenant, /a\.base_id=x\.base_id AND a\.user_id=\?/);

// Prova a mudança exclusiva das datas: segunda 20/07 passa para segunda 27/07,
// mantendo o mesmo índice do dia e o mesmo horário/local.
const addDays = (date, days) => {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};
const previous = {week_start:'2026-07-20', day_index:0, base_id:'base-1', shift_template_id:'turno-1', start_time:'08:00', end_time:'12:00'};
const copied = {...previous, week_start:'2026-07-27', date:addDays('2026-07-27', previous.day_index)};
assert.equal(copied.date, '2026-07-27');
assert.equal(copied.base_id, previous.base_id);
assert.equal(copied.shift_template_id, previous.shift_template_id);
assert.equal(copied.start_time, previous.start_time);
assert.equal(copied.end_time, previous.end_time);

console.log('ChegaJá 14.15.9: cópia fiel da semana e acesso do atendente da Base verificados.');
