import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const route=read('src/routes/platform-v10.ts');
const ui=read('public/chegaja-final.js');

assert.match(route,/guarantee_summary/);
assert.match(route,/guarantee_by_weekday/);
assert.match(route,/guarantee_items/);
assert.match(route,/COUNT\(DISTINCT date\(s\.end_at\)\) complement_days/);
assert.match(ui,/Complementos de garantido/);
assert.match(ui,/Vezes que houve complemento/);
assert.match(ui,/Complementos por dia da semana/);
assert.match(ui,/Exportar complementos CSV/);

const db=new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE schedules(id TEXT PRIMARY KEY,start_at TEXT,end_at TEXT,deleted_at TEXT);
  CREATE TABLE guarantee_settlements(
    id TEXT PRIMARY KEY,cooperative_id TEXT,schedule_id TEXT,driver_id TEXT,
    establishment_id TEXT,guaranteed_cents INTEGER,eligible_delivery_cents INTEGER,complement_cents INTEGER
  );
`);
const samples=[
  ['s1','2026-07-20 11:00:00','2026-07-20 13:00:00',11000,8000,3000],
  ['s2','2026-07-22 11:00:00','2026-07-22 13:00:00',11000,9000,2000],
  ['s3','2026-07-23 08:00:00','2026-07-23 10:00:00',11000,10000,1000],
  ['s4','2026-07-23 11:00:00','2026-07-23 13:00:00',11000,10000,1000],
  ['s5','2026-07-23 17:00:00','2026-07-23 19:00:00',11000,10000,1000],
  ['s6','2026-07-24 11:00:00','2026-07-24 13:00:00',11000,9500,1500],
  ['s7','2026-07-24 17:00:00','2026-07-24 19:00:00',11000,9500,1500]
];
for(const [scheduleId,start,end,guaranteed,eligible,complement] of samples){
  db.prepare(`INSERT INTO schedules VALUES (?,?,?,NULL)`).run(scheduleId,start,end);
  db.prepare(`INSERT INTO guarantee_settlements VALUES (?,?,?,?,?,?,?,?)`).run(`g-${scheduleId}`,'c',scheduleId,'d','e',guaranteed,eligible,complement);
}
const rows=db.prepare(`SELECT
    CAST(strftime('%w',s.end_at) AS INTEGER) weekday,
    COUNT(*) complement_count,
    COUNT(DISTINCT date(s.end_at)) complement_days,
    SUM(gs.complement_cents) complement_cents
  FROM guarantee_settlements gs
  JOIN schedules s ON s.id=gs.schedule_id AND s.deleted_at IS NULL
  WHERE gs.cooperative_id=? AND gs.establishment_id=? AND gs.complement_cents>0
    AND date(s.end_at) BETWEEN date(?) AND date(?)
  GROUP BY CAST(strftime('%w',s.end_at) AS INTEGER)
  ORDER BY CASE CAST(strftime('%w',s.end_at) AS INTEGER)
    WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 3 THEN 3 WHEN 4 THEN 4 WHEN 5 THEN 5 WHEN 6 THEN 6 ELSE 7 END
`).all('c','e','2026-07-20','2026-07-26');

assert.deepEqual(rows.map(row=>[Number(row.weekday),Number(row.complement_count),Number(row.complement_cents)]),[
  [1,1,3000],
  [3,1,2000],
  [4,3,3000],
  [5,2,3000]
]);
const summary=db.prepare(`SELECT COUNT(*) complement_count,COUNT(DISTINCT date(s.end_at)) complement_days,SUM(gs.complement_cents) complement_cents
  FROM guarantee_settlements gs JOIN schedules s ON s.id=gs.schedule_id
  WHERE gs.cooperative_id=? AND gs.establishment_id=? AND gs.complement_cents>0
    AND date(s.end_at) BETWEEN date(?) AND date(?)`).get('c','e','2026-07-20','2026-07-26');
assert.equal(Number(summary.complement_count),7);
assert.equal(Number(summary.complement_days),4);
assert.equal(Number(summary.complement_cents),11000);

console.log('ChegaJá 14.15.9: relatório de complementos por dia da semana aprovado.');
