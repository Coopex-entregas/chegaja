import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');


import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const require=createRequire(import.meta.url);
let ts;try{ts=require('typescript');}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');}

class Prepared{
  constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}
  bind(...args){return new Prepared(this.db,this.sql,args);}
  all(){return {results:this.db.prepare(this.sql).all(...this.args)};}
  first(){return this.db.prepare(this.sql).get(...this.args)||null;}
  run(){const result=this.db.prepare(this.sql).run(...this.args);return {meta:{changes:Number(result.changes||0)}};}
}
class D1{
  constructor(db){this.db=db;}
  prepare(sql){return new Prepared(this.db,sql);}
  async batch(statements){this.db.exec('BEGIN');try{const out=statements.map(statement=>statement.run());this.db.exec('COMMIT');return out;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
function loadGuarantees(){
  const source=read('src/lib/guarantees.ts');
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:'guarantees.ts'}).outputText;
  const module={exports:{}};
  const localRequire=id=>id==='./financial-settlement'?{reconcileDriverFinancialBalance:async()=>({})}:require(id);
  new Function('exports','module','require',output)(module.exports,module,localRequire);
  return module.exports;
}

// Teste funcional: o mesmo cooperado possui dois horários no mesmo estabelecimento,
// com garantidos independentes e cada corrida entra em apenas um turno.
{
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE cooperatives(id TEXT PRIMARY KEY,inss_percent REAL,sest_senat_percent REAL);
    CREATE TABLE establishments(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE bases(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE schedules(id TEXT PRIMARY KEY,cooperative_id TEXT,driver_id TEXT,establishment_id TEXT,base_id TEXT,shift_template_id TEXT,start_at TEXT,end_at TEXT,guaranteed_cents INTEGER,status TEXT,deleted_at TEXT);
    CREATE TABLE guarantee_turn_adjustments(schedule_id TEXT PRIMARY KEY,declared_total_cents INTEGER,notes TEXT);
    CREATE TABLE deliveries(id TEXT PRIMARY KEY,cooperative_id TEXT,assigned_driver_id TEXT,establishment_id TEXT,delivery_type TEXT,status TEXT,deleted_at TEXT,accepted_at TEXT,created_at TEXT,delivered_at TEXT,driver_gross_cents INTEGER,driver_earnings_cents INTEGER,charge_cents INTEGER,cooperative_fee_cents INTEGER,guarantee_schedule_id TEXT,updated_at TEXT);
    CREATE TABLE guarantee_settlements(id TEXT PRIMARY KEY,cooperative_id TEXT,schedule_id TEXT UNIQUE,driver_id TEXT,establishment_id TEXT,base_id TEXT,guaranteed_cents INTEGER,eligible_delivery_cents INTEGER,complement_cents INTEGER,financial_entry_id TEXT,settled_at TEXT);
    CREATE TABLE financial_entries(id TEXT PRIMARY KEY,cooperative_id TEXT,driver_id TEXT,establishment_id TEXT,delivery_id TEXT,entry_type TEXT,category TEXT,description TEXT,amount_cents INTEGER,settled_cents INTEGER,reference_date TEXT,status TEXT,deleted_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT);
    CREATE TABLE guarantee_settlement_financial_entries(settlement_id TEXT,entry_kind TEXT,financial_entry_id TEXT,PRIMARY KEY(settlement_id,entry_kind));
  `);
  db.prepare(`INSERT INTO cooperatives VALUES ('c',4,0.5)`).run();
  db.prepare(`INSERT INTO establishments VALUES ('e','Restaurante')`).run();
  db.prepare(`INSERT INTO schedules VALUES ('s1','c','d','e',NULL,'h1','2026-07-20T11:00:00','2026-07-20T15:00:00',8000,'completed',NULL)`).run();
  db.prepare(`INSERT INTO schedules VALUES ('s2','c','d','e',NULL,'h2','2026-07-20T17:00:00','2026-07-20T22:00:00',10000,'completed',NULL)`).run();
  db.prepare(`INSERT INTO deliveries VALUES ('x1','c','d','e','establishment','delivered',NULL,'2026-07-20T15:00:00Z','2026-07-20T14:50:00Z','2026-07-20T15:30:00Z',6000,6000,6000,0,NULL,NULL)`).run();
  db.prepare(`INSERT INTO deliveries VALUES ('x2','c','d','e','establishment','delivered',NULL,'2026-07-20T21:00:00Z','2026-07-20T20:50:00Z','2026-07-20T21:30:00Z',13000,13000,13000,0,NULL,NULL)`).run();
  const guarantees=loadGuarantees(),env={DB:new D1(db)};
  const first=await guarantees.recalculateGuaranteeSettlement(env,'c','s1');
  const second=await guarantees.recalculateGuaranteeSettlement(env,'c','s2');
  assert.equal(first.eligible_cents,6000);assert.equal(first.complement_cents,2000);
  assert.equal(second.eligible_cents,13000);assert.equal(second.complement_cents,0);
  assert.equal(db.prepare(`SELECT guarantee_schedule_id FROM deliveries WHERE id='x1'`).get().guarantee_schedule_id,'s1');
  assert.equal(db.prepare(`SELECT guarantee_schedule_id FROM deliveries WHERE id='x2'`).get().guarantee_schedule_id,'s2');
}


// Regressão 14.15.9: entrega de balcão lançada às 12:46 (15:46 UTC) deve
// pertencer ao turno 11h–17h mesmo que tenha sido aceita depois do horário.
// O total usa o crédito financeiro da corrida e o complemento completa R$ 110,00.
{
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE cooperatives(id TEXT PRIMARY KEY,inss_percent REAL,sest_senat_percent REAL);
    CREATE TABLE establishments(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE bases(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE schedules(id TEXT PRIMARY KEY,cooperative_id TEXT,driver_id TEXT,establishment_id TEXT,base_id TEXT,shift_template_id TEXT,start_at TEXT,end_at TEXT,guaranteed_cents INTEGER,status TEXT,deleted_at TEXT);
    CREATE TABLE guarantee_turn_adjustments(schedule_id TEXT PRIMARY KEY,declared_total_cents INTEGER,notes TEXT);
    CREATE TABLE deliveries(id TEXT PRIMARY KEY,cooperative_id TEXT,assigned_driver_id TEXT,establishment_id TEXT,delivery_type TEXT,status TEXT,deleted_at TEXT,accepted_at TEXT,created_at TEXT,delivered_at TEXT,driver_gross_cents INTEGER,driver_earnings_cents INTEGER,charge_cents INTEGER,cooperative_fee_cents INTEGER,guarantee_schedule_id TEXT,updated_at TEXT);
    CREATE TABLE guarantee_settlements(id TEXT PRIMARY KEY,cooperative_id TEXT,schedule_id TEXT UNIQUE,driver_id TEXT,establishment_id TEXT,base_id TEXT,guaranteed_cents INTEGER,eligible_delivery_cents INTEGER,complement_cents INTEGER,financial_entry_id TEXT,settled_at TEXT);
    CREATE TABLE financial_entries(id TEXT PRIMARY KEY,cooperative_id TEXT,driver_id TEXT,establishment_id TEXT,delivery_id TEXT,entry_type TEXT,category TEXT,description TEXT,amount_cents INTEGER,settled_cents INTEGER,reference_date TEXT,status TEXT,deleted_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT);
    CREATE TABLE guarantee_settlement_financial_entries(settlement_id TEXT,entry_kind TEXT,financial_entry_id TEXT,PRIMARY KEY(settlement_id,entry_kind));
  `);
  db.prepare(`INSERT INTO cooperatives VALUES ('c',4,0.5)`).run();
  db.prepare(`INSERT INTO establishments VALUES ('e','CHINA IN BOX PONTA NEGRA')`).run();
  db.prepare(`INSERT INTO schedules VALUES ('s','c','d','e',NULL,'h','2026-07-24T11:00:00','2026-07-24T17:00:00',11000,'completed',NULL)`).run();
  db.prepare(`INSERT INTO deliveries VALUES ('x','c','d','e','establishment','delivered',NULL,'2026-07-24T20:30:00Z','2026-07-24T15:46:00Z','2026-07-24T20:40:00Z',0,0,3664,0,NULL,NULL)`).run();
  db.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,deleted_at) VALUES ('fd','c','d','e','x','credit','delivery','Entrega CB-000001',3664,0,'2026-07-24','open',NULL)`).run();
  const guarantees=loadGuarantees(),env={DB:new D1(db)};
  const result=await guarantees.recalculateGuaranteeSettlement(env,'c','s');
  assert.equal(result.eligible_cents,3664);
  assert.equal(result.complement_cents,7336);
  assert.equal(db.prepare(`SELECT guarantee_schedule_id FROM deliveries WHERE id='x'`).get().guarantee_schedule_id,'s');
  const complement=db.prepare(`SELECT f.amount_cents,f.entry_type,f.category FROM financial_entries f JOIN guarantee_settlement_financial_entries l ON l.financial_entry_id=f.id WHERE l.entry_kind='complement'`).get();
  assert.equal(complement.amount_cents,7336);
  assert.equal(complement.entry_type,'credit');
  assert.equal(complement.category,'delivery');
  const production=db.prepare(`SELECT SUM(amount_cents) total FROM financial_entries WHERE driver_id='d' AND entry_type='credit' AND status!='cancelled' AND deleted_at IS NULL`).get();
  assert.equal(production.total,11000);
}

const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.version,'14.15.9');

const migration=read('migrations/0043_shift_template_guarantees.sql');
assert.match(migration,/ALTER TABLE shift_templates ADD COLUMN guaranteed_cents/);
assert.match(migration,/idx_deliveries_guarantee_schedule/);
assert.match(migration,/UPDATE establishment_daily_guarantees SET active=0/);

const admin=read('src/routes/admin.ts');
assert.match(admin,/shift_templates_json/);
assert.match(admin,/syncEstablishmentShiftTemplates/);
assert.match(admin,/guaranteed_cents/);

const tenant=read('src/routes/tenant.ts');
assert.match(tenant,/guaranteed_value/);
assert.match(tenant,/UPDATE schedule_week_rows SET start_time=\?,end_time=\?,shift_label=\?,guaranteed_cents=\?/);

const guarantees=read('src/lib/guarantees.ts');
assert.match(guarantees,/guarantee_schedule_id/);
assert.doesNotMatch(guarantees,/establishment_daily_guarantees/);
assert.match(guarantees,/Cada corrida pertence a um único turno/);
assert.match(guarantees,/datetime\(COALESCE\(deliveries\.created_at/);
assert.match(guarantees,/SELECT MAX\(f\.amount_cents\)/);

const turnClosings=read('src/routes/platform-v22.ts');
assert.match(turnClosings,/Atualiza individualmente os turnos exibidos/);
assert.match(turnClosings,/recalculateGuaranteeSettlement/);

const ui=read('public/chegaja-final.js');
assert.match(ui,/Horários e garantidos do estabelecimento/);
assert.match(ui,/Garantido deste horário/);
assert.match(ui,/shift_templates_json/);
assert.match(ui,/O mesmo cooperado pode ter vários horários/);

const reports=read('src/routes/platform-v10.ts');
assert.match(reports,/guarantee_summary/);
assert.match(reports,/guarantee_by_weekday/);
assert.match(reports,/COUNT\(DISTINCT date\(s\.end_at\)\) complement_days/);
assert.match(ui,/Complementos de garantido/);
assert.match(ui,/Vezes que houve complemento/);
assert.match(ui,/Complementos por dia da semana/);

console.log('ChegaJá 14.15.9: produção e relatório semanal de complementos verificados.');
