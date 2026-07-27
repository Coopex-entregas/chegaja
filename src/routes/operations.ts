import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { audit } from '../lib/audit';
import { randomToken, sha256 } from '../lib/crypto';
import { queueWebhookEvent, processWebhookQueue } from '../lib/webhooks';
import { assertRole, bodyJson, cleanText, cooperativeScope, id, nowIso, nullableText, saoPauloDate, sqlLike, toCents, toNumber } from '../lib/util';
import { expandJsonRow, expandJsonRows } from '../lib/rows';
import { baseDirectReceivedPayment, baseReceivablePayment, cleanFinancialDescription, isDirectReceivedDelivery, isReceivableCredit, reconcileCooperativeFinancialBalances, reconcileDriverFinancialBalance } from '../lib/financial-settlement';

export const operationRoutes = new Hono<AppBindings>();

async function scopedDelivery(c: any, deliveryId: string): Promise<any | null> {
  const auth = c.get('auth');
  let sql = `SELECT d.*,json_object('establishment_name',e.name,'driver_name',dr.name) related_json FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id WHERE d.id=? AND d.deleted_at IS NULL`;
  const params: unknown[] = [deliveryId];
  if (auth.role !== 'platform_admin') { sql += ` AND d.cooperative_id=?`; params.push(auth.cooperativeId); }
  if (auth.role === 'establishment') { sql += ` AND d.establishment_id=?`; params.push(auth.establishmentId); }
  if (auth.role === 'driver') { sql += ` AND d.assigned_driver_id=?`; params.push(auth.driverId); }
  return expandJsonRow(await c.env.DB.prepare(sql).bind(...params).first());
}

operationRoutes.get('/schedules', async (c) => {
  const auth = c.get('auth');
  const from = cleanText(c.req.query('from') || new Date(Date.now() - 7 * 86400000).toISOString(), 40);
  const to = cleanText(c.req.query('to') || new Date(Date.now() + 35 * 86400000).toISOString(), 40);
  let sql = `SELECT s.*, d.name driver_name, e.name establishment_name FROM schedules s JOIN drivers d ON d.id=s.driver_id LEFT JOIN establishments e ON e.id=s.establishment_id WHERE s.deleted_at IS NULL AND s.start_at < ? AND s.end_at > ?`;
  const params: unknown[] = [to, from];
  if (auth.role !== 'platform_admin') { sql += ` AND s.cooperative_id=?`; params.push(auth.cooperativeId); }
  else if (c.req.query('cooperative_id')) { sql += ` AND s.cooperative_id=?`; params.push(c.req.query('cooperative_id')); }
  if (auth.role === 'driver') { sql += ` AND s.driver_id=?`; params.push(auth.driverId); }
  if (auth.role === 'establishment') { sql += ` AND s.establishment_id=?`; params.push(auth.establishmentId); }
  if (c.req.query('driver_id')) { sql += ` AND s.driver_id=?`; params.push(c.req.query('driver_id')); }
  if (c.req.query('establishment_id')) { sql += ` AND s.establishment_id=?`; params.push(c.req.query('establishment_id')); }
  sql += ` ORDER BY s.start_at`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ ok: true, items: rows.results });
});

operationRoutes.post('/schedules', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin','cooperative_admin','dispatcher']);
  const body = await bodyJson<Record<string, unknown>>(c);
  const cooperativeId = cooperativeScope(auth, cleanText(body.cooperative_id,100));
  const driverId = cleanText(body.driver_id,100), startAt = cleanText(body.start_at,50), endAt = cleanText(body.end_at,50);
  if (!cooperativeId || !driverId || !startAt || !endAt || new Date(endAt) <= new Date(startAt)) return c.json({ok:false,error:'Preencha cooperado, início e fim corretamente.'},400);
  const driverScope=await c.env.DB.prepare(`SELECT cooperative_id FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(driverId).first<{cooperative_id:string}>();if(!driverScope||driverScope.cooperative_id!==cooperativeId)return c.json({ok:false,error:'O cooperado não pertence à cooperativa.'},400);
  const establishmentId=nullableText(body.establishment_id,100);if(establishmentId){const estScope=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(establishmentId).first<{cooperative_id:string}>();if(!estScope||estScope.cooperative_id!==cooperativeId)return c.json({ok:false,error:'O estabelecimento não pertence à cooperativa.'},400);}
  const conflict = await c.env.DB.prepare(`SELECT id FROM schedules WHERE driver_id=? AND deleted_at IS NULL AND status!='cancelled' AND start_at < ? AND end_at > ? LIMIT 1`).bind(driverId,endAt,startAt).first();
  if (conflict && !body.allow_conflict) return c.json({ok:false,error:'O cooperado já possui uma escala nesse horário.',conflict:true},409);
  const days = Math.max(1, Math.min(31, Number(body.repeat_days || 1)));
  const recurrence = days > 1 ? id() : null;
  const statements = [];
  for(let i=0;i<days;i+=1){
    const start = new Date(new Date(startAt).getTime()+i*86400000).toISOString();
    const end = new Date(new Date(endAt).getTime()+i*86400000).toISOString();
    statements.push(c.env.DB.prepare(`INSERT INTO schedules (id,cooperative_id,establishment_id,driver_id,start_at,end_at,status,guaranteed_cents,notes,recurrence_group_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id(),cooperativeId,establishmentId,driverId,start,end,cleanText(body.status||'scheduled',20),toCents(body.guaranteed_value),nullableText(body.notes,1000),recurrence,auth.id));
  }
  await c.env.DB.batch(statements); await audit(c,'create','schedule',recurrence||'single',null,{count:days,driverId,startAt,endAt},cooperativeId);
  return c.json({ok:true,count:days},201);
});

operationRoutes.put('/schedules/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);const entityId=c.req.param('id');
  const before=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND deleted_at IS NULL`).bind(entityId).first<any>();if(!before)return c.json({ok:false,error:'Escala não encontrada.'},404);
  if(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id)return c.json({ok:false,error:'Acesso não autorizado.'},403);
  const body=await bodyJson<Record<string,unknown>>(c);const startAt=cleanText(body.start_at??before.start_at,50),endAt=cleanText(body.end_at??before.end_at,50);if(new Date(endAt)<=new Date(startAt))return c.json({ok:false,error:'O fim deve ser posterior ao início.'},400);
  const after={establishment_id:nullableText(body.establishment_id??before.establishment_id,100),driver_id:cleanText(body.driver_id??before.driver_id,100),start_at:startAt,end_at:endAt,status:cleanText(body.status??before.status,20),guaranteed_cents:body.guaranteed_value!==undefined?toCents(body.guaranteed_value):before.guaranteed_cents,notes:nullableText(body.notes??before.notes,1000)};
  const driverScope=await c.env.DB.prepare(`SELECT cooperative_id FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(after.driver_id).first<{cooperative_id:string}>();if(!driverScope||driverScope.cooperative_id!==before.cooperative_id)return c.json({ok:false,error:'O cooperado não pertence à cooperativa.'},400);
  if(after.establishment_id){const estScope=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(after.establishment_id).first<{cooperative_id:string}>();if(!estScope||estScope.cooperative_id!==before.cooperative_id)return c.json({ok:false,error:'O estabelecimento não pertence à cooperativa.'},400);}
  await c.env.DB.prepare(`UPDATE schedules SET establishment_id=?,driver_id=?,start_at=?,end_at=?,status=?,guaranteed_cents=?,notes=?,updated_at=? WHERE id=?`).bind(after.establishment_id,after.driver_id,after.start_at,after.end_at,after.status,after.guaranteed_cents,after.notes,nowIso(),entityId).run();await audit(c,'update','schedule',entityId,before,after,before.cooperative_id);return c.json({ok:true});
});

operationRoutes.delete('/schedules/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);const before=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=?`).bind(c.req.param('id')).first<any>();if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Acesso não autorizado.'},403);
  const scope=c.req.query('scope');if(scope==='series'&&before.recurrence_group_id)await c.env.DB.prepare(`UPDATE schedules SET deleted_at=?,status='cancelled',updated_at=? WHERE recurrence_group_id=?`).bind(nowIso(),nowIso(),before.recurrence_group_id).run();else await c.env.DB.prepare(`UPDATE schedules SET deleted_at=?,status='cancelled',updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),before.id).run();await audit(c,'delete','schedule',before.id,before,null,before.cooperative_id);return c.json({ok:true});
});

operationRoutes.get('/deliveries', async(c)=>{
  const auth=c.get('auth');let sql=`SELECT d.*,json_object('establishment_name',e.name,'driver_name',dr.name) related_json FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id WHERE d.deleted_at IS NULL`;const params:unknown[]=[];
  if(auth.role!=='platform_admin'){sql+=` AND d.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND d.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}
  if(auth.role==='establishment'){sql+=` AND d.establishment_id=?`;params.push(auth.establishmentId);}if(auth.role==='driver'){sql+=` AND d.assigned_driver_id=?`;params.push(auth.driverId);}
  if(c.req.query('establishment_id')){sql+=` AND d.establishment_id=?`;params.push(c.req.query('establishment_id'));}if(c.req.query('driver_id')){sql+=` AND d.assigned_driver_id=?`;params.push(c.req.query('driver_id'));}if(c.req.query('status')){sql+=` AND d.status=?`;params.push(c.req.query('status'));}
  if(c.req.query('from')){sql+=` AND d.created_at>=?`;params.push(c.req.query('from'));}if(c.req.query('to')){sql+=` AND d.created_at<?`;params.push(c.req.query('to'));}
  const search=cleanText(c.req.query('q'),100);if(search){sql+=` AND (d.external_id LIKE ? OR d.customer_name LIKE ? OR d.delivery_address LIKE ? OR d.pickup_address LIKE ?)`;params.push(sqlLike(search),sqlLike(search),sqlLike(search),sqlLike(search));}
  sql+=` ORDER BY CASE d.status WHEN 'new' THEN 1 WHEN 'assigned' THEN 2 WHEN 'accepted' THEN 3 WHEN 'picked_up' THEN 4 WHEN 'in_route' THEN 5 ELSE 9 END, d.created_at DESC LIMIT 1000`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:expandJsonRows(rows.results as any[])});
});

operationRoutes.get('/deliveries/:id', async(c)=>{
  const delivery=await scopedDelivery(c,c.req.param('id'));if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  const history=await c.env.DB.prepare(`SELECT h.*,u.name changed_by_name FROM delivery_status_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.delivery_id=? ORDER BY h.created_at`).bind(delivery.id).all();return c.json({ok:true,item:delivery,history:history.results});
});

operationRoutes.post('/deliveries', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher','establishment']);const body=await bodyJson<Record<string,unknown>>(c);
  const establishmentId=auth.role==='establishment'?auth.establishmentId:cleanText(body.establishment_id,100);if(!establishmentId)return c.json({ok:false,error:'Selecione o estabelecimento.'},400);
  const establishment=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(establishmentId).first<{cooperative_id:string}>();if(!establishment)return c.json({ok:false,error:'Estabelecimento não encontrado.'},404);
  if(auth.role!=='platform_admin'&&auth.cooperativeId!==establishment.cooperative_id)return c.json({ok:false,error:'Acesso não autorizado.'},403);
  const initialDriverId=nullableText(body.assigned_driver_id,100);if(initialDriverId){const driverScope=await c.env.DB.prepare(`SELECT cooperative_id,status FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(initialDriverId).first<{cooperative_id:string;status:string}>();if(!driverScope||driverScope.cooperative_id!==establishment.cooperative_id||driverScope.status!=='active')return c.json({ok:false,error:'O cooperado atribuído é inválido.'},400);}
  const pickup=cleanText(body.pickup_address,500),destination=cleanText(body.delivery_address,500);if(!pickup||!destination)return c.json({ok:false,error:'Informe coleta e entrega.'},400);
  const delivery={id:id(),cooperative_id:establishment.cooperative_id,establishment_id:establishmentId,external_id:nullableText(body.external_id,150),source:cleanText(body.source||'manual',50),customer_name:nullableText(body.customer_name,150),customer_phone:nullableText(body.customer_phone,50),pickup_address:pickup,pickup_lat:toNumber(body.pickup_lat),pickup_lng:toNumber(body.pickup_lng),delivery_address:destination,delivery_lat:toNumber(body.delivery_lat),delivery_lng:toNumber(body.delivery_lng),charge_cents:toCents(body.charge_value),driver_earnings_cents:toCents(body.driver_value),cooperative_fee_cents:toCents(body.cooperative_value),payment_method:nullableText(body.payment_method,50),payment_status:cleanText(body.payment_status||'pending',30),notes:nullableText(body.notes,1500),tracking_token:randomToken(24),assigned_driver_id:initialDriverId,created_by:auth.id};
  const status=delivery.assigned_driver_id?'assigned':'new';
  try{await c.env.DB.prepare(`INSERT INTO deliveries (id,cooperative_id,establishment_id,external_id,source,customer_name,customer_phone,pickup_address,pickup_lat,pickup_lng,delivery_address,delivery_lat,delivery_lng,status,charge_cents,driver_earnings_cents,cooperative_fee_cents,payment_method,payment_status,notes,tracking_token,assigned_driver_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(delivery.id,delivery.cooperative_id,delivery.establishment_id,delivery.external_id,delivery.source,delivery.customer_name,delivery.customer_phone,delivery.pickup_address,delivery.pickup_lat,delivery.pickup_lng,delivery.delivery_address,delivery.delivery_lat,delivery.delivery_lng,status,delivery.charge_cents,delivery.driver_earnings_cents,delivery.cooperative_fee_cents,delivery.payment_method,delivery.payment_status,delivery.notes,delivery.tracking_token,delivery.assigned_driver_id,delivery.created_by).run();}
  catch{return c.json({ok:false,error:'Pedido externo já recebido ou dados inválidos.'},409);}
  await c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,new_status,changed_by) VALUES (?,?,?,?,?)`).bind(id(),delivery.id,delivery.cooperative_id,status,auth.id).run();await audit(c,'create','delivery',delivery.id,null,delivery,delivery.cooperative_id);c.executionCtx.waitUntil(queueWebhookEvent(c.env,delivery.cooperative_id,delivery.establishment_id,'delivery.created',{...delivery,status}));return c.json({ok:true,item:{...delivery,status,tracking_url:`${c.env.APP_URL.replace(/\/$/,'')}/r/${delivery.tracking_token}`}},201);
});

operationRoutes.put('/deliveries/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher','establishment']);const before=await scopedDelivery(c,c.req.param('id'));if(!before)return c.json({ok:false,error:'Entrega não encontrada.'},404);if(['delivered','cancelled'].includes(before.status))return c.json({ok:false,error:'Entrega finalizada. Use um ajuste financeiro ou registre uma ocorrência.'},400);
  const body=await bodyJson<Record<string,unknown>>(c);const after={customer_name:nullableText(body.customer_name??before.customer_name,150),customer_phone:nullableText(body.customer_phone??before.customer_phone,50),pickup_address:cleanText(body.pickup_address??before.pickup_address,500),pickup_lat:toNumber(body.pickup_lat??before.pickup_lat),pickup_lng:toNumber(body.pickup_lng??before.pickup_lng),delivery_address:cleanText(body.delivery_address??before.delivery_address,500),delivery_lat:toNumber(body.delivery_lat??before.delivery_lat),delivery_lng:toNumber(body.delivery_lng??before.delivery_lng),charge_cents:body.charge_value!==undefined?toCents(body.charge_value):before.charge_cents,driver_earnings_cents:body.driver_value!==undefined?toCents(body.driver_value):before.driver_earnings_cents,cooperative_fee_cents:body.cooperative_value!==undefined?toCents(body.cooperative_value):before.cooperative_fee_cents,payment_method:nullableText(body.payment_method??before.payment_method,50),payment_status:cleanText(body.payment_status??before.payment_status,30),notes:nullableText(body.notes??before.notes,1500)};
  await c.env.DB.prepare(`UPDATE deliveries SET customer_name=?,customer_phone=?,pickup_address=?,pickup_lat=?,pickup_lng=?,delivery_address=?,delivery_lat=?,delivery_lng=?,charge_cents=?,driver_earnings_cents=?,cooperative_fee_cents=?,payment_method=?,payment_status=?,notes=?,updated_at=? WHERE id=?`).bind(after.customer_name,after.customer_phone,after.pickup_address,after.pickup_lat,after.pickup_lng,after.delivery_address,after.delivery_lat,after.delivery_lng,after.charge_cents,after.driver_earnings_cents,after.cooperative_fee_cents,after.payment_method,after.payment_status,after.notes,nowIso(),before.id).run();await audit(c,'update','delivery',before.id,before,after,before.cooperative_id);c.executionCtx.waitUntil(queueWebhookEvent(c.env,before.cooperative_id,before.establishment_id,'delivery.updated',{id:before.id,...after,status:before.status}));return c.json({ok:true});
});

operationRoutes.post('/deliveries/:id/assign', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher','establishment']);const delivery=await scopedDelivery(c,c.req.param('id'));if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'Entrega finalizada.'},400);
  const body=await bodyJson<{driver_id?:string}>(c);const driverId=cleanText(body.driver_id,100);if(!driverId)return c.json({ok:false,error:'Selecione o cooperado.'},400);const driver=await c.env.DB.prepare(`SELECT id,cooperative_id,status,on_leave,leave_return_date FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(driverId).first<{id:string;cooperative_id:string;status:string;on_leave:number;leave_return_date:string|null}>();if(!driver||driver.cooperative_id!==delivery.cooperative_id||driver.status!=='active')return c.json({ok:false,error:'Cooperado inválido.'},400);if(Number(driver.on_leave||0)===1)return c.json({ok:false,error:`Este cooperado está afastado${driver.leave_return_date?` até ${driver.leave_return_date}`:''}.`},409);if(delivery.establishment_id){const blocked=await c.env.DB.prepare(`SELECT 1 ok FROM driver_establishment_blocks WHERE driver_id=? AND establishment_id=? AND active=1 LIMIT 1`).bind(driverId,delivery.establishment_id).first();if(blocked)return c.json({ok:false,error:'Este cooperado está bloqueado para este estabelecimento.'},409);}
  const oldStatus=delivery.status;await c.env.DB.batch([c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='assigned',updated_at=? WHERE id=?`).bind(driverId,nowIso(),delivery.id),c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting' AND ((? IS NOT NULL AND base_id=?) OR (? IS NOT NULL AND establishment_id=?))`).bind(delivery.id,driverId,delivery.base_id,delivery.base_id,delivery.establishment_id,delivery.establishment_id),c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,delivery.cooperative_id,oldStatus,'assigned','Cooperado atribuído',auth.id)]);await audit(c,'assign','delivery',delivery.id,{driver_id:delivery.assigned_driver_id},{driver_id:driverId},delivery.cooperative_id);c.executionCtx.waitUntil(queueWebhookEvent(c.env,delivery.cooperative_id,delivery.establishment_id,'delivery.assigned',{id:delivery.id,driver_id:driverId,status:'assigned'}));return c.json({ok:true});
});

operationRoutes.post('/deliveries/:id/status', async(c)=>{
  const auth=c.get('auth');const delivery=await scopedDelivery(c,c.req.param('id'));if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  const body=await bodyJson<{status?:string;notes?:string}>(c);const status=cleanText(body.status,30);const allowed=['new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered','cancelled','problem'];if(!allowed.includes(status))return c.json({ok:false,error:'Status inválido.'},400);
  if(auth.role==='driver'&&!['accepted','to_pickup','at_pickup','picked_up','in_route','delivered','problem'].includes(status))return c.json({ok:false,error:'Status não permitido.'},403);
  if(auth.role==='establishment'&&!['cancelled','problem'].includes(status))return c.json({ok:false,error:'Status não permitido.'},403);
  const timestampFields:Record<string,string>={accepted:'accepted_at',picked_up:'picked_up_at',delivered:'delivered_at',cancelled:'cancelled_at'};const field=timestampFields[status];const statements:D1PreparedStatement[]=[c.env.DB.prepare(`UPDATE deliveries SET status=?,updated_at=?${field?`,${field}=?`:''} WHERE id=?`).bind(...(field?[status,nowIso(),nowIso(),delivery.id]:[status,nowIso(),delivery.id])),c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,delivery.cooperative_id,delivery.status,status,nullableText(body.notes,500),auth.id)];
  if(status==='delivered'&&delivery.assigned_driver_id){
    const gross=Math.max(0,Number(delivery.driver_gross_cents||delivery.driver_earnings_cents||0));
    if(gross>0){
      const taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
      const direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method);
      const receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
      const existing=await c.env.DB.prepare(`SELECT category FROM financial_entries WHERE delivery_id=? AND deleted_at IS NULL AND status!='cancelled'`).bind(delivery.id).all<{category:string}>();
      const categories=new Set((existing.results||[]).map(item=>String(item.category)));
      // Cartões e vales da Base apenas informam como cobrar o pedido. Não viram ganho.
      if(direct||receivable){
        if(!categories.has('delivery'))statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date('now','-3 hours'),?,?)`).bind(id(),delivery.cooperative_id,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,`Entrega ${delivery.display_code||delivery.external_id||delivery.id.slice(0,8)}${direct?' • recebido diretamente pelo cooperado':''}`,gross,direct?gross:0,direct?'paid':'open',auth.id));
        const coop=taxable?await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(delivery.cooperative_id).first<{inss_percent:number;sest_senat_percent:number}>():null;
        const inss=taxable?Math.round(gross*Number(coop?.inss_percent||0)/100):0;
        const sest=taxable?Math.round(gross*Number(coop?.sest_senat_percent||0)/100):0;
        if(inss&&!categories.has('INSS'))statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,date('now','-3 hours'),'open',?)`).bind(id(),delivery.cooperative_id,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,inss,auth.id));
        if(sest&&!categories.has('SEST/SENAT'))statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,date('now','-3 hours'),'open',?)`).bind(id(),delivery.cooperative_id,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,sest,auth.id));
        statements.push(c.env.DB.prepare(`UPDATE deliveries SET driver_gross_cents=?,driver_net_cents=? WHERE id=?`).bind(gross,Math.max(0,gross-inss-sest),delivery.id));
      }
    }
  }
  if(status==='cancelled')statements.push(c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',updated_at=? WHERE delivery_id=? AND deleted_at IS NULL`).bind(nowIso(),delivery.id));
  await c.env.DB.batch(statements);if(delivery.assigned_driver_id&&(status==='delivered'||status==='cancelled'))await reconcileDriverFinancialBalance(c.env,delivery.cooperative_id,String(delivery.assigned_driver_id));await audit(c,'status','delivery',delivery.id,{status:delivery.status},{status,notes:body.notes},delivery.cooperative_id);c.executionCtx.waitUntil(queueWebhookEvent(c.env,delivery.cooperative_id,delivery.establishment_id,'delivery.status_changed',{id:delivery.id,old_status:delivery.status,status,changed_at:nowIso()}));return c.json({ok:true});
});

operationRoutes.delete('/deliveries/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const delivery=await scopedDelivery(c,c.req.param('id'));if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);const stamp=nowIso();await c.env.DB.batch([c.env.DB.prepare(`UPDATE deliveries SET deleted_at=?,status='cancelled',cancelled_at=?,updated_at=? WHERE id=?`).bind(stamp,stamp,stamp,delivery.id),c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',updated_at=? WHERE delivery_id=? AND deleted_at IS NULL`).bind(stamp,delivery.id)]);await audit(c,'delete','delivery',delivery.id,delivery,null,delivery.cooperative_id);return c.json({ok:true});
});

operationRoutes.post('/driver/online', async(c)=>{
  const auth=c.get('auth');
  assertRole(auth,['driver']);
  const body=await bodyJson<{online?:boolean;latitude?:number;longitude?:number;accuracy?:number}>(c);
  const online=Boolean(body.online);
  if(!online){
    const active=await c.env.DB.prepare(`SELECT COUNT(*) total FROM deliveries WHERE assigned_driver_id=? AND deleted_at IS NULL AND status IN ('assigned','accepted','to_pickup','at_pickup','picked_up','in_route')`).bind(auth.driverId).first<{total:number}>();
    if(Number(active?.total||0)>0)return c.json({ok:false,error:'Finalize ou resolva suas entregas ativas antes de ficar offline.'},409);
    await c.env.DB.prepare(`UPDATE drivers SET online=0,last_seen_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),auth.driverId).run();
    return c.json({ok:true,online:false});
  }
  const lat=toNumber(body.latitude),lng=toNumber(body.longitude);
  if(lat===null||lng===null)return c.json({ok:false,error:'Autorize a localização para ficar online.'},400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE drivers SET online=1,current_lat=?,current_lng=?,location_accuracy=?,location_updated_at=?,last_seen_at=?,updated_at=? WHERE id=?`).bind(lat,lng,toNumber(body.accuracy),nowIso(),nowIso(),nowIso(),auth.driverId),
    c.env.DB.prepare(`INSERT INTO driver_locations (cooperative_id,driver_id,latitude,longitude,accuracy,recorded_at) VALUES (?,?,?,?,?,?)`).bind(auth.cooperativeId,auth.driverId,lat,lng,toNumber(body.accuracy),nowIso())
  ]);
  return c.json({ok:true,online:true});
});

operationRoutes.post('/driver/location', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['driver']);const body=await bodyJson<Record<string,unknown>>(c);const lat=toNumber(body.latitude),lng=toNumber(body.longitude);if(lat===null||lng===null)return c.json({ok:false,error:'Localização inválida.'},400);
  const deliveryId=nullableText(body.delivery_id,100);await c.env.DB.batch([c.env.DB.prepare(`UPDATE drivers SET online=1,current_lat=?,current_lng=?,location_accuracy=?,location_updated_at=?,last_seen_at=?,updated_at=? WHERE id=?`).bind(lat,lng,toNumber(body.accuracy),nowIso(),nowIso(),nowIso(),auth.driverId),c.env.DB.prepare(`INSERT INTO driver_locations (cooperative_id,driver_id,delivery_id,latitude,longitude,accuracy,speed,heading,battery,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(auth.cooperativeId,auth.driverId,deliveryId,lat,lng,toNumber(body.accuracy),toNumber(body.speed),toNumber(body.heading),toNumber(body.battery),nowIso())]);return c.json({ok:true});
});

operationRoutes.get('/tracking/live', async(c)=>{
  const auth=c.get('auth');if(auth.role==='driver')return c.json({ok:false,error:'Acesso não autorizado.'},403);const coop=cooperativeScope(auth,c.req.query('cooperative_id'));let sql=`SELECT d.id,d.name,d.phone,d.vehicle_plate,d.online,d.current_lat,d.current_lng,d.location_accuracy,d.location_updated_at,(SELECT COUNT(*) FROM deliveries x WHERE x.assigned_driver_id=d.id AND x.deleted_at IS NULL AND x.status NOT IN ('delivered','cancelled')) active_deliveries FROM drivers d WHERE d.deleted_at IS NULL AND d.status='active'`;const params:unknown[]=[];if(coop){sql+=` AND d.cooperative_id=?`;params.push(coop);}if(auth.role==='establishment'){sql+=` AND EXISTS(SELECT 1 FROM deliveries x WHERE x.assigned_driver_id=d.id AND x.establishment_id=? AND x.status NOT IN ('delivered','cancelled'))`;params.push(auth.establishmentId);}const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

operationRoutes.post('/checkins', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  const body=await bodyJson<Record<string,unknown>>(c);
  const token=cleanText(body.token,300).replace(/^.*(?:token=|\/qr\/)/i,'').trim();
  const establishment=await c.env.DB.prepare(`SELECT id,cooperative_id,name FROM establishments WHERE checkin_token=? AND deleted_at IS NULL AND active=1`).bind(token).first<any>();
  if(!establishment||establishment.cooperative_id!==auth.cooperativeId)return c.json({ok:false,error:'QR Code inválido ou de outra cooperativa.'},404);
  const lat=toNumber(body.latitude),lng=toNumber(body.longitude);
  const open=await c.env.DB.prepare(`SELECT ch.*,e.name establishment_name FROM checkins ch JOIN establishments e ON e.id=ch.establishment_id WHERE ch.driver_id=? AND ch.checked_out_at IS NULL ORDER BY ch.checked_in_at DESC LIMIT 1`).bind(auth.driverId).first<any>();
  if(open){
    if(open.establishment_id!==establishment.id)return c.json({ok:false,error:`Você ainda está com check-in aberto em ${open.establishment_name}. Leia o QR Code daquele estabelecimento para fazer o check-out.`},409);
    const checkedOutAt=nowIso();
    await c.env.DB.prepare(`UPDATE checkins SET checked_out_at=?,checkout_latitude=?,checkout_longitude=?,checkout_source='qr' WHERE id=?`).bind(checkedOutAt,lat,lng,open.id).run();
    const durationMinutes=Math.max(0,Math.round((new Date(checkedOutAt).getTime()-new Date(open.checked_in_at).getTime())/60000));
    await audit(c,'checkout','attendance',open.id,{checked_in_at:open.checked_in_at},{checked_out_at:checkedOutAt},auth.cooperativeId);
    return c.json({ok:true,action:'checkout',establishment:establishment.name,checked_in_at:open.checked_in_at,checked_out_at:checkedOutAt,duration_minutes:durationMinutes});
  }
  const schedule=await c.env.DB.prepare(`SELECT s.id,s.contract_id FROM schedules s WHERE s.driver_id=? AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status NOT IN ('cancelled','absent') AND date(s.start_at)=date('now','-3 hours') ORDER BY ABS(julianday(s.start_at)-julianday('now','-3 hours')) LIMIT 1`).bind(auth.driverId,establishment.id).first<any>();
  const attendanceId=id(),checkedInAt=nowIso();
  await c.env.DB.prepare(`INSERT INTO checkins (id,cooperative_id,establishment_id,driver_id,schedule_id,contract_id,latitude,longitude,source,checked_in_at) VALUES (?,?,?,?,?,?,?,?, 'qr',?)`).bind(attendanceId,auth.cooperativeId,establishment.id,auth.driverId,schedule?.id||null,schedule?.contract_id||null,lat,lng,checkedInAt).run();
  await audit(c,'checkin','attendance',attendanceId,null,{establishment_id:establishment.id,schedule_id:schedule?.id||null,checked_in_at:checkedInAt},auth.cooperativeId);
  return c.json({ok:true,action:'checkin',establishment:establishment.name,checked_in_at:checkedInAt,schedule_linked:Boolean(schedule)});
});

operationRoutes.get('/attendance/current', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  const item=await c.env.DB.prepare(`SELECT ch.*,e.name establishment_name,ct.name contract_name,CAST((julianday('now','-3 hours')-julianday(ch.checked_in_at))*1440 AS INTEGER) duration_minutes FROM checkins ch JOIN establishments e ON e.id=ch.establishment_id LEFT JOIN contracts ct ON ct.id=ch.contract_id WHERE ch.driver_id=? AND ch.checked_out_at IS NULL ORDER BY ch.checked_in_at DESC LIMIT 1`).bind(auth.driverId).first();
  return c.json({ok:true,item:item||null});
});

operationRoutes.get('/checkins', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher','establishment','driver']);
  let sql=`SELECT ch.*,d.name driver_name,e.name establishment_name,ct.name contract_name,s.shift_label,CAST((julianday(COALESCE(ch.checked_out_at,CURRENT_TIMESTAMP))-julianday(ch.checked_in_at))*1440 AS INTEGER) duration_minutes FROM checkins ch JOIN drivers d ON d.id=ch.driver_id JOIN establishments e ON e.id=ch.establishment_id LEFT JOIN contracts ct ON ct.id=ch.contract_id LEFT JOIN schedules s ON s.id=ch.schedule_id WHERE 1=1`;
  const params:unknown[]=[];
  if(auth.role!=='platform_admin'){sql+=` AND ch.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND ch.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}
  if(auth.role==='establishment'){sql+=` AND ch.establishment_id=?`;params.push(auth.establishmentId);}
  if(auth.role==='driver'){sql+=` AND ch.driver_id=?`;params.push(auth.driverId);}
  if(c.req.query('establishment_id')){sql+=` AND ch.establishment_id=?`;params.push(c.req.query('establishment_id'));}
  if(c.req.query('driver_id')){sql+=` AND ch.driver_id=?`;params.push(c.req.query('driver_id'));}
  if(c.req.query('from')){sql+=` AND date(ch.checked_in_at,'-3 hours')>=date(?)`;params.push(c.req.query('from'));}
  if(c.req.query('to')){sql+=` AND date(ch.checked_in_at,'-3 hours')<=date(?)`;params.push(c.req.query('to'));}
  sql+=` ORDER BY ch.checked_in_at DESC LIMIT 1000`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

function financialLocationFilter(c:any, sql:string, params:unknown[], alias='f'):{sql:string;params:unknown[]} {
  const locationKey=cleanText(c.req.query('location_key'),150);
  if(locationKey.startsWith('base:')){sql+=` AND COALESCE(dl.base_id,bv.id)=?`;params.push(locationKey.slice(5));}
  else if(locationKey.startsWith('est:')){sql+=` AND ${alias}.establishment_id=? AND COALESCE(dl.base_id,bv.id) IS NULL`;params.push(locationKey.slice(4));}
  else if(locationKey==='general'){sql+=` AND ${alias}.establishment_id IS NULL`;}
  return {sql,params};
}

operationRoutes.post('/financial/reconcile', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);
  const body=await bodyJson<Record<string,unknown>>(c);
  const cooperativeId=auth.role==='platform_admin'?cleanText(body.cooperative_id||c.req.query('cooperative_id'),100):auth.cooperativeId;
  if(!cooperativeId)return c.json({ok:false,error:'Cooperativa não informada.'},400);
  const driverId=cleanText(body.driver_id||'',100)||null;
  const items=await reconcileCooperativeFinancialBalances(c.env,cooperativeId,driverId);
  return c.json({ok:true,drivers:items.length,applied_cents:items.reduce((sum,item)=>sum+Number(item.applied_cents||0),0)});
});

operationRoutes.get('/financial', async(c)=>{
  const auth=c.get('auth');
  let sql=`SELECT f.*,d.name driver_name,e.name establishment_name,COALESCE(b.name,bv.name) base_name,
    dl.delivery_type,dl.payment_method,
    CASE WHEN COALESCE(dl.base_id,bv.id) IS NOT NULL THEN 'base' WHEN f.establishment_id IS NOT NULL THEN 'establishment' ELSE 'general' END location_type,
    COALESCE(dl.base_id,bv.id,e.id) location_id,COALESCE(b.name,bv.name,e.name,'Geral') location_name
    FROM financial_entries f JOIN drivers d ON d.id=f.driver_id
    LEFT JOIN deliveries dl ON dl.id=f.delivery_id
    LEFT JOIN bases b ON b.id=dl.base_id
    LEFT JOIN bases bv ON bv.virtual_establishment_id=f.establishment_id AND dl.base_id IS NULL AND bv.deleted_at IS NULL
    LEFT JOIN establishments e ON e.id=f.establishment_id
    WHERE f.deleted_at IS NULL`;
  const params:unknown[]=[];
  if(auth.role!=='platform_admin'){sql+=` AND f.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND f.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}
  if(auth.role==='driver'){sql+=` AND f.driver_id=?`;params.push(auth.driverId);}
  if(auth.role==='establishment'){sql+=` AND f.establishment_id=?`;params.push(auth.establishmentId);}
  if(c.req.query('driver_id')){sql+=` AND f.driver_id=?`;params.push(c.req.query('driver_id'));}
  ({sql}=financialLocationFilter(c,sql,params));
  if(c.req.query('from')){sql+=` AND f.reference_date>=?`;params.push(c.req.query('from'));}
  if(c.req.query('to')){sql+=` AND f.reference_date<=?`;params.push(c.req.query('to'));}
  sql+=` ORDER BY f.reference_date DESC,f.created_at DESC LIMIT 5000`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();
  const items=(rows.results||[]).map((row:any)=>{
    const amount=Number(row.amount_cents||0),settled=Math.min(amount,Math.max(0,Number(row.settled_cents||0))),remaining=Math.max(0,amount-settled);
    const direct=isDirectReceivedDelivery(row),receivable=isReceivableCredit(row);
    return {...row,description:cleanFinancialDescription(row.description),remaining_cents:remaining,settled_cents:settled,financial_class:direct?'production_received':receivable&&row.category==='delivery'?'production_receivable':row.entry_type==='credit'?'other_credit':'deduction'};
  });
  const totals=(items as any[]).reduce((acc:any,row:any)=>{
    if(row.status==='cancelled')return acc;const amount=Number(row.amount_cents||0),remaining=Number(row.remaining_cents||0);
    if(row.entry_type==='credit'){acc.credits_cents+=amount;if(row.financial_class==='production_received')acc.direct_received_cents+=amount;else {acc.receivable_credits_cents+=amount;acc.receivable_open_cents+=remaining;}if(row.financial_class==='production_receivable')acc.production_receivable_cents+=amount;else if(row.financial_class==='other_credit')acc.other_credits_cents+=amount;}
    else {acc.debits_cents+=amount;acc.debits_paid_cents+=Math.min(amount,Number(row.settled_cents||0));acc.pending_debits_cents+=remaining;}
    return acc;
  },{credits_cents:0,debits_cents:0,production_receivable_cents:0,direct_received_cents:0,other_credits_cents:0,receivable_credits_cents:0,receivable_open_cents:0,debits_paid_cents:0,pending_debits_cents:0});
  totals.balance_cents=totals.receivable_open_cents-totals.pending_debits_cents;
  return c.json({ok:true,items,totals});
});

operationRoutes.get('/financial/summary', async(c)=>{
  const auth=c.get('auth');
  let sql=`SELECT f.entry_type,f.category,f.amount_cents,COALESCE(f.settled_cents,0) settled_cents,f.status,f.delivery_id,dl.delivery_type,dl.payment_method
    FROM financial_entries f LEFT JOIN deliveries dl ON dl.id=f.delivery_id LEFT JOIN bases b ON b.id=dl.base_id
    LEFT JOIN bases bv ON bv.virtual_establishment_id=f.establishment_id AND dl.base_id IS NULL AND bv.deleted_at IS NULL
    WHERE f.deleted_at IS NULL`;
  const params:unknown[]=[];
  if(auth.role!=='platform_admin'){sql+=` AND f.cooperative_id=?`;params.push(auth.cooperativeId);}
  if(auth.role==='driver'){sql+=` AND f.driver_id=?`;params.push(auth.driverId);}
  if(auth.role==='establishment'){sql+=` AND f.establishment_id=?`;params.push(auth.establishmentId);}
  if(c.req.query('driver_id')){sql+=` AND f.driver_id=?`;params.push(c.req.query('driver_id'));}
  ({sql}=financialLocationFilter(c,sql,params));
  if(c.req.query('from')){sql+=` AND f.reference_date>=?`;params.push(c.req.query('from'));}
  if(c.req.query('to')){sql+=` AND f.reference_date<=?`;params.push(c.req.query('to'));}
  const rows=await c.env.DB.prepare(sql).bind(...params).all<any>();
  const data=(rows.results||[]).reduce((acc:any,row:any)=>{
    if(row.status==='cancelled')return acc;const amount=Math.max(0,Number(row.amount_cents||0)),settled=Math.min(amount,Math.max(0,Number(row.settled_cents||0))),remaining=amount-settled;
    if(row.entry_type==='credit'){acc.credits_cents+=amount;if(isDirectReceivedDelivery(row))acc.direct_received_cents+=amount;else {acc.receivable_credits_cents+=amount;acc.receivable_open_cents+=remaining;if(row.category==='delivery')acc.production_receivable_cents+=amount;else acc.other_credits_cents+=amount;}}
    else {acc.debits_cents+=amount;acc.debits_paid_cents+=settled;acc.pending_debits_cents+=remaining;}
    return acc;
  },{credits_cents:0,debits_cents:0,production_receivable_cents:0,direct_received_cents:0,other_credits_cents:0,receivable_credits_cents:0,receivable_open_cents:0,debits_paid_cents:0,pending_debits_cents:0});
  data.balance_cents=data.receivable_open_cents-data.pending_debits_cents;
  data.amount_to_receive_cents=Math.max(0,data.balance_cents);data.debt_cents=Math.max(0,-data.balance_cents);
  return c.json({ok:true,data});
});

operationRoutes.post('/financial', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);
  const body=await bodyJson<Record<string,unknown>>(c),driverId=cleanText(body.driver_id,100);
  const driver=await c.env.DB.prepare(`SELECT cooperative_id FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(driverId).first<{cooperative_id:string}>();
  if(!driver||(auth.role!=='platform_admin'&&auth.cooperativeId!==driver.cooperative_id))return c.json({ok:false,error:'Cooperado inválido.'},400);
  let financialEstablishmentId=nullableText(body.establishment_id,100);const locationKey=cleanText(body.location_key,150);
  if(locationKey.startsWith('base:')){const base=await c.env.DB.prepare(`SELECT virtual_establishment_id FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(locationKey.slice(5),driver.cooperative_id).first<{virtual_establishment_id:string}>();if(!base?.virtual_establishment_id)return c.json({ok:false,error:'Base inválida ou sem vínculo operacional.'},400);financialEstablishmentId=base.virtual_establishment_id;}
  else if(locationKey.startsWith('est:'))financialEstablishmentId=locationKey.slice(4);
  else if(locationKey==='general')financialEstablishmentId=null;
  if(financialEstablishmentId){const estScope=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(financialEstablishmentId).first<{cooperative_id:string}>();if(!estScope||estScope.cooperative_id!==driver.cooperative_id)return c.json({ok:false,error:'O estabelecimento não pertence à cooperativa do cooperado.'},400);}
  const entryType=cleanText(body.entry_type,20);if(!['credit','debit'].includes(entryType))return c.json({ok:false,error:'Tipo inválido.'},400);
  const amount=toCents(body.amount);if(amount<=0)return c.json({ok:false,error:'Informe um valor maior que zero.'},400);
  const entry={id:id(),cooperative_id:driver.cooperative_id,driver_id:driverId,establishment_id:financialEstablishmentId,delivery_id:nullableText(body.delivery_id,100),entry_type:entryType,category:cleanText(body.category||'adjustment',80),description:cleanText(body.description,500),amount_cents:amount,reference_date:cleanText(body.reference_date||saoPauloDate(),20),status:cleanText(body.status||'open',20),created_by:auth.id};
  if(!entry.description)return c.json({ok:false,error:'Informe a descrição.'},400);
  await c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...Object.values(entry)).run();
  await audit(c,'create','financial_entry',entry.id,null,entry,entry.cooperative_id);await reconcileDriverFinancialBalance(c.env,entry.cooperative_id,driverId);return c.json({ok:true,item:entry},201);
});

operationRoutes.put('/financial/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await c.env.DB.prepare(`SELECT * FROM financial_entries WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<any>();if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Lançamento não encontrado.'},404);const body=await bodyJson<Record<string,unknown>>(c);const after={entry_type:cleanText(body.entry_type??before.entry_type,20),category:cleanText(body.category??before.category,80),description:cleanText(body.description??before.description,500),amount_cents:body.amount!==undefined?toCents(body.amount):before.amount_cents,reference_date:cleanText(body.reference_date??before.reference_date,20),status:cleanText(body.status??before.status,20)};await c.env.DB.prepare(`UPDATE financial_entries SET entry_type=?,category=?,description=?,amount_cents=?,reference_date=?,status=?,updated_at=? WHERE id=?`).bind(after.entry_type,after.category,after.description,after.amount_cents,after.reference_date,after.status,nowIso(),before.id).run();await audit(c,'update','financial_entry',before.id,before,after,before.cooperative_id);await reconcileDriverFinancialBalance(c.env,before.cooperative_id,before.driver_id);return c.json({ok:true});
});

operationRoutes.delete('/financial/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await c.env.DB.prepare(`SELECT * FROM financial_entries WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<any>();if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Lançamento não encontrado.'},404);await c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',deleted_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),before.id).run();await audit(c,'delete','financial_entry',before.id,before,null,before.cooperative_id);await reconcileDriverFinancialBalance(c.env,before.cooperative_id,before.driver_id);return c.json({ok:true});
});

operationRoutes.get('/price-tables', async(c)=>{
  const auth=c.get('auth');let sql=`SELECT p.*,e.name establishment_name FROM price_tables p LEFT JOIN establishments e ON e.id=p.establishment_id WHERE p.deleted_at IS NULL`;const params:unknown[]=[];if(auth.role!=='platform_admin'){sql+=` AND p.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND p.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}if(auth.role==='establishment'){sql+=` AND (p.establishment_id=? OR p.establishment_id IS NULL)`;params.push(auth.establishmentId);}if(auth.role==='driver'){sql+=` AND p.visible_to_driver=1`;}sql+=` ORDER BY p.name`;const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

operationRoutes.post('/price-tables', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const body=await bodyJson<Record<string,unknown>>(c);const cooperativeId=cooperativeScope(auth,cleanText(body.cooperative_id,100));const name=cleanText(body.name,150);if(!cooperativeId||!name)return c.json({ok:false,error:'Informe cooperativa e nome.'},400);const priceEstablishmentId=nullableText(body.establishment_id,100);if(priceEstablishmentId){const estScope=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(priceEstablishmentId).first<{cooperative_id:string}>();if(!estScope||estScope.cooperative_id!==cooperativeId)return c.json({ok:false,error:'O estabelecimento não pertence à cooperativa.'},400);}const item={id:id(),cooperative_id:cooperativeId,establishment_id:priceEstablishmentId,name,description:nullableText(body.description,500),visible_to_driver:body.visible_to_driver===false?0:1};await c.env.DB.prepare(`INSERT INTO price_tables (id,cooperative_id,establishment_id,name,description,visible_to_driver) VALUES (?,?,?,?,?,?)`).bind(...Object.values(item)).run();await audit(c,'create','price_table',item.id,null,item,cooperativeId);return c.json({ok:true,item},201);
});

operationRoutes.put('/price-tables/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await c.env.DB.prepare(`SELECT * FROM price_tables WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<any>();if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Tabela não encontrada.'},404);const body=await bodyJson<Record<string,unknown>>(c);const after={name:cleanText(body.name??before.name,150),description:nullableText(body.description??before.description,500),establishment_id:nullableText(body.establishment_id??before.establishment_id,100),visible_to_driver:body.visible_to_driver===undefined?before.visible_to_driver:(body.visible_to_driver?1:0),active:body.active===undefined?before.active:(body.active?1:0)};await c.env.DB.prepare(`UPDATE price_tables SET name=?,description=?,establishment_id=?,visible_to_driver=?,active=?,updated_at=? WHERE id=?`).bind(after.name,after.description,after.establishment_id,after.visible_to_driver,after.active,nowIso(),before.id).run();await audit(c,'update','price_table',before.id,before,after,before.cooperative_id);return c.json({ok:true});
});

operationRoutes.delete('/price-tables/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await c.env.DB.prepare(`SELECT * FROM price_tables WHERE id=?`).bind(c.req.param('id')).first<any>();if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Tabela não encontrada.'},404);await c.env.DB.prepare(`UPDATE price_tables SET active=0,deleted_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),before.id).run();await audit(c,'delete','price_table',before.id,before,null,before.cooperative_id);return c.json({ok:true});
});

operationRoutes.get('/price-tables/:id/rules', async(c)=>{const auth=c.get('auth');const table=await c.env.DB.prepare(`SELECT * FROM price_tables WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<any>();if(!table||(auth.role!=='platform_admin'&&auth.cooperativeId!==table.cooperative_id)||(auth.role==='driver'&&!table.visible_to_driver)||(auth.role==='establishment'&&table.establishment_id&&table.establishment_id!==auth.establishmentId))return c.json({ok:false,error:'Tabela não encontrada.'},404);const rows=await c.env.DB.prepare(`SELECT * FROM price_rules WHERE price_table_id=? ORDER BY origin,destination,min_km`).bind(table.id).all();return c.json({ok:true,table,items:rows.results});});

operationRoutes.post('/price-tables/:id/rules', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const table=await c.env.DB.prepare(`SELECT * FROM price_tables WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<any>();if(!table||(auth.role!=='platform_admin'&&auth.cooperativeId!==table.cooperative_id))return c.json({ok:false,error:'Tabela não encontrada.'},404);const body=await bodyJson<Record<string,unknown>>(c);const rule={id:id(),price_table_id:table.id,origin:nullableText(body.origin,150),destination:nullableText(body.destination,150),min_km:toNumber(body.min_km),max_km:toNumber(body.max_km),base_cents:toCents(body.base_value),driver_cents:toCents(body.driver_value),cooperative_cents:toCents(body.cooperative_value),day_type:cleanText(body.day_type||'all',30),start_time:nullableText(body.start_time,10),end_time:nullableText(body.end_time,10),wait_cents_per_15m:toCents(body.wait_value)};await c.env.DB.prepare(`INSERT INTO price_rules (id,price_table_id,origin,destination,min_km,max_km,base_cents,driver_cents,cooperative_cents,day_type,start_time,end_time,wait_cents_per_15m) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...Object.values(rule)).run();await audit(c,'create','price_rule',rule.id,null,rule,table.cooperative_id);return c.json({ok:true,item:rule},201);
});

operationRoutes.put('/price-rules/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await c.env.DB.prepare(`SELECT r.*,p.cooperative_id FROM price_rules r JOIN price_tables p ON p.id=r.price_table_id WHERE r.id=?`).bind(c.req.param('id')).first<any>();if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Regra não encontrada.'},404);const body=await bodyJson<Record<string,unknown>>(c);const after={origin:nullableText(body.origin??before.origin,150),destination:nullableText(body.destination??before.destination,150),min_km:toNumber(body.min_km??before.min_km),max_km:toNumber(body.max_km??before.max_km),base_cents:body.base_value!==undefined?toCents(body.base_value):before.base_cents,driver_cents:body.driver_value!==undefined?toCents(body.driver_value):before.driver_cents,cooperative_cents:body.cooperative_value!==undefined?toCents(body.cooperative_value):before.cooperative_cents,day_type:cleanText(body.day_type??before.day_type,30),start_time:nullableText(body.start_time??before.start_time,10),end_time:nullableText(body.end_time??before.end_time,10),wait_cents_per_15m:body.wait_value!==undefined?toCents(body.wait_value):before.wait_cents_per_15m,active:body.active===undefined?before.active:(body.active?1:0)};await c.env.DB.prepare(`UPDATE price_rules SET origin=?,destination=?,min_km=?,max_km=?,base_cents=?,driver_cents=?,cooperative_cents=?,day_type=?,start_time=?,end_time=?,wait_cents_per_15m=?,active=?,updated_at=? WHERE id=?`).bind(after.origin,after.destination,after.min_km,after.max_km,after.base_cents,after.driver_cents,after.cooperative_cents,after.day_type,after.start_time,after.end_time,after.wait_cents_per_15m,after.active,nowIso(),before.id).run();await audit(c,'update','price_rule',before.id,before,after,before.cooperative_id);return c.json({ok:true});
});

operationRoutes.delete('/price-rules/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await c.env.DB.prepare(`SELECT r.*,p.cooperative_id FROM price_rules r JOIN price_tables p ON p.id=r.price_table_id WHERE r.id=?`).bind(c.req.param('id')).first<any>();if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Regra não encontrada.'},404);await c.env.DB.prepare(`DELETE FROM price_rules WHERE id=?`).bind(before.id).run();await audit(c,'delete','price_rule',before.id,before,null,before.cooperative_id);return c.json({ok:true});
});

operationRoutes.get('/api-clients', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  const coop=auth.cooperativeId;
  let sql=`SELECT a.id,a.cooperative_id,a.establishment_id,a.name,a.key_prefix,a.scopes,a.status,a.last_used_at,a.created_at,e.name establishment_name FROM api_clients a LEFT JOIN establishments e ON e.id=a.establishment_id WHERE 1=1`;const params:unknown[]=[];
  if(coop){sql+=` AND a.cooperative_id=?`;params.push(coop);}sql+=` ORDER BY a.created_at DESC`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

operationRoutes.post('/api-clients', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  const body=await bodyJson<Record<string,unknown>>(c);
  const cooperativeId=auth.cooperativeId;
  const establishmentId=nullableText(body.establishment_id,100);
  const name=cleanText(body.name,150);if(!cooperativeId||!name)return c.json({ok:false,error:'Informe cooperativa e nome.'},400);
  if(establishmentId){const est=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(establishmentId).first<any>();if(!est||est.cooperative_id!==cooperativeId)return c.json({ok:false,error:'Estabelecimento inválido.'},400);}
  const raw=`lig_live_${randomToken(32)}`,hash=await sha256(raw),client={id:id(),cooperative_id:cooperativeId,establishment_id:establishmentId,name,key_prefix:raw.slice(0,16),key_hash:hash,scopes:'orders:write,orders:read',created_by:auth.id};
  await c.env.DB.prepare(`INSERT INTO api_clients (id,cooperative_id,establishment_id,name,key_prefix,key_hash,scopes,created_by) VALUES (?,?,?,?,?,?,?,?)`).bind(...Object.values(client)).run();
  await audit(c,'create','api_client',client.id,null,{...client,key_hash:'***'},cooperativeId);return c.json({ok:true,item:{...client,key_hash:undefined,api_key:raw},warning:'Copie agora. A chave não será exibida novamente.'},201);
});

operationRoutes.post('/api-clients/:id/revoke', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  const client=await c.env.DB.prepare(`SELECT * FROM api_clients WHERE id=?`).bind(c.req.param('id')).first<any>();
  if(!client||auth.cooperativeId!==client.cooperative_id)return c.json({ok:false,error:'Chave não encontrada.'},404);
  await c.env.DB.prepare(`UPDATE api_clients SET status='revoked' WHERE id=?`).bind(client.id).run();await audit(c,'revoke','api_client',client.id,client,{status:'revoked'},client.cooperative_id);return c.json({ok:true});
});

operationRoutes.get('/webhooks', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  const coop=auth.cooperativeId;
  let sql=`SELECT w.id,w.cooperative_id,w.establishment_id,w.name,w.url,w.events,w.status,w.created_at,e.name establishment_name FROM webhooks w LEFT JOIN establishments e ON e.id=w.establishment_id WHERE 1=1`;const params:unknown[]=[];
  if(coop){sql+=` AND w.cooperative_id=?`;params.push(coop);}sql+=` ORDER BY w.created_at DESC`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

operationRoutes.post('/webhooks', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);const body=await bodyJson<Record<string,unknown>>(c);
  const cooperativeId=auth.cooperativeId;
  const establishmentId=nullableText(body.establishment_id,100);
  const name=cleanText(body.name,150),url=cleanText(body.url,1000);if(!cooperativeId||!name||!/^https:\/\//i.test(url))return c.json({ok:false,error:'Informe nome e URL HTTPS.'},400);
  if(establishmentId){const est=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(establishmentId).first<any>();if(!est||est.cooperative_id!==cooperativeId)return c.json({ok:false,error:'Estabelecimento inválido.'},400);}
  const hook={id:id(),cooperative_id:cooperativeId,establishment_id:establishmentId,name,url,secret:randomToken(32),events:cleanText(body.events||'delivery.created,delivery.assigned,delivery.status_changed',500),created_by:auth.id};
  await c.env.DB.prepare(`INSERT INTO webhooks (id,cooperative_id,establishment_id,name,url,secret,events,created_by) VALUES (?,?,?,?,?,?,?,?)`).bind(...Object.values(hook)).run();await audit(c,'create','webhook',hook.id,null,{...hook,secret:'***'},cooperativeId);return c.json({ok:true,item:hook,warning:'Copie o segredo agora.'},201);
});

operationRoutes.put('/webhooks/:id', async(c)=>{const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);const before=await c.env.DB.prepare(`SELECT * FROM webhooks WHERE id=?`).bind(c.req.param('id')).first<any>();if(!before||auth.cooperativeId!==before.cooperative_id)return c.json({ok:false,error:'Webhook não encontrado.'},404);const body=await bodyJson<Record<string,unknown>>(c);const after={name:cleanText(body.name??before.name,150),url:cleanText(body.url??before.url,1000),events:cleanText(body.events??before.events,500),status:cleanText(body.status??before.status,20),establishment_id:nullableText(body.establishment_id??before.establishment_id,100)};if(!/^https:\/\//i.test(after.url))return c.json({ok:false,error:'A URL deve usar HTTPS.'},400);await c.env.DB.prepare(`UPDATE webhooks SET name=?,url=?,events=?,status=?,establishment_id=?,updated_at=? WHERE id=?`).bind(after.name,after.url,after.events,after.status,after.establishment_id,nowIso(),before.id).run();await audit(c,'update','webhook',before.id,{...before,secret:'***'},after,before.cooperative_id);return c.json({ok:true});});

operationRoutes.delete('/webhooks/:id', async(c)=>{const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);const before=await c.env.DB.prepare(`SELECT * FROM webhooks WHERE id=?`).bind(c.req.param('id')).first<any>();if(!before||auth.cooperativeId!==before.cooperative_id)return c.json({ok:false,error:'Webhook não encontrado.'},404);await c.env.DB.prepare(`DELETE FROM webhooks WHERE id=?`).bind(before.id).run();await audit(c,'delete','webhook',before.id,{...before,secret:'***'},null,before.cooperative_id);return c.json({ok:true});});

operationRoutes.post('/webhooks/process', async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin']);await processWebhookQueue(c.env,50);return c.json({ok:true});});

operationRoutes.get('/audit', async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin']);let sql=`SELECT a.*,u.name user_name,c.name cooperative_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN cooperatives c ON c.id=a.cooperative_id WHERE 1=1`;const params:unknown[]=[];if(auth.role!=='platform_admin'){sql+=` AND a.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND a.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}if(c.req.query('entity_type')){sql+=` AND a.entity_type=?`;params.push(c.req.query('entity_type'));}sql+=` ORDER BY a.created_at DESC LIMIT 1000`;const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});});
