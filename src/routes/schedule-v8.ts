import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { audit } from '../lib/audit';
import { assertRole, bodyJson, cleanText, id, intValue, nullableText, saoPauloDate, toCents } from '../lib/util';

export const scheduleV8Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

export const permissionModules = [
  ['dashboard','Visão geral'],['users','Usuários'],['establishments','Estabelecimentos'],['drivers','Cooperados'],
  ['bases','Bases'],['services','Serviços adicionais'],['shifts','Horários dos estabelecimentos'],
  ['schedules','Escalas'],['attendance','Check-in e check-out'],['deliveries','Entregas'],['tracking','Cooperados online'],
  ['financial','Ganhos e descontos'],['closings','Fechamento semanal'],['advances','Adiantamentos'],['credits','Créditos de clientes'],
  ['integrations','Integrações e API'],['settings','Configurações']
] as const;

function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validTime(value: string): boolean { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function combine(date: string, time: string, nextDay = false): string {
  if (!nextDay) return `${date}T${time}:00`;
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0,10)}T${time}:00`;
}
function canManage(auth: AuthUser): boolean { return ['cooperative_admin','dispatcher'].includes(auth.role); }

async function targetFromBody(c: Context<AppBindings>, cooperativeId: string, b: Row, before?: Row) {
  const baseId = nullableText(b.base_id ?? before?.base_id, 100);
  const establishmentId = nullableText(b.establishment_id ?? before?.establishment_id, 100);
  if (baseId) {
    const base = await c.env.DB.prepare(`SELECT id FROM bases WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(baseId, cooperativeId).first();
    if (!base) throw new Error('Base inválida para esta cooperativa.');
    return { contractId: null, baseId, establishmentId: null };
  }
  if (establishmentId) {
    const establishment = await c.env.DB.prepare(`SELECT id FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(establishmentId, cooperativeId).first();
    if (!establishment) throw new Error('Estabelecimento inválido para esta cooperativa.');
    return { contractId: null, baseId: null, establishmentId };
  }
  throw new Error('Selecione o estabelecimento ou a Base.');
}

async function scheduleValues(c: Context<AppBindings>, auth: AuthUser, b: Row, before?: Row) {
  const cooperativeId = auth.cooperativeId || before?.cooperative_id;
  if (!cooperativeId) throw new Error('Cooperativa não identificada.');
  const driverId = cleanText(b.driver_id ?? before?.driver_id, 100);
  const driver = await c.env.DB.prepare(`SELECT id,name,on_leave,leave_start_date,leave_return_date FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`)
    .bind(driverId, cooperativeId).first();
  if (!driver) throw new Error('Cooperado inválido ou inativo.');

  const target = await targetFromBody(c, cooperativeId, b, before);
  let date = cleanText(b.date || String(b.start_at || before?.start_at || '').slice(0,10), 10);
  let startTime = cleanText(b.start_time || String(b.start_at || before?.start_at || '').slice(11,16), 5);
  let endTime = cleanText(b.end_time || String(b.end_at || before?.end_at || '').slice(11,16), 5);
  const templateId = nullableText(b.shift_template_id ?? before?.shift_template_id, 100);
  let shiftLabel = nullableText(b.shift_label ?? before?.shift_label, 100);
  let templateGuaranteedCents: number | null = null;
  if (templateId) {
    const template = await c.env.DB.prepare(`SELECT st.*,ct.establishment_id contract_establishment_id FROM shift_templates st LEFT JOIN contracts ct ON ct.id=st.contract_id AND ct.deleted_at IS NULL WHERE st.id=? AND st.cooperative_id=? AND st.active=1 AND st.deleted_at IS NULL`)
      .bind(templateId, cooperativeId).first<Row>();
    if (!template) throw new Error('Horário fixo inválido.');
    const templateEstablishment=template.establishment_id||template.contract_establishment_id||null;
    if (templateEstablishment && target.establishmentId && templateEstablishment !== target.establishmentId) throw new Error('Este horário pertence a outro estabelecimento.');
    if (template.base_id && target.baseId && template.base_id !== target.baseId) throw new Error('Este horário pertence a outra Base.');
    if (templateEstablishment && target.baseId) throw new Error('Selecione um horário cadastrado para a Base.');
    if (template.base_id && target.establishmentId) throw new Error('Selecione um horário cadastrado para este estabelecimento.');
    startTime = template.start_time; endTime = template.end_time; shiftLabel = template.shift_label;
    templateGuaranteedCents = target.baseId ? 0 : Math.max(0, Number(template.guaranteed_cents || 0));
  }
  if (!validDate(date) || !validTime(startTime) || !validTime(endTime)) throw new Error('Informe data, hora inicial e hora final válidas.');
  if (Number((driver as Row).on_leave||0)===1 && (!(driver as Row).leave_start_date || date>=String((driver as Row).leave_start_date)) && (!(driver as Row).leave_return_date || date<String((driver as Row).leave_return_date))) throw new Error(`${(driver as Row).name||'O cooperado'} está afastado nesta data.`);
  if (target.establishmentId) { const block=await c.env.DB.prepare(`SELECT reason FROM driver_establishment_blocks WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1 LIMIT 1`).bind(cooperativeId,driverId,target.establishmentId).first<Row>(); if(block) throw new Error(`Cooperado bloqueado neste estabelecimento${block.reason?`: ${block.reason}`:''}.`); }
  const startAt = combine(date, startTime);
  const endAt = combine(date, endTime, endTime <= startTime);
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) throw new Error('O horário final precisa ser posterior ao inicial.');
  return {
    cooperativeId, driverId, ...target, templateId, shiftLabel: shiftLabel || 'TURNO',
    date, startTime, endTime, startAt, endAt,
    status: cleanText(b.status ?? before?.status ?? 'scheduled', 30),
    guaranteedCents: templateGuaranteedCents !== null
      ? templateGuaranteedCents
      : (target.baseId ? 0 : (b.guaranteed_value !== undefined ? Math.max(0,toCents(b.guaranteed_value)) : Number(before?.guaranteed_cents || 0))),
    notes: nullableText(b.notes ?? before?.notes, 1000),
    sortOrder: Math.max(0, intValue(b.sort_order ?? before?.sort_order, 0))
  };
}

async function conflictFor(c: Context<AppBindings>, driverId: string, startAt: string, endAt: string, excludeId?: string) {
  let sql = `SELECT s.id,s.start_at,s.end_at,COALESCE(b.name,e.name,'Sem local') local_name
    FROM schedules s LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN establishments e ON e.id=s.establishment_id
    WHERE s.driver_id=? AND s.deleted_at IS NULL AND s.status!='cancelled' AND COALESCE(s.entry_type,'work')='work' AND datetime(s.start_at)<datetime(?) AND datetime(s.end_at)>datetime(?)`;
  const params: any[] = [driverId,endAt,startAt];
  if (excludeId) { sql += ` AND s.id<>?`; params.push(excludeId); }
  sql += ` ORDER BY s.start_at LIMIT 5`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return rows.results || [];
}


async function travelAttention(c: Context<AppBindings>, driverId:string, startAt:string, endAt:string, baseId:string|null, establishmentId:string|null, excludeId?:string){
  let sql=`SELECT s.id,s.start_at,s.end_at,s.base_id,s.establishment_id,COALESCE(b.name,e.name,'outro local') local_name FROM schedules s LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN establishments e ON e.id=s.establishment_id WHERE s.driver_id=? AND s.deleted_at IS NULL AND s.status!='cancelled' AND COALESCE(s.entry_type,'work')='work'`;
  const params:any[]=[driverId];if(excludeId){sql+=' AND s.id<>?';params.push(excludeId);}sql+=` AND (datetime(s.end_at) BETWEEN datetime(?,'-45 minutes') AND datetime(?) OR datetime(s.start_at) BETWEEN datetime(?) AND datetime(?,'+45 minutes'))`;
  const rows=await c.env.DB.prepare(sql).bind(...params,startAt,startAt,endAt,endAt).all<Row>();const warnings:string[]=[];
  for(const row of rows.results||[]){const same=(baseId&&row.base_id===baseId)||(establishmentId&&row.establishment_id===establishmentId);if(same)continue;const before=(new Date(startAt).getTime()-new Date(row.end_at).getTime())/60000,after=(new Date(row.start_at).getTime()-new Date(endAt).getTime())/60000,gap=before>=0?before:after;if(gap>=0&&gap<45)warnings.push(`ATENÇÃO: apenas ${Math.round(gap)} min para deslocamento até/de ${row.local_name}.`)}return [...new Set(warnings)];
}

async function assertSwapEligible(c:Context<AppBindings>,cooperativeId:string,driverId:string,schedule:Row){
  const date=String(schedule.start_at||'').slice(0,10);const driver=await c.env.DB.prepare(`SELECT name,status,on_leave,leave_start_date,leave_return_date FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(driverId,cooperativeId).first<Row>();
  if(!driver||driver.status!=='active')throw new Error('Um dos cooperados está inativo.');
  if(Number(driver.on_leave||0)===1&&(!driver.leave_start_date||date>=String(driver.leave_start_date))&&(!driver.leave_return_date||date<String(driver.leave_return_date)))throw new Error(`${driver.name} está afastado na data desta escala.`);
  if(schedule.establishment_id){const block=await c.env.DB.prepare(`SELECT reason FROM driver_establishment_blocks WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1 LIMIT 1`).bind(cooperativeId,driverId,schedule.establishment_id).first<Row>();if(block)throw new Error(`${driver.name} está bloqueado no estabelecimento desta escala${block.reason?`: ${block.reason}`:''}.`);}
}


function scheduleLocationKeyV148(schedule:Row):string{
  if(schedule.base_id)return `base:${schedule.base_id}`;
  if(schedule.establishment_id)return `establishment:${schedule.establishment_id}`;
  return '';
}

async function swapFitWarningsV148(c:Context<AppBindings>,cooperativeId:string,driverId:string,incoming:Row,excludedScheduleId?:string):Promise<string[]>{
  let sql=`SELECT s.id,s.start_at,s.end_at,s.base_id,s.establishment_id,COALESCE(b.name,e.name,'outro local') local_name
    FROM schedules s LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN establishments e ON e.id=s.establishment_id
    WHERE s.cooperative_id=? AND s.driver_id=? AND s.deleted_at IS NULL AND s.status!='cancelled'
      AND COALESCE(s.entry_type,'work')='work' AND s.id<>?`;
  const params:any[]=[cooperativeId,driverId,incoming.id];
  if(excludedScheduleId){sql+=` AND s.id<>?`;params.push(excludedScheduleId);}
  sql+=` AND date(s.start_at) BETWEEN date(?,'-1 day') AND date(?,'+1 day') ORDER BY s.start_at`;
  params.push(incoming.start_at,incoming.end_at);
  const existing=await c.env.DB.prepare(sql).bind(...params).all<Row>();
  const warnings:string[]=[];
  const incomingStart=new Date(incoming.start_at).getTime(),incomingEnd=new Date(incoming.end_at).getTime();
  const incomingLocation=scheduleLocationKeyV148(incoming);
  for(const row of existing.results||[]){
    const rowStart=new Date(row.start_at).getTime(),rowEnd=new Date(row.end_at).getTime();
    if(incomingStart<rowEnd&&rowStart<incomingEnd){
      const minutes=Math.max(1,Math.round((Math.min(incomingEnd,rowEnd)-Math.max(incomingStart,rowStart))/60000));
      warnings.push(`ATENÇÃO: a troca deixará o cooperado em horários sobrepostos por ${minutes} min.`);
      continue;
    }
    const rowLocation=scheduleLocationKeyV148(row);
    if(!incomingLocation||!rowLocation||incomingLocation===rowLocation)continue;
    const before=(incomingStart-rowEnd)/60000;
    const after=(rowStart-incomingEnd)/60000;
    const gap=before>=0?before:after;
    if(gap>=0&&gap<=45){
      warnings.push(gap===0
        ? `ATENÇÃO: após a troca, o cooperado termina em ${row.local_name} e começa no outro local no mesmo horário, sem tempo de deslocamento.`
        : `ATENÇÃO: após a troca, o cooperado terá somente ${Math.round(gap)} min para deslocamento entre locais.`);
    }
  }
  return [...new Set(warnings)];
}

scheduleV8Routes.get('/permissions/modules', (c) => {
  const auth = c.get('auth'); assertRole(auth,['cooperative_admin','dispatcher']);
  return c.json({ ok:true, items: permissionModules.map(([key,name])=>({key,name})) });
});

scheduleV8Routes.get('/users/:id/permissions', async (c) => {
  const auth = c.get('auth'); assertRole(auth,['cooperative_admin']);
  const user = await c.env.DB.prepare(`SELECT id,cooperative_id,role FROM users WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<Row>();
  if (!user || user.cooperative_id !== auth.cooperativeId || user.role === 'platform_admin') return c.json({ok:false,error:'Usuário não encontrado.'},404);
  const rows = await c.env.DB.prepare(`SELECT module_key,can_view,can_create,can_edit,can_delete FROM user_permissions WHERE user_id=? ORDER BY module_key`).bind(user.id).all();
  return c.json({ok:true,items:rows.results,custom:Boolean(rows.results?.length)});
});

scheduleV8Routes.put('/users/:id/permissions', async (c) => {
  const auth = c.get('auth'); assertRole(auth,['cooperative_admin']);
  const user = await c.env.DB.prepare(`SELECT id,cooperative_id,role FROM users WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<Row>();
  if (!user || user.cooperative_id !== auth.cooperativeId || user.role === 'platform_admin') return c.json({ok:false,error:'Usuário não encontrado.'},404);
  const body = await bodyJson<Row>(c);
  const items = Array.isArray(body.permissions) ? body.permissions : [];
  const allowed = new Set(permissionModules.map(([key])=>key));
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`DELETE FROM user_permissions WHERE user_id=?`).bind(user.id)];
  for (const item of items) {
    const moduleKey = cleanText(item.module_key,50);
    if (!allowed.has(moduleKey as any)) continue;
    const establishmentScheduleReadOnly = user.role === 'establishment' && moduleKey === 'schedules';
    statements.push(c.env.DB.prepare(`INSERT INTO user_permissions (user_id,cooperative_id,module_key,can_view,can_create,can_edit,can_delete) VALUES (?,?,?,?,?,?,?)`)
      .bind(user.id,user.cooperative_id,moduleKey,item.can_view?1:0,establishmentScheduleReadOnly?0:(item.can_create?1:0),establishmentScheduleReadOnly?0:(item.can_edit?1:0),establishmentScheduleReadOnly?0:(item.can_delete?1:0)));
  }
  await c.env.DB.batch(statements);
  await audit(c,'update','user_permissions',user.id,null,{permissions:items},user.cooperative_id);
  return c.json({ok:true});
});

scheduleV8Routes.get('/schedule-grid', async (c) => {
  const auth = c.get('auth');
  assertRole(auth,['cooperative_admin','dispatcher','establishment','driver']);
  const from = cleanText(c.req.query('from') || saoPauloDate(),10);
  const to = cleanText(c.req.query('to') || from,10);
  const order = c.req.query('order') === 'alphabetical'
    ? `d.name COLLATE NOCASE,date(s.start_at),s.start_at`
    : `date(s.start_at),COALESCE(b.name,e.name,''),CASE WHEN s.sort_order=0 THEN 999999 ELSE s.sort_order END,s.start_at,d.name`;
  let sql = `SELECT s.*,d.name driver_name,d.status driver_status,CASE WHEN d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-10 minutes') THEN 1 ELSE 0 END driver_online,d.last_seen_at,NULL contract_name,e.name establishment_name,b.name base_name,st.name shift_name,
    CASE WHEN EXISTS(SELECT 1 FROM schedules x WHERE x.id<>s.id AND x.driver_id=s.driver_id AND x.deleted_at IS NULL AND x.status!='cancelled' AND COALESCE(x.entry_type,'work')='work' AND datetime(x.start_at)<datetime(s.end_at) AND datetime(x.end_at)>datetime(s.start_at)) THEN 1 ELSE 0 END has_conflict
    FROM schedules s JOIN drivers d ON d.id=s.driver_id
    LEFT JOIN establishments e ON e.id=s.establishment_id LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN shift_templates st ON st.id=s.shift_template_id
    WHERE s.cooperative_id=? AND s.deleted_at IS NULL AND date(s.start_at) BETWEEN date(?) AND date(?)`;
  const params:any[]=[auth.cooperativeId,from,to];
  if (auth.role==='driver') { sql += ` AND s.driver_id=?`; params.push(auth.driverId); }
  if (auth.role==='establishment') { sql += ` AND s.establishment_id=?`; params.push(auth.establishmentId); }
  if (c.req.query('establishment_id')) { sql += ` AND s.establishment_id=?`; params.push(c.req.query('establishment_id')); }
  if (c.req.query('driver_id')) { sql += ` AND s.driver_id=?`; params.push(c.req.query('driver_id')); }
  sql += ` ORDER BY ${order}`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ok:true,items:rows.results});
});

scheduleV8Routes.post('/schedule-grid', async (c) => {
  const auth = c.get('auth'); assertRole(auth,['cooperative_admin','dispatcher']);
  const body = await bodyJson<Row>(c);
  const values = await scheduleValues(c,auth,body);
  const conflicts = await conflictFor(c,values.driverId,values.startAt,values.endAt);
  if (conflicts.length && !body.allow_conflict) return c.json({ok:false,error:'O cooperado já possui escala nesse mesmo horário.',conflict:true,conflicts},409);
  let sortOrder = values.sortOrder;
  if (!sortOrder) {
    const max = await c.env.DB.prepare(`SELECT COALESCE(MAX(sort_order),0)+1 next_order FROM schedules WHERE cooperative_id=? AND deleted_at IS NULL AND date(start_at)=date(?) AND COALESCE(establishment_id,'')=COALESCE(?,'') AND COALESCE(base_id,'')=COALESCE(?,'')`)
      .bind(values.cooperativeId,values.date,values.establishmentId,values.baseId).first<{next_order:number}>();
    sortOrder = Number(max?.next_order || 1);
  }
  const scheduleId = id();
  await c.env.DB.prepare(`INSERT INTO schedules (id,cooperative_id,establishment_id,driver_id,start_at,end_at,status,guaranteed_cents,notes,created_by,contract_id,shift_template_id,shift_label,base_id,sort_order,conflict_flag) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(scheduleId,values.cooperativeId,values.establishmentId,values.driverId,values.startAt,values.endAt,values.status,values.guaranteedCents,values.notes,auth.id,null,values.templateId,values.shiftLabel,values.baseId,sortOrder,conflicts.length?1:0).run();
  const warnings=await travelAttention(c,values.driverId,values.startAt,values.endAt,values.baseId,values.establishmentId);
  await audit(c,'create','schedule',scheduleId,null,{...values,sortOrder,conflicts:conflicts.length,warnings},values.cooperativeId);
  return c.json({ok:true,id:scheduleId,conflict:Boolean(conflicts.length),warnings},201);
});

scheduleV8Routes.put('/schedule-grid/:id', async (c) => {
  const auth = c.get('auth'); assertRole(auth,['cooperative_admin','dispatcher']);
  const before = await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if (!before) return c.json({ok:false,error:'Escala não encontrada.'},404);
  const body = await bodyJson<Row>(c);
  const values = await scheduleValues(c,auth,body,before);
  const conflicts = await conflictFor(c,values.driverId,values.startAt,values.endAt,before.id);
  if (conflicts.length && !body.allow_conflict) return c.json({ok:false,error:'O cooperado já possui outra escala nesse mesmo horário.',conflict:true,conflicts},409);
  await c.env.DB.prepare(`UPDATE schedules SET driver_id=?,establishment_id=?,base_id=?,contract_id=?,shift_template_id=?,shift_label=?,start_at=?,end_at=?,status=?,guaranteed_cents=?,notes=?,sort_order=?,conflict_flag=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(values.driverId,values.establishmentId,values.baseId,null,values.templateId,values.shiftLabel,values.startAt,values.endAt,values.status,values.guaranteedCents,values.notes,values.sortOrder,conflicts.length?1:0,before.id).run();
  const warnings=await travelAttention(c,values.driverId,values.startAt,values.endAt,values.baseId,values.establishmentId,before.id);
  await audit(c,'update','schedule',before.id,before,{...values,conflicts:conflicts.length,warnings},values.cooperativeId);
  return c.json({ok:true,conflict:Boolean(conflicts.length),warnings});
});

scheduleV8Routes.delete('/schedule-grid/:id', async (c) => {
  const auth = c.get('auth'); assertRole(auth,['cooperative_admin','dispatcher']);
  const before = await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if (!before) return c.json({ok:false,error:'Escala não encontrada.'},404);
  await c.env.DB.prepare(`UPDATE schedules SET status='cancelled',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(before.id).run();
  await audit(c,'delete','schedule',before.id,before,null,before.cooperative_id);
  return c.json({ok:true});
});

scheduleV8Routes.post('/schedule-grid/:id/clone', async (c) => {
  const auth = c.get('auth'); assertRole(auth,['cooperative_admin','dispatcher']);
  const before = await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if (!before) return c.json({ok:false,error:'Escala não encontrada.'},404);
  const body=await bodyJson<Row>(c), date=cleanText(body.date||String(before.start_at).slice(0,10),10);
  const values=await scheduleValues(c,auth,{...before,date,start_time:String(before.start_at).slice(11,16),end_time:String(before.end_at).slice(11,16),sort_order:Number(before.sort_order||0)+1});
  const newId=id();
  await c.env.DB.prepare(`INSERT INTO schedules (id,cooperative_id,establishment_id,driver_id,start_at,end_at,status,guaranteed_cents,notes,created_by,contract_id,shift_template_id,shift_label,base_id,sort_order,conflict_flag) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
    .bind(newId,values.cooperativeId,values.establishmentId,values.driverId,values.startAt,values.endAt,'scheduled',values.guaranteedCents,values.notes,auth.id,null,values.templateId,values.shiftLabel,values.baseId,values.sortOrder).run();
  return c.json({ok:true,id:newId},201);
});

scheduleV8Routes.get('/schedule-swaps/options', async (c) => {
  const auth=c.get('auth'); assertRole(auth,['driver']);
  const rows=await c.env.DB.prepare(`SELECT s.id,s.driver_id,d.name driver_name,s.start_at,s.end_at,s.shift_label,COALESCE(b.name,e.name,'Sem local') local_name
    FROM schedules s JOIN drivers d ON d.id=s.driver_id LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN establishments e ON e.id=s.establishment_id
    WHERE s.cooperative_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work' AND d.status='active'
      AND (COALESCE(d.on_leave,0)=0
        OR (d.leave_start_date IS NOT NULL AND date(s.start_at)<date(d.leave_start_date))
        OR (d.leave_return_date IS NOT NULL AND date(s.start_at)>=date(d.leave_return_date)))
      AND datetime(s.start_at)>=datetime('now','-3 hours')
      AND (s.driver_id=? OR s.establishment_id IS NULL OR NOT EXISTS(
        SELECT 1 FROM driver_establishment_blocks deb
         WHERE deb.cooperative_id=s.cooperative_id AND deb.driver_id=? AND deb.establishment_id=s.establishment_id AND deb.active=1
      ))
    ORDER BY s.start_at,d.name LIMIT 500`)
    .bind(auth.cooperativeId,auth.driverId,auth.driverId).all();
  return c.json({ok:true,items:rows.results});
});

scheduleV8Routes.get('/schedule-swaps', async (c) => {
  const auth=c.get('auth'); assertRole(auth,['cooperative_admin','dispatcher','driver']);
  let sql=`SELECT r.*,sd.name requester_name,td.name target_name,ss.start_at source_start,ss.end_at source_end,ss.shift_label source_shift,ts.start_at target_start,ts.end_at target_end,ts.shift_label target_shift,
    COALESCE(sb.name,se.name,'Sem local') source_local,COALESCE(tb.name,te.name,'Sem local') target_local
    FROM schedule_swap_requests r JOIN drivers sd ON sd.id=r.requested_by_driver_id JOIN drivers td ON td.id=r.requested_to_driver_id
    JOIN schedules ss ON ss.id=r.source_schedule_id JOIN schedules ts ON ts.id=r.target_schedule_id
    LEFT JOIN bases sb ON sb.id=ss.base_id LEFT JOIN establishments se ON se.id=ss.establishment_id
    LEFT JOIN bases tb ON tb.id=ts.base_id LEFT JOIN establishments te ON te.id=ts.establishment_id
    WHERE r.cooperative_id=?`;
  const params:any[]=[auth.cooperativeId];
  if(auth.role==='driver'){sql+=` AND (r.requested_by_driver_id=? OR r.requested_to_driver_id=?)`;params.push(auth.driverId,auth.driverId);}
  const from=cleanText(c.req.query('from'),10),to=cleanText(c.req.query('to'),10),status=cleanText(c.req.query('status'),20);
  if(from){if(!validDate(from))return c.json({ok:false,error:'Data inicial inválida.'},400);sql+=` AND date(r.created_at,'-3 hours')>=date(?)`;params.push(from);}
  if(to){if(!validDate(to))return c.json({ok:false,error:'Data final inválida.'},400);sql+=` AND date(r.created_at,'-3 hours')<=date(?)`;params.push(to);}
  if(status){if(!['pending','accepted','rejected','cancelled'].includes(status))return c.json({ok:false,error:'Status inválido.'},400);sql+=` AND r.status=?`;params.push(status);}
  sql+=` ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 1000`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

scheduleV8Routes.post('/schedule-swaps', async (c) => {
  const auth=c.get('auth');assertRole(auth,['driver']);const b=await bodyJson<Row>(c);
  const source=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND driver_id=? AND cooperative_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND datetime(start_at)>=datetime('now','-3 hours')`).bind(cleanText(b.source_schedule_id,100),auth.driverId,auth.cooperativeId).first<Row>();
  const target=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND cooperative_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND datetime(start_at)>=datetime('now','-3 hours')`).bind(cleanText(b.target_schedule_id,100),auth.cooperativeId).first<Row>();
  if(!source||!target||source.id===target.id||target.driver_id===auth.driverId)return c.json({ok:false,error:'Selecione a sua escala e uma escala válida de outro cooperado.'},400);
  await assertSwapEligible(c,auth.cooperativeId!,auth.driverId!,target);await assertSwapEligible(c,auth.cooperativeId!,target.driver_id,source);
  const warnings=[
    ...await swapFitWarningsV148(c,auth.cooperativeId!,auth.driverId!,target,source.id),
    ...await swapFitWarningsV148(c,auth.cooperativeId!,target.driver_id,source,target.id),
  ];
  const existing=await c.env.DB.prepare(`SELECT * FROM schedule_swap_requests WHERE cooperative_id=? AND status='pending' AND ((source_schedule_id=? AND target_schedule_id=?) OR (source_schedule_id=? AND target_schedule_id=?)) ORDER BY created_at LIMIT 1`)
    .bind(auth.cooperativeId,source.id,target.id,target.id,source.id).first<Row>();
  if(existing){
    const reciprocal=existing.source_schedule_id===target.id&&existing.target_schedule_id===source.id&&existing.requested_to_driver_id===auth.driverId;
    return c.json({ok:true,existing:true,reciprocal,request_id:existing.id,action_required:reciprocal?'accept':null,message:reciprocal?'O outro cooperado já pediu esta mesma troca. Confirme para aceitar.':'Esta troca já possui uma solicitação pendente.'});
  }
  const swapId=id();
  try{await c.env.DB.prepare(`INSERT INTO schedule_swap_requests (id,cooperative_id,source_schedule_id,target_schedule_id,requested_by_driver_id,requested_to_driver_id,message) VALUES (?,?,?,?,?,?,?)`).bind(swapId,auth.cooperativeId,source.id,target.id,auth.driverId,target.driver_id,nullableText(b.message,500)).run();}
  catch{return c.json({ok:false,error:'Já existe uma solicitação pendente para essas escalas.'},409);}
  return c.json({ok:true,id:swapId,warnings:[...new Set(warnings)]},201);
});

scheduleV8Routes.post('/schedule-swaps/:id/respond', async (c) => {
  const auth=c.get('auth');assertRole(auth,['driver']);const b=await bodyJson<Row>(c),decision=cleanText(b.decision,20);
  const request=await c.env.DB.prepare(`SELECT * FROM schedule_swap_requests WHERE id=? AND requested_to_driver_id=? AND status='pending'`).bind(c.req.param('id'),auth.driverId).first<Row>();
  if(!request)return c.json({ok:false,error:'Solicitação não encontrada ou já respondida.'},404);
  if(!['accepted','rejected'].includes(decision))return c.json({ok:false,error:'Resposta inválida.'},400);
  let responseWarnings:string[]=[];
  if(decision==='accepted'){
    const source=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND driver_id=? AND deleted_at IS NULL`).bind(request.source_schedule_id,request.requested_by_driver_id).first<Row>();
    const target=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND driver_id=? AND deleted_at IS NULL`).bind(request.target_schedule_id,request.requested_to_driver_id).first<Row>();
    if(!source||!target)return c.json({ok:false,error:'Uma das escalas foi alterada. Faça uma nova solicitação.'},409);
    await assertSwapEligible(c,request.cooperative_id,request.requested_to_driver_id,source);await assertSwapEligible(c,request.cooperative_id,request.requested_by_driver_id,target);
    const warnings=[
      ...await swapFitWarningsV148(c,request.cooperative_id,request.requested_to_driver_id,source,target.id),
      ...await swapFitWarningsV148(c,request.cooperative_id,request.requested_by_driver_id,target,source.id),
    ];
    responseWarnings=[...new Set(warnings)];
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE schedules SET driver_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(request.requested_to_driver_id,source.id),
      c.env.DB.prepare(`UPDATE schedules SET driver_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(request.requested_by_driver_id,target.id),
      c.env.DB.prepare(`UPDATE schedule_swap_requests SET status='accepted',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(request.id),
      c.env.DB.prepare(`UPDATE schedule_swap_requests SET status='cancelled',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id<>? AND status='pending' AND (source_schedule_id IN (?,?) OR target_schedule_id IN (?,?))`).bind(request.id,source.id,target.id,source.id,target.id)
    ]);
  }else await c.env.DB.prepare(`UPDATE schedule_swap_requests SET status='rejected',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(request.id).run();
  return c.json({ok:true,warnings:responseWarnings});
});

scheduleV8Routes.post('/schedule-swaps/direct', async (c) => {
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);const b=await bodyJson<Row>(c);
  const a=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND cooperative_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND COALESCE(entry_type,'work')='work'`).bind(cleanText(b.source_schedule_id,100),auth.cooperativeId).first<Row>();
  const z=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND cooperative_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND COALESCE(entry_type,'work')='work'`).bind(cleanText(b.target_schedule_id,100),auth.cooperativeId).first<Row>();
  if(!a||!z||a.id===z.id)return c.json({ok:false,error:'Selecione duas escalas de trabalho válidas.'},400);
  if(String(a.driver_id)===String(z.driver_id))return c.json({ok:false,error:'Selecione escalas de cooperados diferentes.'},400);
  await assertSwapEligible(c,auth.cooperativeId!,z.driver_id,a);await assertSwapEligible(c,auth.cooperativeId!,a.driver_id,z);
  const warnings=[
    ...await swapFitWarningsV148(c,auth.cooperativeId!,z.driver_id,a,z.id),
    ...await swapFitWarningsV148(c,auth.cooperativeId!,a.driver_id,z,a.id),
  ];
  const directSwapId=id();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO schedule_swap_requests(id,cooperative_id,source_schedule_id,target_schedule_id,requested_by_driver_id,requested_to_driver_id,message,status,responded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'accepted',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(directSwapId,auth.cooperativeId,a.id,z.id,a.driver_id,z.driver_id,`Troca direta realizada por ${auth.name}.`),
    c.env.DB.prepare(`UPDATE schedules SET driver_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(z.driver_id,a.id),
    c.env.DB.prepare(`UPDATE schedules SET driver_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(a.driver_id,z.id),
    c.env.DB.prepare(`UPDATE schedule_swap_requests SET status='cancelled',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id<>? AND status='pending' AND (source_schedule_id IN (?,?) OR target_schedule_id IN (?,?))`).bind(directSwapId,a.id,z.id,a.id,z.id)
  ]);
  await audit(c,'swap','schedule',a.id,a,{source_schedule_id:a.id,target_schedule_id:z.id},auth.cooperativeId||undefined);
  return c.json({ok:true,warnings:[...new Set(warnings)]});
});

scheduleV8Routes.post('/schedule-swaps/:id/cancel', async (c) => {
  const auth=c.get('auth');assertRole(auth,['driver']);
  const result=await c.env.DB.prepare(`UPDATE schedule_swap_requests SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND requested_by_driver_id=? AND status='pending'`).bind(c.req.param('id'),auth.driverId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Solicitação não encontrada.'},404);
  return c.json({ok:true});
});
