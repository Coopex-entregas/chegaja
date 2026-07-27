import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { assertRole, bodyJson, cleanText, id } from '../lib/util';
import { queueWebhookEvent } from '../lib/webhooks';
import { expandJsonRow } from '../lib/rows';
import { deliveryFields } from '../lib/delivery-fields';
import { baseDirectReceivedPayment, baseReceivablePayment, reconcileDriverFinancialBalance } from '../lib/financial-settlement';

export const platformV14Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth = c.get('auth');
  assertRole(auth, roles);
  if (!auth.cooperativeId) throw new Error('Cooperativa não vinculada.');
  return auth;
}

function senderType(auth: AuthUser) {
  return auth.role === 'driver' ? 'driver' : auth.role === 'establishment' ? 'establishment' : 'cooperative';
}
function readColumn(auth: AuthUser) {
  return auth.role === 'driver' ? 'driver_read_at' : auth.role === 'establishment' ? 'establishment_read_at' : 'cooperative_read_at';
}
function visibleRecipient(auth: AuthUser) {
  return auth.role === 'driver' ? 'driver' : auth.role === 'establishment' ? 'establishment' : 'cooperative';
}

async function accessibleDelivery(c: Context<AppBindings>, auth: AuthUser, deliveryId: string) {
  const row = expandJsonRow(await c.env.DB.prepare(`SELECT ${deliveryFields('d')},json_object(
      'establishment_name',e.name,'establishment_phone',e.phone,
      'base_name',b.name,'driver_name',dr.name,'driver_phone',dr.phone,
      'cooperative_name',co.name,'cooperative_phone',co.phone) related_json
    FROM deliveries d JOIN establishments e ON e.id=d.establishment_id
    JOIN cooperatives co ON co.id=d.cooperative_id
    LEFT JOIN bases b ON b.id=d.base_id LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id
    WHERE d.id=? AND d.cooperative_id=? AND d.deleted_at IS NULL LIMIT 1`)
    .bind(deliveryId, auth.cooperativeId).first<Row>());
  if (!row) throw new Error('Entrega não encontrada.');
  if (auth.role === 'driver' && row.assigned_driver_id !== auth.driverId) throw new Error('A conversa fica disponível depois que a entrega for atribuída a você.');
  if (auth.role === 'establishment' && (row.establishment_id !== auth.establishmentId || row.delivery_type === 'base')) throw new Error('Acesso não autorizado.');
  if (['cooperative_admin','dispatcher'].includes(auth.role) && row.delivery_type !== 'base') throw new Error('A cooperativa conversa nesta área somente nas entregas da Base.');
  return row;
}

function contactOptions(auth: AuthUser, delivery: Row) {
  const options: Row[] = [];
  if (auth.role === 'driver') {
    options.push({ value:'customer', label:'Cliente', phone:delivery.recipient_phone || delivery.customer_phone || null });
    if (delivery.delivery_type === 'base') options.push({ value:'cooperative', label:delivery.base_name || 'Base', phone:delivery.cooperative_phone || null });
    else options.push({ value:'establishment', label:delivery.establishment_name || 'Estabelecimento', phone:delivery.establishment_phone || null });
  } else {
    options.push({ value:'customer', label:'Cliente', phone:delivery.recipient_phone || delivery.customer_phone || null });
    if (delivery.assigned_driver_id) options.push({ value:'driver', label:delivery.driver_name || 'Cooperado', phone:delivery.driver_phone || null });
  }
  options.push({ value:'all', label:'Todos da entrega', phone:null });
  return options;
}
function allowedRecipients(auth: AuthUser, delivery: Row) {
  if (auth.role === 'driver') return delivery.delivery_type === 'base'
    ? ['customer','cooperative','all'] : ['customer','establishment','all'];
  return ['customer','driver','all'];
}

platformV14Routes.get('/v14/deliveries/:id/chat', async c => {
  const auth = tenant(c,['cooperative_admin','dispatcher','establishment','driver']);
  const delivery = await accessibleDelivery(c,auth,c.req.param('id'));
  const mine = visibleRecipient(auth);
  const rows = await c.env.DB.prepare(`SELECT id,sender_type,sender_name,message,recipient_type,created_at
    FROM delivery_messages WHERE delivery_id=? AND deleted_at IS NULL
      AND (sender_type=? OR recipient_type IN ('all',?))
    ORDER BY created_at ASC LIMIT 400`).bind(delivery.id,senderType(auth),mine).all<Row>();
  const column = readColumn(auth);
  await c.env.DB.prepare(`UPDATE delivery_messages SET ${column}=COALESCE(${column},CURRENT_TIMESTAMP)
    WHERE delivery_id=? AND sender_type!=? AND recipient_type IN ('all',?) AND ${column} IS NULL`)
    .bind(delivery.id,senderType(auth),mine).run();
  return c.json({ok:true,delivery:{id:delivery.id,display_code:delivery.display_code,status:delivery.status},items:rows.results,
    active:!['delivered','cancelled'].includes(delivery.status),contacts:contactOptions(auth,delivery),sender_type:senderType(auth)});
});

platformV14Routes.post('/v14/deliveries/:id/chat', async c => {
  const auth = tenant(c,['cooperative_admin','dispatcher','establishment','driver']);
  const delivery = await accessibleDelivery(c,auth,c.req.param('id'));
  if (['delivered','cancelled'].includes(delivery.status)) return c.json({ok:false,error:'A conversa foi encerrada.'},409);
  const body = await bodyJson<Row>(c);
  const message = cleanText(body.message,500);
  const recipient = cleanText(body.recipient_type || 'all',30);
  if (!message) return c.json({ok:false,error:'Digite uma mensagem.'},400);
  if (!allowedRecipients(auth,delivery).includes(recipient)) return c.json({ok:false,error:'Destinatário inválido.'},400);
  const sender = senderType(auth), ownRead = readColumn(auth);
  await c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,${ownRead})
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(id(),delivery.id,auth.cooperativeId,sender,auth.id,auth.name,message,recipient).run();
  return c.json({ok:true});
});

platformV14Routes.get('/v14/messages/unread', async c => {
  const auth = tenant(c,['cooperative_admin','dispatcher','establishment','driver']);
  const recipient = visibleRecipient(auth), sender = senderType(auth), column = readColumn(auth);
  const where = [`d.cooperative_id=?`,`d.deleted_at IS NULL`,`m.deleted_at IS NULL`,`m.sender_type!=?`,`m.recipient_type IN ('all',?)`,`m.${column} IS NULL`];
  const params: any[] = [auth.cooperativeId,sender,recipient];
  if (auth.role === 'driver') { where.push(`d.assigned_driver_id=?`); params.push(auth.driverId); }
  else if (auth.role === 'establishment') { where.push(`d.establishment_id=?`,`d.delivery_type!='base'`); params.push(auth.establishmentId); }
  else where.push(`d.delivery_type='base'`);
  const rows = await c.env.DB.prepare(`SELECT d.id delivery_id,d.display_code,MAX(m.created_at) latest_at,COUNT(*) unread_count,
      (SELECT m2.message FROM delivery_messages m2 WHERE m2.delivery_id=d.id AND m2.deleted_at IS NULL
       AND m2.sender_type!=? AND m2.recipient_type IN ('all',?) AND m2.${column} IS NULL ORDER BY m2.created_at DESC LIMIT 1) latest_message
    FROM deliveries d JOIN delivery_messages m ON m.delivery_id=d.id
    WHERE ${where.join(' AND ')} GROUP BY d.id,d.display_code ORDER BY latest_at DESC LIMIT 30`)
    .bind(sender,recipient,...params).all<Row>();
  const total = (rows.results||[]).reduce((sum,row)=>sum+Number(row.unread_count||0),0);
  return c.json({ok:true,total,items:rows.results});
});

platformV14Routes.post('/v14/driver/deliveries/:id/accept', async c => {
  const auth = tenant(c,['driver']);
  const delivery = await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'),auth.cooperativeId,auth.driverId).first<Row>();
  if (!delivery) return c.json({ok:false,error:'Entrega não encontrada ou não atribuída a você.'},404);
  if (['delivered','cancelled'].includes(delivery.status)) return c.json({ok:false,error:'A entrega já foi encerrada.'},409);
  const online = await c.env.DB.prepare(`SELECT 1 ok FROM drivers WHERE id=? AND cooperative_id=? AND online=1 AND datetime(last_seen_at)>=datetime('now','-10 minutes')`)
    .bind(auth.driverId,auth.cooperativeId).first();
  if (!online) return c.json({ok:false,error:'Fique online para aceitar a entrega.'},409);
  if (delivery.status === 'in_route') return c.json({ok:true,status:'in_route',already_accepted:true});
  const order = ['assigned','accepted','to_pickup','at_pickup','picked_up','in_route'];
  const current = order.indexOf(String(delivery.status));
  const steps = delivery.status === 'problem' ? ['in_route']
    : current >= 0 ? order.slice(current + 1)
    : ['accepted','to_pickup','at_pickup','picked_up','in_route'];
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE deliveries SET status='in_route',accepted_at=COALESCE(accepted_at,CURRENT_TIMESTAMP),picked_up_at=COALESCE(picked_up_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id)
  ];
  let oldStatus = String(delivery.status);
  for (const status of steps) {
    if (status === oldStatus) continue;
    statements.push(c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by)
      VALUES (?,?,?,?,?,'Etapa registrada automaticamente pelo fluxo simplificado',?)`).bind(id(),delivery.id,auth.cooperativeId,oldStatus,status,auth.id));
    oldStatus = status;
  }
  await c.env.DB.batch(statements);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.status_changed',{id:delivery.id,display_code:delivery.display_code,status:'in_route'}));
  return c.json({ok:true,status:'in_route'});
});

async function financialOnComplete(c: Context<AppBindings>, auth: AuthUser, delivery: Row) {
  const exists = await c.env.DB.prepare(`SELECT 1 ok FROM financial_entries WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND deleted_at IS NULL LIMIT 1`).bind(delivery.id).first();
  if (exists) return;
  const gross = Number(delivery.driver_gross_cents || delivery.driver_earnings_cents || 0);
  const taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  const direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method);
  const receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  // Cartões e vales da Base informam somente como cobrar o pedido/mercadoria.
  // Eles não criam produção nem desconto para o cooperado.
  if(!direct&&!receivable)return;
  const entryStatus=receivable?'open':'paid',settled=direct?gross:0;
  const coop = taxable?await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>():null;
  const inss = taxable?Math.round(gross * Number(coop?.inss_percent || 0) / 100):0;
  const sest = taxable?Math.round(gross * Number(coop?.sest_senat_percent || 0) / 100):0;
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by)
    VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date('now','-3 hours'),?,?)`).bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,`Entrega ${delivery.display_code}${receivable?'':' • recebido diretamente pelo cooperado'}`,gross,settled,entryStatus,auth.id)];
  if (inss) statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,inss,auth.id));
  if (sest) statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,sest,auth.id));
  await c.env.DB.batch(statements);
  await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(auth.driverId));
}

platformV14Routes.post('/v14/driver/deliveries/:id/complete', async c => {
  const auth = tenant(c,['driver']);
  const delivery = await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'),auth.cooperativeId,auth.driverId).first<Row>();
  if (!delivery) return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if (delivery.status === 'delivered') return c.json({ok:true,already_delivered:true,customer_confirmed:Boolean(delivery.customer_confirmed_received_at)});
  if (delivery.status === 'cancelled') return c.json({ok:false,error:'Esta entrega foi cancelada.'},409);
  if (!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(delivery.status)) return c.json({ok:false,error:'Aceite a entrega antes de concluir.'},409);
  const body = await bodyJson<Row>(c);
  const required = Number(delivery.confirmation_required ?? 1) === 1 && !Number(delivery.finish_without_code_authorized || 0);
  const code = cleanText(body.confirmation_code,10);
  if (required && code !== String(delivery.confirmation_code||'')) return c.json({ok:false,error:'Código de confirmação incorreto. O cliente também pode tocar em “Recebi o pedido”.'},409);
  const note = required ? 'Entrega concluída pelo cooperado com código' : 'Entrega concluída pelo cooperado';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='delivered',completion_source='driver',confirmation_verified_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE confirmation_verified_at END,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(required?1:0,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'delivered',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,note,auth.id),
    c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,driver_read_at) VALUES (?,?,?,'driver',?,?,'✅ Entrega concluída.','all',CURRENT_TIMESTAMP)`).bind(id(),delivery.id,auth.cooperativeId,auth.id,auth.name)
  ]);
  await financialOnComplete(c,auth,delivery);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.status_changed',{id:delivery.id,display_code:delivery.display_code,status:'delivered'}));
  return c.json({ok:true});
});
