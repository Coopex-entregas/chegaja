import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { assertRole, bodyJson, cleanText, id, nullableText, toCents } from '../lib/util';
import { reconcileDriverFinancialBalance } from '../lib/financial-settlement';
import { recalculateGuaranteeSettlement } from '../lib/guarantees';

export const platformV22Routes=new Hono<AppBindings>();
type Row=Record<string,any>;

function tenant(c:Context<AppBindings>,roles:AuthUser['role'][]){const auth=c.get('auth');assertRole(auth,roles);if(!auth.cooperativeId)throw new Error('Cooperativa não vinculada.');return auth;}
function normalizeIds(value:unknown):string[]{return [...new Set((Array.isArray(value)?value:[]).map(x=>cleanText(x,100)).filter(Boolean))];}
function allocations(total:number,count:number,mode:string):number[]{
  if(count<=0)return[];
  if(mode==='per_driver')return Array.from({length:count},()=>total);
  const base=Math.floor(total/count),remainder=total-base*count;
  return Array.from({length:count},(_,index)=>base+(index<remainder?1:0));
}
async function financialLocation(c:Context<AppBindings>,cooperativeId:string,key:string):Promise<string|null>{
  if(!key||key==='general')return null;
  if(key.startsWith('est:')){const est=await c.env.DB.prepare(`SELECT id FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(key.slice(4),cooperativeId).first<Row>();if(!est)throw new Error('Estabelecimento inválido.');return String(est.id);}
  if(key.startsWith('base:')){const base=await c.env.DB.prepare(`SELECT virtual_establishment_id FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(key.slice(5),cooperativeId).first<Row>();if(!base?.virtual_establishment_id)throw new Error('Base inválida.');return String(base.virtual_establishment_id);}
  throw new Error('Local inválido.');
}

platformV22Routes.post('/tenant/weekly-close/manual-entry',async c=>{
  const auth=tenant(c,['cooperative_admin']);
  const body=await bodyJson<Row>(c),driverIds=normalizeIds(body.driver_ids),entryType=cleanText(body.entry_type,20),mode=cleanText(body.allocation_mode||'per_driver',30);
  if(!driverIds.length)return c.json({ok:false,error:'Selecione pelo menos um cooperado.'},400);
  if(!['credit','debit'].includes(entryType))return c.json({ok:false,error:'Escolha ganho ou desconto.'},400);
  if(!['per_driver','divide_total'].includes(mode))return c.json({ok:false,error:'Forma de distribuição inválida.'},400);
  const amount=toCents(body.amount);if(amount<=0)return c.json({ok:false,error:'Informe um valor maior que zero.'},400);
  const description=cleanText(body.description,500)||(entryType==='credit'?'Ganho manual':'Imposto ou rateio');
  const drivers=await c.env.DB.prepare(`SELECT id,name FROM drivers WHERE cooperative_id=? AND deleted_at IS NULL AND status='active' AND id IN (${driverIds.map(()=>'?').join(',')})`).bind(auth.cooperativeId,...driverIds).all<Row>();
  if((drivers.results||[]).length!==driverIds.length)return c.json({ok:false,error:'Um dos cooperados selecionados não está ativo.'},400);
  const values=allocations(amount,driverIds.length,mode),establishmentId=await financialLocation(c,auth.cooperativeId!,cleanText(body.location_key,150));
  const coop=await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>();
  const applyInss=entryType==='credit'&&Boolean(body.apply_inss),applySest=entryType==='credit'&&Boolean(body.apply_sest_senat);
  const category=entryType==='credit'?cleanText(body.category||'manual_gain',80):cleanText(body.category||'rateio',80);
  const referenceDate=cleanText(body.reference_date,10)||new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const statements:D1PreparedStatement[]=[];
  let total=0;
  driverIds.forEach((driverId,index)=>{
    const value=values[index];total+=value;
    statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by)
      VALUES (?,?,?,?,?,?,?,?,0,?,'open',?)`).bind(id(),auth.cooperativeId,driverId,establishmentId,entryType,category,description,value,referenceDate,auth.id));
    if(applyInss){const tax=Math.round(value*Math.max(0,Number(coop?.inss_percent||0))/100);if(tax>0)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,'debit','INSS',?,?,0,?,'open',?)`).bind(id(),auth.cooperativeId,driverId,establishmentId,`INSS sobre ganho • ${description}`,tax,referenceDate,auth.id));}
    if(applySest){const tax=Math.round(value*Math.max(0,Number(coop?.sest_senat_percent||0))/100);if(tax>0)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,'debit','SEST/SENAT',?,?,0,?,'open',?)`).bind(id(),auth.cooperativeId,driverId,establishmentId,`SEST/SENAT sobre ganho • ${description}`,tax,referenceDate,auth.id));}
  });
  for(let i=0;i<statements.length;i+=75)await c.env.DB.batch(statements.slice(i,i+75));
  for(const driverId of driverIds)await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,driverId);
  return c.json({ok:true,selected_count:driverIds.length,total_cents:total,entry_type:entryType});
});

platformV22Routes.get('/tenant/establishments/:id/guarantees',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);
  const establishmentId=auth.role==='establishment'?auth.establishmentId:cleanText(c.req.param('id'),100);
  if(!establishmentId)return c.json({ok:false,error:'Estabelecimento não informado.'},400);
  const est=await c.env.DB.prepare(`SELECT id,name FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(establishmentId,auth.cooperativeId).first<Row>();
  if(!est)return c.json({ok:false,error:'Estabelecimento não encontrado.'},404);
  const rows=await c.env.DB.prepare(`SELECT id,name,start_time,end_time,shift_label,guaranteed_cents,active FROM shift_templates WHERE establishment_id=? AND cooperative_id=? AND deleted_at IS NULL ORDER BY start_time,end_time,name`).bind(establishmentId,auth.cooperativeId).all<Row>();
  return c.json({ok:true,establishment:est,items:rows.results||[]});
});

platformV22Routes.get('/establishment/turn-closings',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),from=cleanText(c.req.query('from')||today,10),to=cleanText(c.req.query('to')||today,10);
  let establishmentId=auth.role==='establishment'?auth.establishmentId:cleanText(c.req.query('establishment_id'),100);

  // Atualiza individualmente os turnos exibidos. Assim, mesmo que existam mais de
  // 500 turnos pendentes no banco, a tela sempre refaz o cálculo do período filtrado
  // antes de mostrar corridas e complemento.
  let dueSql=`SELECT s.id FROM schedules s
    WHERE s.cooperative_id=? AND s.establishment_id IS NOT NULL AND s.base_id IS NULL
      AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed','completed')
      AND COALESCE(s.guaranteed_cents,0)>0
      AND date(s.start_at) BETWEEN date(?) AND date(?)
      AND datetime(s.end_at)<=datetime('now','-3 hours')`;
  const dueParams:any[]=[auth.cooperativeId,from,to];
  if(establishmentId){dueSql+=` AND s.establishment_id=?`;dueParams.push(establishmentId);}
  dueSql+=` ORDER BY s.start_at LIMIT 1500`;
  const dueRows=await c.env.DB.prepare(dueSql).bind(...dueParams).all<Row>();
  for(const row of dueRows.results||[]){
    try{await recalculateGuaranteeSettlement(c.env,auth.cooperativeId!,String(row.id));}
    catch(error){console.warn('Falha ao atualizar turno filtrado:',error instanceof Error?error.message:String(error));}
  }

  let sql=`SELECT s.id schedule_id,s.start_at,s.end_at,s.status,s.driver_id,d.name driver_name,s.establishment_id,e.name establishment_name,
      COALESCE(s.guaranteed_cents,0) guaranteed_cents,
      COALESCE(a.declared_total_cents,gs.eligible_delivery_cents,0) eligible_delivery_cents,
      a.declared_total_cents adjusted_total_cents,a.notes adjustment_notes,gs.complement_cents,gs.financial_entry_id,
      st.name shift_template_name,st.shift_label,
      sr.score rating_score,sr.comment rating_comment
    FROM schedules s JOIN drivers d ON d.id=s.driver_id JOIN establishments e ON e.id=s.establishment_id
    LEFT JOIN shift_templates st ON st.id=s.shift_template_id
    LEFT JOIN guarantee_turn_adjustments a ON a.schedule_id=s.id
    LEFT JOIN guarantee_settlements gs ON gs.schedule_id=s.id
    LEFT JOIN shift_ratings sr ON sr.schedule_id=s.id
    WHERE s.cooperative_id=? AND s.establishment_id IS NOT NULL AND s.base_id IS NULL AND s.deleted_at IS NULL
      AND date(s.start_at) BETWEEN date(?) AND date(?)`;
  const params:any[]=[auth.cooperativeId,from,to];
  if(establishmentId){sql+=` AND s.establishment_id=?`;params.push(establishmentId);}
  sql+=` ORDER BY s.start_at DESC,d.name`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all<Row>();
  return c.json({ok:true,from,to,items:(rows.results||[]).map(row=>({...row,complement_cents:Math.max(0,Number(row.guaranteed_cents||0)-Number(row.eligible_delivery_cents||0))}))});
});

platformV22Routes.post('/establishment/turn-closings/:id/adjust',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);const body=await bodyJson<Row>(c),scheduleId=cleanText(c.req.param('id'),100),total=toCents(body.total_value);
  const schedule=await c.env.DB.prepare(`SELECT s.*,e.name establishment_name FROM schedules s JOIN establishments e ON e.id=s.establishment_id WHERE s.id=? AND s.cooperative_id=? AND s.establishment_id IS NOT NULL AND s.base_id IS NULL AND s.deleted_at IS NULL`).bind(scheduleId,auth.cooperativeId).first<Row>();
  if(!schedule||(auth.role==='establishment'&&schedule.establishment_id!==auth.establishmentId))return c.json({ok:false,error:'Turno não encontrado.'},404);
  if(new Date(`${schedule.end_at}Z`).getTime()>Date.now()+3*3600000)return c.json({ok:false,error:'O total só pode ser confirmado depois do fim do turno.'},409);
  const closed=await c.env.DB.prepare(`SELECT MAX(week_end) week_end FROM weekly_closings WHERE cooperative_id=? AND status='closed'`).bind(auth.cooperativeId).first<Row>();
  if(String(schedule.start_at).slice(0,10)<=String(closed?.week_end||'1900-01-01'))return c.json({ok:false,error:'Este turno pertence a uma semana já fechada.'},409);
  await c.env.DB.prepare(`INSERT INTO guarantee_turn_adjustments(id,cooperative_id,schedule_id,establishment_id,driver_id,declared_total_cents,notes,adjusted_by) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(schedule_id) DO UPDATE SET declared_total_cents=excluded.declared_total_cents,notes=excluded.notes,adjusted_by=excluded.adjusted_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(id(),auth.cooperativeId,schedule.id,schedule.establishment_id,schedule.driver_id,total,nullableText(body.notes,500),auth.id).run();
  const result=await recalculateGuaranteeSettlement(c.env,auth.cooperativeId!,schedule.id);
  return c.json({ok:true,...result});
});

platformV22Routes.post('/establishment/turn-closings/:id/rating',async c=>{
  const auth=tenant(c,['establishment']);const body=await bodyJson<Row>(c),score=Math.round(Number(body.score||0));
  if(score<1||score>5)return c.json({ok:false,error:'A nota deve ser de 1 a 5.'},400);
  const schedule=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND cooperative_id=? AND establishment_id=? AND base_id IS NULL AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId,auth.establishmentId).first<Row>();
  if(!schedule)return c.json({ok:false,error:'Turno não encontrado. A Base não realiza avaliações.'},404);
  if(new Date(`${schedule.end_at}Z`).getTime()>Date.now()+3*3600000)return c.json({ok:false,error:'A avaliação só pode ser registrada depois do fim do turno.'},409);
  await c.env.DB.prepare(`INSERT INTO shift_ratings(id,cooperative_id,schedule_id,establishment_id,driver_id,score,tags_json,comment,created_by) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(schedule_id) DO UPDATE SET score=excluded.score,tags_json=excluded.tags_json,comment=excluded.comment,created_by=excluded.created_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(id(),auth.cooperativeId,schedule.id,schedule.establishment_id,schedule.driver_id,score,JSON.stringify(Array.isArray(body.tags)?body.tags:[]),nullableText(body.comment,1000),auth.id).run();
  return c.json({ok:true});
});
