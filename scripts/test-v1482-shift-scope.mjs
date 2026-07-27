import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const index = read('public/index.html');
const sw = read('public/sw.js');
const ui = read('public/chegaja-v148.js');
const api = read('src/routes/platform-v21.ts');
const migration = read('migrations/0037_schedule_base_scope_repair.sql');

assert.equal(pkg.version, '14.15.9');
assert.match(index, /chegaja-v148\.js\?v=14\.15\.9/);
assert.match(sw, /chegaja-14-15-9/);

// Base única: oculta contrato técnico e normaliza vínculos antigos.
assert.match(api, /isTechnicalBaseContract/);
assert.match(api, /technicalBaseContractToBase/);
assert.match(api, /baseByVirtualEstablishment/);
assert.match(api, /scope_repaired/);
assert.match(ui, /technicalContractToBase/);
assert.match(ui, /virtualBaseEstablishmentIds/);

// Horário é resolvido no escopo do local e recuperado por início/fim quando o cache está antigo.
assert.match(api, /findShiftForAssignmentV21/);
assert.match(api, /shiftScopePredicateV21/);
assert.match(api, /st\.start_time=\? AND st\.end_time=\?/);
assert.match(api, /O horário selecionado não pertence a este local ou foi alterado/);
assert.match(api, /UPDATE shift_templates[\s\S]*SET base_id=\?,contract_id=NULL,establishment_id=NULL/);

// Autosalvamento ignora resposta antiga e valida o horário no local escolhido.
assert.match(ui, /selectedShiftForRow/);
assert.match(ui, /requestRevision/);
assert.match(ui, /requestRevision!==Number\(save\.revision\|\|0\)/);
assert.match(ui, /Escolha novamente o horário deste local/);

// Alertas de deslocamento para contrato usam o estabelecimento correto.
assert.match(ui, /const contract=\(data\.contracts\|\|\[\]\)\.find/);
assert.match(ui, /location=contract\?\.establishment_id/);

// Migração cobre horário, rascunho e escala publicada.
assert.match(migration, /UPDATE shift_templates/);
assert.match(migration, /UPDATE schedule_week_rows/);
assert.match(migration, /UPDATE schedules/);
assert.match(migration, /lower\(trim\(ct\.name\)\) = 'base'/);

console.log('ChegaJá 14.15.9: escopo de horários e Base única OK');
