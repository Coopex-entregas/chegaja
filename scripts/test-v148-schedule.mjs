import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const index = read('public/index.html');
const sw = read('public/sw.js');
const ui = read('public/chegaja-v148.js');
const css = read('public/chegaja-v148.css');
const matrix = read('src/routes/platform-v21.ts');
const tenant = read('src/routes/tenant.ts');
const swaps = read('src/routes/schedule-v8.ts');
const migration = read('migrations/0036_schedule_sort_shift_scope.sql');
const repairMigration = read('migrations/0037_schedule_base_scope_repair.sql');
const indexRoute = read('src/index.ts');

assert.equal(pkg.version, '14.15.9');
assert.match(index, /chegaja-v148\.css\?v=14\.15\.9/);
assert.match(index, /chegaja-v148\.js\?v=14\.15\.9/);
assert.match(sw, /chegaja-14-15-9/);

// Cooperados em lista vertical, seleção centralizada e filtros/ordenações.
assert.match(ui, /Um cooperado abaixo do outro/);
assert.match(ui, /data-cj148-select-driver/);
assert.match(ui, /Afastamento/);
assert.match(ui, /Bloqueios/);
assert.match(ui, /Ordem alfabética do cooperado/);
assert.match(ui, /Ordem de contrato \/ local/);
assert.match(ui, /Ordem de turno/);
assert.match(ui, /Ordem de dia \/ data/);
assert.match(css, /\.cj148-driver-list>button/);

// Exatamente 14 linhas padrão, extras removíveis e salvamento automático.
assert.match(matrix, /dayIndex < 7/);
assert.match(matrix, /rowOrder <= 2/);
assert.match(matrix, /As 14 linhas padrão não podem ser removidas/);
assert.match(ui, /salvamento automático/i);
assert.match(ui, /Acrescentar escala/);
assert.match(ui, /Remover esta escala extra/);

// Base/contrato/estabelecimento sem duplicidade técnica.
assert.match(matrix, /virtualBaseEstablishmentIds/);
assert.match(matrix, /contractEstablishmentIds/);
assert.match(ui, /contractEstablishmentIds/);
assert.match(ui, /BASE —/);

// Leques de horários vinculados ao contrato, Base ou estabelecimento.
assert.match(migration, /ADD COLUMN base_id/);
assert.match(repairMigration, /UPDATE shift_templates/);
assert.match(tenant, /ct\.name contract_name/);
assert.match(tenant, /contract_id:target\.contractId/);
assert.match(tenant, /normalizeShiftTemplateTarget/);
assert.match(ui, /CONTRATO —/);
assert.match(ui, /body\.target_type=targetType/);
assert.match(ui, /shiftsForAssignment/);
assert.doesNotMatch(ui, /if\(general\)return true/);
assert.match(matrix, /shiftFitsAssignmentV21/);
assert.match(matrix, /O horário selecionado não pertence a este local ou foi alterado/);

// Alertas: repetição, sobreposição e deslocamento, sem impedir a escala.
assert.match(ui, /escalas no turno/);
assert.match(ui, /Sobreposição de/);
assert.match(ui, /Sem tempo de deslocamento/);
assert.match(ui, /a\.location!==b\.location/);
assert.match(matrix, /Não há tempo de deslocamento; a escala foi mantida/);

// Quantidades por local/horário e exportação apenas no acesso interno da cooperativa.
assert.match(ui, /QUANTIDADE POR CONTRATO E HORÁRIO/);
assert.match(ui, /isManager\(\)\?'<button class="btn" id="cj148-export"/);
assert.match(ui, /Exportar Excel/);
assert.match(ui, /Imprimir \/ PDF/);

// Trocas respeitam afastamentos/bloqueios e retornam alertas de encaixe.
assert.match(swaps, /assertSwapEligible/);
assert.match(swaps, /driver_establishment_blocks/);
assert.match(swaps, /está afastado na data desta escala/);
assert.match(swaps, /swapFitWarningsV148/);
assert.match(swaps, /sem tempo de deslocamento/);
assert.match(swaps, /warnings:\[\.\.\.new Set\(warnings\)\]/);

// 14.15.9: contratos voltaram a ser consultáveis para montar os horários; preços antigos continuam bloqueados.
assert.doesNotMatch(indexRoute, /\^\\\/api\\\/app\\\/contracts\(\?:/);
assert.match(indexRoute, /contract-prices/);
assert.match(ui, /Carregando contratos e horários/);
assert.match(ui, /data-cj148-new-for/);
assert.match(ui, /applyView\(data,\{sort:false\}\)/);
assert.match(css, /body\.cj143-base \.v31-map-card\{width:100%/);

console.log('ChegaJá 14.15.9: mapa amplo, horários restaurados e edição estável da escala OK');
