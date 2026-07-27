import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const section = (text, start, end) => {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `Trecho inicial não encontrado: ${start}`);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  assert.notEqual(to, -1, `Trecho final não encontrado: ${end}`);
  return text.slice(from, to);
};

const packageJson = JSON.parse(read('package.json'));
const index = read('public/index.html');
const app = read('public/app.js');
const css = read('public/chegaja-v145.css');
const ui = read('public/chegaja-v145.js');
const finalUi = read('public/chegaja-final.js');
const sw = read('public/sw.js');
const dispatch = read('src/routes/dispatch-v7.ts');
const legacy = read('src/routes/ligerim.ts');
const queueRoute = read('src/routes/platform-v10.ts');
const queueLib = read('src/lib/queue.ts');
const wait = read('src/routes/platform-v16.ts');
const history = read('src/routes/driver-experience.ts');
const schedule = read('src/routes/schedule-v8.ts');
const scheduleV19 = read('src/routes/platform-v19.ts');
const sos = read('src/routes/platform-v15.ts');
const operations = read('src/routes/operations.ts');
const migration33 = read('migrations/0033_establishment_schedule_sos_rules.sql');
const entry = read('src/index.ts');

// Versão e cache.
assert.equal(packageJson.version, '14.15.9');
assert.match(index, /chegaja-v145\.css\?v=14\.15\.9/);
assert.match(index, /chegaja-v145\.js\?v=14\.15\.9/);
assert.match(sw, /chegaja-14-15-9/);

// Modal: conteúdo acima da camada escura, sem blur e sem fechar por clique nos campos.
assert.match(app, /document\.body\.classList\.add\('modal-open'\)/);
assert.match(app, /event\.stopPropagation\(\);closeModal\(\)/);
assert.match(app, /\$\('#modal'\)\?\.addEventListener\('click',event=>event\.stopPropagation\(\)\)/);
assert.match(app, /function closeModal\(\)\{try\{stopQrScanner\(\)\}catch\{\}/);
assert.match(css, /#modal\.modal\{[^}]*z-index:2147483000!important/);
assert.match(css, /#modal \.modal-backdrop\{[^}]*pointer-events:none!important[^}]*backdrop-filter:none!important/);
assert.match(css, /#modal \.modal-card\{[^}]*background:#fff!important[^}]*pointer-events:auto!important/);
assert.match(css, /#modal \.modal-card input,[^}]*pointer-events:auto!important/);
assert.match(css, /#loading\.loading\{z-index:2147482000!important/);

// A Base deve consultar o catálogo real, mostrar estado de carregamento e erro recuperável.
assert.match(finalUi, /async function loadBaseCatalogV146\(\)/);
assert.match(finalUi, /api\('\/api\/app\/tenant\/bases'\)/);
assert.match(finalUi, /Carregando a Base…/);
assert.match(finalUi, /A Base não carregou/);
assert.match(finalUi, /v146-retry-base/);
assert.match(finalUi, /await loadBaseDashboard\(true\)/);
assert.match(legacy, /ligerimRoutes\.get\('\/tenant\/bases'/);

// Mapa principal e modal de nova entrega do estabelecimento.
assert.match(css, /\.cj14-est-grid\{grid-template-columns:minmax\(0,1fr\) 300px!important/);
assert.match(css, /\.cj14-est-map-card\{position:relative!important;width:100%!important;max-width:none!important/);
assert.match(ui, /Nova entrega do estabelecimento/);

// QR visível e imprimível.
assert.match(ui, /QR de check-in/);
assert.match(ui, /Imprimir QR/);
assert.match(ui, /profile\.checkin_token/);
assert.match(dispatch, /SELECT id,name,address,address_json,address_place_id,address_confirmed,latitude,longitude,city,state,postal_code,[\s\S]*checkin_token,queue_radius_meters/);

// Entrega do estabelecimento: preço automático e meios de pagamento exatos.
const establishmentOrder = section(dispatch, "dispatchV7Routes.post('/establishment/orders'", '// Base: administração da cooperativa cria e atribui.');
assert.match(establishmentOrder, /ratePerKmCents: Number\(establishment\.rate_per_km_cents/);
assert.match(establishmentOrder, /minimumFeeCents: Number\(establishment\.minimum_fee_cents/);
assert.doesNotMatch(establishmentOrder, /manualCharge|body\.charge_value/);
assert.match(establishmentOrder, /\['pix','dinheiro','cartao_credito','cartao_debito','vale_alimentacao','vale_refeicao','cortesia'\]/);
assert.match(dispatch, /const amountToCollect = input\.paymentMethod === 'cortesia' \? 0/);
assert.match(ui, /v19\/establishment\/quote/);
assert.match(ui, /A taxa da entrega é calculada automaticamente/);
assert.match(ui, /Não há cobrança de tempo de espera/);
assert.match(ui, /body\.payment_method==='cortesia'/);
assert.match(ui, /body\.amount_to_collect=0/);

// Fila/check-in somente nas proximidades, respeitando afastamento e bloqueio.
assert.match(migration33, /queue_radius_meters INTEGER NOT NULL DEFAULT 250/);
assert.match(queueRoute, /queue_radius_meters/);
assert.match(queueRoute, /distanceMeters/);
assert.match(queueRoute, /driver_establishment_blocks/);
assert.match(queueRoute, /COALESCE\(d\.on_leave,0\)=0/);
assert.match(legacy, /A leitura é aceita dentro de/);
assert.match(queueLib, /driver_establishment_blocks/);

// Entrega de estabelecimento sem espera.
assert.match(wait, /Entregas de estabelecimento não possuem cobrança de tempo de espera/);
assert.match(wait, /delivery_type==='establishment'/);
assert.match(wait, /charge_cents=0/);

// Canceladas aparecem no histórico, mas não entram em ganhos.
assert.match(history, /status==='delivered'/);
assert.match(history, /display_earnings_cents=item\.status==='delivered'/);
assert.match(history, /cancelled/);
assert.match(legacy, /d\.status='delivered'/);
assert.match(operations, /UPDATE financial_entries SET status='cancelled'/);
assert.match(migration33, /Entrega cancelada não gera ganho nem desconto/);

// INSS e SEST/SENAT em todas as entregas de estabelecimento concluídas.
assert.match(dispatch, /delivery\.delivery_type==='establishment'\|\|/);
assert.match(legacy, /delivery\.delivery_type==='establishment'\|\|/);
assert.match(migration33, /Toda entrega de estabelecimento desconta INSS e SEST\/SENAT/);

// Bloqueio também impede escala/troca.
assert.match(migration33, /CREATE TABLE IF NOT EXISTS driver_establishment_blocks/);
assert.match(schedule, /driver_establishment_blocks/);
assert.match(schedule, /está bloqueado/);
assert.match(scheduleV19, /await blocked\(/);
assert.match(entry, /platformV19Routes/);

// SOS: outros cooperados recebem, podem assumir e abrir a rota.
assert.match(sos, /platformV15Routes\.get\('\/v15\/sos\/active'/);
assert.match(sos, /s\.driver_id!=\?/);
assert.match(sos, /helper_driver_id IS NULL/);
assert.match(sos, /driver_sos_assignment/);
assert.match(sos, /assign-helper/);
assert.match(sos, /navigation_url/);
assert.match(ui, /setInterval\(\(\)=>\{if\(!document\.hidden\)pollDriverSos\(\)\},12000\)/);
assert.match(ui, /Ir ajudar/);
assert.match(ui, /VOCÊ FOI DESIGNADO/);
assert.match(ui, /Abrir rota/);

console.log('Regressões ChegaJá 14.15.9: modal, Base, estabelecimento, financeiro, bloqueios e SOS OK');
