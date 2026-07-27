import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require=createRequire(import.meta.url);
let ts;
try{ts=require('typescript');}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');}
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function loadFinancialModule(){
  const source=read('src/lib/financial-settlement.ts');
  const transpiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:'financial-settlement.ts'}).outputText;
  const module={exports:{}};
  new Function('exports','module','require',transpiled)(module.exports,module,require);
  return module.exports;
}

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

const financial=loadFinancialModule();
assert.equal(financial.baseReceivablePayment('pix_cooperativa'),true);
assert.equal(financial.baseReceivablePayment('credit'),true);
assert.equal(financial.baseReceivablePayment('credito_automatico'),true);
assert.equal(financial.baseReceivablePayment('crédito automático'),true);
assert.equal(financial.baseReceivablePayment('pix'),false);
assert.equal(financial.baseReceivablePayment('dinheiro'),false);
assert.equal(financial.baseReceivablePayment('cartao_credito'),false);
assert.equal(financial.cleanFinancialDescription('Rateio • lote 31df2eb4'),'Rateio');
assert.equal(financial.carryoverDescription('Rateio • lote abc','2026-07-20','2026-07-26'),'Rateio • restante da semana 20/07/2026 a 26/07/2026');

function financeDb(){
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE weekly_closings(id TEXT PRIMARY KEY,cooperative_id TEXT,week_end TEXT,status TEXT);
    CREATE TABLE deliveries(id TEXT PRIMARY KEY,delivery_type TEXT,payment_method TEXT);
    CREATE TABLE financial_entries(
      id TEXT PRIMARY KEY,cooperative_id TEXT,driver_id TEXT,delivery_id TEXT,
      entry_type TEXT,category TEXT,description TEXT,amount_cents INTEGER,
      settled_cents INTEGER DEFAULT 0,status TEXT DEFAULT 'open',deduction_order INTEGER,
      reference_date TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
  `);
  return {db,env:{DB:new D1(db)}};
}
function addDelivery(db,id,type,payment){db.prepare('INSERT INTO deliveries VALUES (?,?,?)').run(id,type,payment);}
function addEntry(db,{id,delivery=null,type,category,amount,status='open',settled=0,description=category,date='2026-07-23',order=0}){
  db.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,status,deduction_order,reference_date) VALUES (?,'coop','driver',?,?,?,?,?,?,?,?,?)`)
    .run(id,delivery,type,category,description,amount,settled,status,order,date);
}

// Base em PIX comum/dinheiro: produção já recebida, não paga rateios e o saldo fica negativo.
{
  const {db,env}=financeDb();addDelivery(db,'b1','base','pix');
  addEntry(db,{id:'credit',delivery:'b1',type:'credit',category:'delivery',amount:24503,status:'paid',settled:24503,description:'Entrega BASE-1 • recebido diretamente pelo cooperado'});
  addEntry(db,{id:'rateio',type:'debit',category:'Rateio',amount:24300,description:'Rateio • lote 31df2eb4'});
  const result=await financial.reconcileDriverFinancialBalance(env,'coop','driver');
  const credit=db.prepare('SELECT * FROM financial_entries WHERE id=?').get('credit');
  const debit=db.prepare('SELECT * FROM financial_entries WHERE id=?').get('rateio');
  assert.equal(credit.status,'paid');assert.equal(credit.settled_cents,24503);
  assert.equal(debit.status,'open');assert.equal(debit.settled_cents,0);assert.equal(debit.description,'Rateio');
  assert.equal(result.balance_cents,-24300);
}

// Produção de estabelecimento: forma saldo, mas crédito e rateio só são baixados ao fechar a semana.
{
  const {db,env}=financeDb();addDelivery(db,'e1','establishment','pix');
  addEntry(db,{id:'credit',delivery:'e1',type:'credit',category:'delivery',amount:24503,description:'Entrega EST-1'});
  addEntry(db,{id:'rateio',type:'debit',category:'Rateio',amount:24300,description:'Rateio'});
  const result=await financial.reconcileDriverFinancialBalance(env,'coop','driver');
  const credit=db.prepare('SELECT * FROM financial_entries WHERE id=?').get('credit');
  const debit=db.prepare('SELECT * FROM financial_entries WHERE id=?').get('rateio');
  assert.equal(credit.status,'open');assert.equal(credit.settled_cents,0);
  assert.equal(debit.status,'open');assert.equal(debit.settled_cents,0);
  assert.equal(result.balance_cents,203);
}

// Ordem usada pelo fechamento: INSS, SEST/SENAT, adiantamento, rateio, demais despesas.
assert.equal(financial.financialDebitPriority('INSS'),10);
assert.equal(financial.financialDebitPriority('SEST/SENAT'),20);
assert.equal(financial.financialDebitPriority('advance','Adiantamento'),30);
assert.equal(financial.financialDebitPriority('Rateio'),40);
assert.equal(financial.financialDebitPriority('despesa'),50);

// Cancelar a produção antes do fechamento deixa o desconto integralmente pendente.
{
  const {db,env}=financeDb();addDelivery(db,'e1','establishment','pix');
  addEntry(db,{id:'credit',delivery:'e1',type:'credit',category:'delivery',amount:5000,description:'Entrega EST-2'});
  addEntry(db,{id:'rateio',type:'debit',category:'Rateio',amount:3000,description:'Rateio'});
  await financial.reconcileDriverFinancialBalance(env,'coop','driver');
  db.prepare("UPDATE financial_entries SET status='cancelled' WHERE id='credit'").run();
  const result=await financial.reconcileDriverFinancialBalance(env,'coop','driver');
  const debit=db.prepare('SELECT status,settled_cents FROM financial_entries WHERE id=?').get('rateio');
  assert.equal(debit.status,'open');assert.equal(debit.settled_cents,0);assert.equal(result.balance_cents,-3000);
}

// Todas as migrações, incluindo a 0044, precisam abrir em SQLite limpo.
{
  const db=new DatabaseSync(':memory:');
  const files=fs.readdirSync(path.join(root,'migrations')).filter(x=>x.endsWith('.sql')).sort();
  for(const file of files)db.exec(read(`migrations/${file}`));
  assert.equal(files.at(-1),'0044_master_maps_driver_registry.sql');
}

const maps=read('src/lib/maps.ts'),publicRoute=read('src/routes/public.ts'),ui=read('public/chegaja-final.js'),settlement=read('src/lib/financial-settlement.ts'),closing=read('src/routes/ligerim.ts'),migration=read('migrations/0041_financial_receivable_settlement.sql'),pkg=JSON.parse(read('package.json'));
assert.match(maps,/place\/textsearch\/json/);
assert.match(maps,/Rio Grande do Norte|stateValue/);
assert.match(publicRoute,/scope:city\?'city':'state'/);
assert.match(publicRoute,/if\(numberMatch&&city\)/);
assert.match(ui,/Produção para fechamento/);
assert.match(ui,/Produção já recebida/);
assert.match(ui,/SALDO PENDENTE/);
assert.match(settlement,/restante da semana/);
assert.match(closing,/carryoverDescription/);
assert.doesNotMatch(ui,/lote 31df2eb4/);
assert.match(migration,/Base recebida diretamente não sofre INSS nem SEST\/SENAT/);
assert.equal(pkg.version,'14.15.9');

console.log('OK: regras financeiras 14.15.9, saldo negativo, liquidação, prioridade, cancelamento, migrações e busca estadual.');
