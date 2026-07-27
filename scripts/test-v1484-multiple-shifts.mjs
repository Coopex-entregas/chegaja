import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const index = read('public/index.html');
const sw = read('public/sw.js');
const ui = read('public/chegaja-v148.js');
const tenant = read('src/routes/tenant.ts');
const migration = read('migrations/0039_shift_template_single_target.sql');

assert.equal(pkg.version, '14.15.9');
assert.match(index, /chegaja-v148\.js\?v=14\.15\.9/);
assert.match(sw, /chegaja-14-15-9/);

assert.match(ui, /body\.target_type=targetType/);
assert.match(ui, /body\.target_id=targetId/);
assert.doesNotMatch(ui, /body\.contract_id=kind==='contract'/);
assert.match(ui, /Você pode cadastrar outros horários para o mesmo local/);
assert.match(ui, /Vários horários por local/);

assert.match(tenant, /normalizeShiftTemplateTarget/);
assert.match(tenant, /target_type/);
assert.match(tenant, /target_id/);
assert.match(tenant, /sem impedir o cadastro de vários horários/);
assert.match(tenant, /INSERT INTO shift_templates/);
assert.doesNotMatch(tenant, /Esse horário já está cadastrado/);

assert.match(migration, /UPDATE shift_templates/);
assert.match(migration, /SET contract_id = NULL/);
assert.match(migration, /SET establishment_id = NULL/);
assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/);

console.log('ChegaJá 14.15.9: vários horários por local e alvo único OK');
