import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const index = read('public/index.html');
const sw = read('public/sw.js');
const matrix = read('src/routes/platform-v21.ts');
const queue = read('src/routes/platform-v10.ts');
const ui = read('public/chegaja-final.js');
const scheduleUi = read('public/chegaja-v148.js');

assert.equal(pkg.version, '14.15.9');
assert.match(index, /chegaja-final\.js\?v=14\.15\.9/);
assert.match(index, /chegaja-v148\.js\?v=14\.15\.9/);
assert.match(sw, /chegaja-14-15-9/);

// Semana nova recebe a grade imediatamente anterior, sem afetar semanas já iniciadas.
assert.match(matrix, /const previousWeek = addDays\(week, -7\)/);
assert.match(matrix, /FROM schedule_week_rows[\s\S]*week_start=\?[\s\S]*active=1/);
assert.match(matrix, /const shouldCopyPrevious = week >= currentMonday/);
assert.match(matrix, /targetIsPristine/);
assert.match(matrix, /UPDATE schedule_week_rows[\s\S]*SET active=0/);
assert.match(matrix, /previousPublishedResult/);
assert.match(matrix, /previousRowsResult\.results/);
assert.match(matrix, /Cooperados[\s\S]*novos/);
assert.match(matrix, /existing\.add\(key\)/);
assert.match(scheduleUi, /cópia fiel da semana anterior/);
assert.match(scheduleUi, /Cooperados novos entram com 14 linhas em FOLGA/);

// A posição é calculada dentro de cada fila e exibida no painel do cooperado.
assert.match(queue, /ROW_NUMBER\(\) OVER/);
assert.match(queue, /queue_position/);
assert.match(queue, /COUNT\(\*\) OVER/);
assert.match(queue, /queue_total/);
assert.match(ui, /Você é o \$\{queuePosition\}º da fila/);
assert.match(ui, /cooperados aguardando/);
assert.match(ui, /position:active\.queue_position,total:active\.queue_total/);

console.log('ChegaJá 14.15.9: cópia automática da escala e posição na fila OK');

// Confere o cálculo real de posição por local usando o mesmo recurso de janela do D1/SQLite.
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE waiting_queue(id TEXT,cooperative_id TEXT,base_id TEXT,establishment_id TEXT,driver_id TEXT,status TEXT,queue_order INTEGER,arrived_at TEXT);
  CREATE TABLE drivers(id TEXT,name TEXT);
  CREATE TABLE bases(id TEXT,name TEXT);
  CREATE TABLE establishments(id TEXT,name TEXT);
  INSERT INTO drivers VALUES ('d1','Um'),('d2','Dois'),('d3','Três');
  INSERT INTO bases VALUES ('b1','Coopex Entregas');
  INSERT INTO waiting_queue VALUES
    ('q1','c1','b1',NULL,'d1','waiting',1,'2026-07-25 08:00:00'),
    ('q2','c1','b1',NULL,'d2','waiting',2,'2026-07-25 08:01:00'),
    ('q3','c1','b1',NULL,'d3','waiting',3,'2026-07-25 08:02:00');
`);
const ranked = db.prepare(`
  SELECT ranked.* FROM (
    SELECT q.*,COALESCE(b.name,e.name) location_name,
      ROW_NUMBER() OVER(PARTITION BY COALESCE(q.base_id,''),COALESCE(q.establishment_id,'') ORDER BY CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END,datetime(q.arrived_at),q.id) queue_position,
      COUNT(*) OVER(PARTITION BY COALESCE(q.base_id,''),COALESCE(q.establishment_id,'')) queue_total
    FROM waiting_queue q
    LEFT JOIN establishments e ON e.id=q.establishment_id
    LEFT JOIN bases b ON b.id=q.base_id
    WHERE q.cooperative_id=? AND q.status='waiting'
  ) ranked WHERE ranked.driver_id=? LIMIT 1
`).get('c1','d2');
assert.equal(Number(ranked.queue_position),2);
assert.equal(Number(ranked.queue_total),3);
db.close();
console.log('ChegaJá 14.15.9: consulta real da posição 2 de 3 na fila OK');
