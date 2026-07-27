import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { assertRole, bodyJson, cleanText, id, nullableText } from '../lib/util';
import { settleDueGuarantees } from '../lib/guarantees';
import { queueWebhookEvent } from '../lib/webhooks';
import { expandJsonRows } from '../lib/rows';
import { deliveryFields } from '../lib/delivery-fields';
import { baseDirectReceivedPayment, baseReceivablePayment } from '../lib/financial-settlement';

export const dispatchV9Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth = c.get('auth');
  assertRole(auth, roles);
  if (!auth.cooperativeId) throw new Error('Cooperativa não vinculada.');
  return auth;
}
function localDateSql() { return `date('now','-3 hours')`; }
function canManage(auth: AuthUser, delivery: Row) {
  if (delivery.delivery_type === 'base') return ['cooperative_admin','dispatcher'].includes(auth.role);
  return auth.role === 'establishment' && auth.establishmentId === delivery.establishment_id;
}
async function eligible(c: Context<AppBindings>, driverId: string, delivery: Row) {
  const driver = await c.env.DB.prepare(`SELECT id FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND online=1 AND datetime(last_seen_at)>=datetime('now','-10 minutes') AND deleted_at IS NULL`)
    .bind(driverId, delivery.cooperative_id).first();
  if (!driver) return false;
  if (delivery.delivery_type === 'base') {
    return Boolean(await c.env.DB.prepare(`SELECT 1 ok FROM schedules WHERE driver_id=? AND base_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND date(start_at)=${localDateSql()} LIMIT 1`)
      .bind(driverId, delivery.base_id).first());
  }
  return Boolean(await c.env.DB.prepare(`SELECT 1 ok WHERE EXISTS(
    SELECT 1 FROM schedules WHERE driver_id=? AND establishment_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND date(start_at)=${localDateSql()}
  ) OR EXISTS(
    SELECT 1 FROM establishment_driver_permissions WHERE driver_id=? AND establishment_id=? AND active=1 AND date(service_date)=${localDateSql()}
  ) LIMIT 1`).bind(driverId,delivery.establishment_id,driverId,delivery.establishment_id).first());
}

async function financialOnComplete(c: Context<AppBindings>, auth: AuthUser, delivery: Row) {
  const exists = await c.env.DB.prepare(`SELECT 1 ok FROM financial_entries WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND deleted_at IS NULL`).bind(delivery.id).first();
  if (exists) return;
  const gross = Number(delivery.driver_gross_cents || delivery.driver_earnings_cents || 0);
  const taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  const direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method);
  const receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  if(!direct&&!receivable)return;
  const entryStatus=receivable?'open':'paid',settled=direct?gross:0;
  const coop = taxable?await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>():null;
  const inss = taxable?Math.round(gross * Number(coop?.inss_percent || 0) / 100):0;
  const sest = taxable?Math.round(gross * Number(coop?.sest_senat_percent || 0) / 100):0;
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date('now','-3 hours'),?,?)`)
    .bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,`Entrega ${delivery.display_code}${receivable?'':' • recebido diretamente pelo cooperado'}`,gross,settled,entryStatus,auth.id)];
  if (inss) statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,inss,auth.id));
  if (sest) statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,sest,auth.id));
  await c.env.DB.batch(statements);
}

dispatchV9Routes.get('/settings', async c => {
  const auth=tenant(c,['cooperative_admin']);
  const [coop,establishments,bases]=await Promise.all([
    c.env.DB.prepare(`SELECT id,name,primary_color,base_tracking_enabled FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>(),
    c.env.DB.prepare(`SELECT id,name,tracking_enabled,driver_map_enabled,confirmation_mode,customer_chat_enabled,driver_call_enabled FROM establishments WHERE cooperative_id=? AND deleted_at IS NULL ORDER BY name`).bind(auth.cooperativeId).all<Row>(),
    c.env.DB.prepare(`SELECT id,name,tracking_enabled,confirmation_mode,customer_chat_enabled,driver_call_enabled FROM bases WHERE cooperative_id=? AND deleted_at IS NULL ORDER BY name`).bind(auth.cooperativeId).all<Row>()
  ]);
  return c.json({ok:true,cooperative:coop,establishments:establishments.results,bases:bases.results});
});

dispatchV9Routes.put('/settings/theme', async c => {
  const auth=tenant(c,['cooperative_admin']); const body=await bodyJson<Row>(c); const color=cleanText(body.primary_color,20);
  if(!/^#[0-9a-fA-F]{6}$/.test(color)) return c.json({ok:false,error:'Informe uma cor hexadecimal válida.'},400);
  await c.env.DB.prepare(`UPDATE cooperatives SET primary_color=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(color,auth.cooperativeId).run();
  return c.json({ok:true,primary_color:color});
});

dispatchV9Routes.put('/settings/establishments/:id', async c => {
  const auth=tenant(c,['cooperative_admin']); const body=await bodyJson<Row>(c);
  const mode=cleanText(body.confirmation_mode,20); if(!['required','optional','disabled'].includes(mode)) return c.json({ok:false,error:'Modo de confirmação inválido.'},400);
  const result=await c.env.DB.prepare(`UPDATE establishments SET tracking_enabled=?,driver_map_enabled=?,confirmation_mode=?,customer_chat_enabled=?,driver_call_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(body.tracking_enabled?1:0,body.driver_map_enabled?1:0,mode,body.customer_chat_enabled?1:0,body.driver_call_enabled?1:0,c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Estabelecimento não encontrado.'},404);
  return c.json({ok:true});
});

dispatchV9Routes.put('/settings/bases/:id', async c => {
  const auth=tenant(c,['cooperative_admin']); const body=await bodyJson<Row>(c);
  const mode=cleanText(body.confirmation_mode,20); if(!['required','optional','disabled'].includes(mode)) return c.json({ok:false,error:'Modo de confirmação inválido.'},400);
  const result=await c.env.DB.prepare(`UPDATE bases SET tracking_enabled=?,confirmation_mode=?,customer_chat_enabled=?,driver_call_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(body.tracking_enabled?1:0,mode,body.customer_chat_enabled?1:0,body.driver_call_enabled?1:0,c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Base não encontrada.'},404);
  return c.json({ok:true});
});

dispatchV9Routes.post('/deliveries/:id/assignment', async c => {
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);
  const delivery=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(!canManage(auth,delivery))return c.json({ok:false,error:delivery.delivery_type==='base'?'Somente a cooperativa gerencia a atribuição da Base.':'Somente o estabelecimento gerencia a entrega de balcão.'},403);
  if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'A entrega já foi encerrada.'},409);
  const body=await bodyJson<Row>(c),action=cleanText(body.action,30);
  if(['unassign','offer_all'].includes(action)){
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=NULL,status=?,assignment_source=?,unassigned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(action==='offer_all'?'offered':'new',action,delivery.id),
      c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,action==='offer_all'?'offered':'new',action==='offer_all'?'Disponibilizada aos cooperados elegíveis':'Atribuição removida',auth.id)
    ]);
    return c.json({ok:true,status:action==='offer_all'?'offered':'new'});
  }
  const driverId=cleanText(body.driver_id,100);
  if(!driverId)return c.json({ok:false,error:'Selecione o cooperado.'},400);
  const driver=await c.env.DB.prepare(`SELECT id,name FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`).bind(driverId,auth.cooperativeId).first<Row>();
  if(!driver)return c.json({ok:false,error:'Cooperado inválido.'},400);
  if(!(await eligible(c,driverId,delivery)))return c.json({ok:false,error:'O cooperado precisa estar online e escalado ou incluído nesse local hoje.'},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='assigned',assigned_by_role=?,assigned_by_user_id=?,assignment_source='manual_v9',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(driverId,auth.role,auth.id,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'assigned',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,`Atribuída a ${driver.name}`,auth.id),
    c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting' AND ((? IS NOT NULL AND base_id=?) OR (? IS NOT NULL AND establishment_id=?))`).bind(delivery.id,driverId,delivery.base_id,delivery.base_id,delivery.establishment_id,delivery.establishment_id)
  ]);
  return c.json({ok:true,status:'assigned'});
});

dispatchV9Routes.get('/establishment/schedule-options', async c => {
  const auth=tenant(c,['establishment']);
  const [establishment,drivers,shifts]=await Promise.all([
    c.env.DB.prepare(`SELECT id,name FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(auth.establishmentId,auth.cooperativeId).first<Row>(),
    c.env.DB.prepare(`SELECT DISTINCT d.id,d.name,d.status,CASE WHEN d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-10 minutes') THEN 1 ELSE 0 END online
      FROM drivers d JOIN schedules s ON s.driver_id=d.id
      WHERE d.cooperative_id=? AND d.status='active' AND d.deleted_at IS NULL
        AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed')
        AND date(s.start_at) BETWEEN date('now','-3 hours','weekday 1','-7 days') AND date('now','-3 hours','weekday 0')
      ORDER BY d.name`).bind(auth.cooperativeId,auth.establishmentId).all<Row>(),
    c.env.DB.prepare(`SELECT id,name,start_time,end_time,shift_label,establishment_id FROM shift_templates
      WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL AND (establishment_id IS NULL OR establishment_id=?) ORDER BY start_time,name`)
      .bind(auth.cooperativeId,auth.establishmentId).all<Row>()
  ]);
  return c.json({ok:true,establishment,drivers:drivers.results,shifts:shifts.results,read_only:true});
});

dispatchV9Routes.get('/driver/offers', async c => {
  const auth=tenant(c,['driver']);
  const rows=await c.env.DB.prepare(`SELECT ${deliveryFields('d')},json_object('establishment_name',e.name,'base_name',b.name) related_json FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN bases b ON b.id=d.base_id WHERE d.cooperative_id=? AND d.status='offered' AND d.assigned_driver_id IS NULL AND d.deleted_at IS NULL AND EXISTS(SELECT 1 FROM drivers x WHERE x.id=? AND x.online=1 AND datetime(x.last_seen_at)>=datetime('now','-10 minutes')) AND ((d.delivery_type='base' AND EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=? AND s.base_id=d.base_id AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=${localDateSql()})) OR (d.delivery_type='establishment' AND (EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=? AND s.establishment_id=d.establishment_id AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=${localDateSql()}) OR EXISTS(SELECT 1 FROM establishment_driver_permissions p WHERE p.driver_id=? AND p.establishment_id=d.establishment_id AND p.active=1 AND date(p.service_date)=${localDateSql()})))) ORDER BY d.created_at LIMIT 50`)
    .bind(auth.cooperativeId,auth.driverId,auth.driverId,auth.driverId,auth.driverId).all<Row>();
  return c.json({ok:true,items:expandJsonRows(rows.results as Row[])});
});

dispatchV9Routes.post('/driver/offers/:id/accept', async c => {
  const auth=tenant(c,['driver']);
  const delivery=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND status='offered' AND assigned_driver_id IS NULL AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!delivery)return c.json({ok:false,error:'A entrega não está mais disponível.'},409);
  if(!(await eligible(c,auth.driverId!,delivery)))return c.json({ok:false,error:'Você precisa estar online e escalado neste local.'},409);
  const result=await c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='accepted',accepted_at=CURRENT_TIMESTAMP,assignment_source='offer_all',updated_at=CURRENT_TIMESTAMP WHERE id=? AND assigned_driver_id IS NULL AND status='offered'`).bind(auth.driverId,delivery.id).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Outro cooperado já aceitou esta entrega.'},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,'offered','accepted','Aceita na fila de entregas',?)`).bind(id(),delivery.id,auth.cooperativeId,auth.id),
    c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting' AND ((? IS NOT NULL AND base_id=?) OR (? IS NOT NULL AND establishment_id=?))`).bind(delivery.id,auth.driverId,delivery.base_id,delivery.base_id,delivery.establishment_id,delivery.establishment_id)
  ]);
  return c.json({ok:true});
});

dispatchV9Routes.post('/deliveries/:id/allow-no-code', async c => {
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);
  const delivery=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(!canManage(auth,delivery))return c.json({ok:false,error:'Sem permissão para liberar esta entrega.'},403);
  const body=await bodyJson<Row>(c),enabled=body.enabled!==false;
  await c.env.DB.prepare(`UPDATE deliveries SET finish_without_code_authorized=?,finish_without_code_authorized_by=?,finish_without_code_authorized_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(enabled?1:0,enabled?auth.id:null,enabled?1:0,delivery.id).run();
  return c.json({ok:true,enabled});
});

dispatchV9Routes.post('/driver/deliveries/:id/complete', async c => {
  const auth=tenant(c,['driver']); const body=await bodyJson<Row>(c);
  const delivery=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId,auth.driverId).first<Row>();
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(!['picked_up','in_route','problem'].includes(delivery.status))return c.json({ok:false,error:'A entrega precisa estar em rota.'},409);
  const required=Number(delivery.confirmation_required??1)===1;
  const bypass=Number(delivery.finish_without_code_authorized||0)===1;
  const code=cleanText(body.confirmation_code,4);
  if(required&&!bypass&&(!/^\d{4}$/.test(code)||code!==String(delivery.confirmation_code||'')))return c.json({ok:false,error:'Código incorreto. Peça ao cliente o código de 4 dígitos ou solicite a liberação do estabelecimento/Base.'},409);
  const note=required&&!bypass?'Código de 4 dígitos confirmado':bypass?'Finalizada sem código com liberação do responsável':'Finalização sem código conforme configuração do local';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='delivered',confirmation_verified_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE confirmation_verified_at END,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(required&&!bypass?1:0,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'delivered',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,note,auth.id)
  ]);
  await financialOnComplete(c,auth,delivery);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.status_changed',{id:delivery.id,display_code:delivery.display_code,status:'delivered'}));
  return c.json({ok:true,message:'Entrega finalizada.'});
});

dispatchV9Routes.post('/guarantees/settle', async c => {
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const result=await settleDueGuarantees(c.env,auth.cooperativeId);
  return c.json({ok:true,...result});
});
